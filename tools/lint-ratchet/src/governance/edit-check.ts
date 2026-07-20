import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  compareCurrentToBaseline,
  computeLintRatchetConfigHash,
  type LintRatchetBaseline,
  type LintRatchetCurrentItem,
  parseLintRatchetBaselineStructure,
} from "../kernel/baseline.js";
import { stableJson } from "../kernel/baseline-hash.js";
import { validateBaselineTestForRatchet } from "../kernel/baseline-validation.js";
import type { JsonObject, JsonValue, LintRatchetConfig } from "../kernel/config-types.js";
import { collectCurrentForRatchet } from "../kernel/current-collector.js";
import { type LintRatchetEngineBinding, relativeToRepoRoot } from "../kernel/engine-context.js";
import { usesEslintCache } from "../kernel/eslint-config.js";
import { matchesRatchet } from "../kernel/ratchet-globs.js";
import { buildRuleSourceHashesById } from "../kernel/rule-source.js";

// The repo binding the edit-time check needs: where the gate runs, the committed
// baseline, the registry to match paths against, and the plugin allowlist for
// rule-source hashing. Injected so the operation carries no repo-bound `paths`
// import or Musi registry import.
export interface LintRatchetEditCheckEngine {
  readonly repoRoot: string;
  readonly baselinePath: string;
  readonly registry: readonly LintRatchetConfig[];
  readonly binding: LintRatchetEngineBinding;
}

// One (edited file, cacheable ratchet) pair the edit-time hook may check.
export interface EditCheckTarget {
  readonly path: string;
  readonly testId: string;
  readonly ruleId: string;
  readonly cacheIdentity?: string;
}

export interface EditCheckRegression {
  readonly path: string;
  readonly testId: string;
  readonly ruleId: string;
  readonly reason: string;
  readonly line?: number;
  readonly baselineCount: number;
  readonly currentCount: number;
  // Mechanical repair command for this rule (codemod command or the autofix
  // runner). The repo-agnostic engine never sets it; the adapter CLI enriches
  // regressions from its rule-docs metadata before formatting the wire row, so
  // the advisory hook can name the exact command without a second engine call.
  readonly repairCommand?: string;
}

function byPathThenTestId(
  left: { readonly path: string; readonly testId: string },
  right: { readonly path: string; readonly testId: string },
): number {
  return left.path.localeCompare(right.path) || left.testId.localeCompare(right.testId);
}

// Edit-time eligibility policy, shared by discovery and grouping. Only
// cache-using (minimal-TS) ratchets are cheap enough for the hot path —
// type-aware ratchets rebuild a TS program.
function isEligibleEditCheckRatchet(ratchet: LintRatchetConfig): boolean {
  return usesEslintCache(ratchet);
}

// Discovery: the eligible ratchets whose globs match each edited path. Ordering
// is deterministic (path then ratchet id) so the hook's per-target caps are
// stable.
export function discoverEditCheckTargets(
  engine: LintRatchetEditCheckEngine,
  paths: readonly string[],
): EditCheckTarget[] {
  const targets: EditCheckTarget[] = [];
  const seen = new Set<string>();
  const matchedRatchets = new Map<string, LintRatchetConfig>();
  for (const rawPath of paths) {
    const path = relativeToRepoRoot(engine.repoRoot, rawPath);
    for (const ratchet of engine.registry) {
      if (!isEligibleEditCheckRatchet(ratchet)) continue;
      if (!matchesRatchet(ratchet, path)) continue;
      const key = `${path}\t${ratchet.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matchedRatchets.set(ratchet.id, ratchet);
      targets.push({ path, testId: ratchet.id, ruleId: ratchet.ruleId });
    }
  }
  if (targets.length === 0) return [];
  const structural = existsSync(engine.baselinePath)
    ? parseLintRatchetBaselineStructure(readFileSync(engine.baselinePath, "utf8"))
    : undefined;
  const baseline = structural?.baseline;
  const ruleSourceHashesById = buildRuleSourceHashesById(
    [...matchedRatchets.values()],
    engine.binding,
  );
  return targets
    .map((target) => {
      const ratchet = matchedRatchets.get(target.testId);
      if (ratchet === undefined) return target;
      return {
        ...target,
        cacheIdentity: editCheckTargetCacheIdentity(
          ratchet,
          baseline?.tests[ratchet.id],
          ruleSourceHashesById.get(ratchet.id),
        ),
      };
    })
    .sort(byPathThenTestId);
}

type BaselineTest = LintRatchetBaseline["tests"][string];
type BaselineItem = BaselineTest["items"][string];

function baselineItemIdentity(item: BaselineItem): JsonObject {
  const identity: Record<string, JsonValue> = { count: item.count };
  if (item.lines !== undefined) identity.lines = item.lines;
  if (item.maxComplexity !== undefined) identity.maxComplexity = item.maxComplexity;
  if (item.perFunction !== undefined) {
    identity.perFunction = item.perFunction.map((entry) => ({
      complexity: entry.complexity,
      label: entry.label,
      line: entry.line,
    }));
  }
  return identity;
}

function baselineItemsIdentity(items: BaselineTest["items"]): JsonObject {
  const identity: Record<string, JsonValue> = {};
  for (const [path, item] of Object.entries(items)) {
    identity[path] = baselineItemIdentity(item);
  }
  return identity;
}

function editCheckTargetCacheIdentity(
  ratchet: LintRatchetConfig,
  baselineTest: BaselineTest | undefined,
  ruleSourceHash: string | undefined,
): string {
  const hash = createHash("sha256")
    .update(
      stableJson({
        baselineTest:
          baselineTest === undefined
            ? null
            : {
                configHash: baselineTest.configHash,
                files: baselineTest.files,
                ignores: baselineTest.ignores,
                items: baselineItemsIdentity(baselineTest.items),
                metric: baselineTest.metric,
                mode: baselineTest.mode,
                ruleId: baselineTest.ruleId,
                ruleOptions: baselineTest.ruleOptions,
                ruleSourceHash: baselineTest.ruleSourceHash,
              },
        liveConfigHash: computeLintRatchetConfigHash(ratchet),
        liveRuleSourceHash: ruleSourceHash ?? null,
        testId: ratchet.id,
      }),
    )
    .digest("hex");
  return `sha256:${hash}`;
}

interface RatchetGroup {
  readonly ratchet: LintRatchetConfig;
  readonly ruleSourceHash: string;
  readonly files: string[];
}

// Group targets by ratchet, dropping any whose committed baseline test is
// missing or whose config/rule-source hash has drifted from the live registry.
// A drifted ratchet is soft-skipped (never reported) rather than risking a
// false regression against a stale floor.
function groupTargets(
  engine: LintRatchetEditCheckEngine,
  targets: readonly EditCheckTarget[],
  baseline: LintRatchetBaseline,
): RatchetGroup[] {
  const ratchetById = new Map(engine.registry.map((ratchet) => [ratchet.id, ratchet]));
  const ruleSourceHashesById = buildRuleSourceHashesById(engine.registry, engine.binding);
  const groups = new Map<string, RatchetGroup>();
  for (const target of targets) {
    const ratchet = ratchetById.get(target.testId);
    // Defense in depth: apply the same edit-time eligibility policy as discovery
    // in case a stale or hand-written target file names an ineligible ratchet.
    if (ratchet === undefined || !isEligibleEditCheckRatchet(ratchet)) continue;
    // The wire ruleId must match the registry ratchet found by testId. A
    // hand-written or stale target file that pairs a real testId with the wrong
    // ruleId is soft-skipped rather than linted against a mismatched floor.
    if (target.ruleId !== ratchet.ruleId) continue;
    const test = baseline.tests[target.testId];
    if (test === undefined) continue;
    const ruleSourceHash = ruleSourceHashesById.get(target.testId);
    if (ruleSourceHash === undefined) continue;
    if (validateBaselineTestForRatchet(target.testId, test, ratchet, ruleSourceHash).length > 0) {
      continue;
    }
    let group = groups.get(target.testId);
    if (group === undefined) {
      group = { ratchet, ruleSourceHash, files: [] };
      groups.set(target.testId, group);
    }
    if (!group.files.includes(target.path)) group.files.push(target.path);
  }
  return [...groups.values()];
}

// One (file, ratchet) lint outcome: its regressions plus the files that were
// actually linted (so a caller can tell a real "no regressions" result from a
// soft skip that never ran ESLint).
interface GroupResult {
  readonly regressions: EditCheckRegression[];
  readonly checked: readonly string[];
}

export interface EditCheckResult {
  readonly regressions: readonly EditCheckRegression[];
  // Edited files for which ESLint actually ran (a successfully-linted group).
  // Excludes drift/missing-baseline soft skips and mid-edit parse failures, so
  // the hook only content-caches bytes it genuinely checked.
  readonly checked: readonly string[];
}

async function regressionsForGroup(
  group: RatchetGroup,
  baseline: LintRatchetBaseline,
  binding: LintRatchetEngineBinding,
): Promise<GroupResult> {
  // A mid-edit file that fails to parse throws here; treat it as a soft skip
  // (no rows, not checked) rather than a regression — the byte source is the
  // working tree.
  let items: ReadonlyMap<string, LintRatchetCurrentItem>;
  try {
    items = await collectCurrentForRatchet(
      group.ratchet,
      group.ruleSourceHash,
      group.files,
      binding,
    );
  } catch {
    return { regressions: [], checked: [] };
  }
  const currentById = new Map([[group.ratchet.id, items]]);
  const comparison = compareCurrentToBaseline(baseline, [group.ratchet], currentById);
  const regressions = comparison.regressions.map((regression) => ({
    path: regression.path,
    testId: regression.testId,
    ruleId: regression.ruleId,
    reason: regression.reason,
    ...(regression.line === undefined ? {} : { line: regression.line }),
    baselineCount: regression.baselineCount,
    currentCount: regression.currentCount,
  }));
  return { regressions, checked: group.files };
}

async function runGroupsWithConcurrency(
  groups: readonly RatchetGroup[],
  concurrency: number,
  baseline: LintRatchetBaseline,
  binding: LintRatchetEngineBinding,
): Promise<EditCheckResult> {
  const regressions: EditCheckRegression[] = [];
  const checked: string[] = [];
  const limit = Math.max(1, Math.min(concurrency, groups.length));
  let index = 0;
  async function worker(): Promise<void> {
    while (index < groups.length) {
      const group = groups[index];
      index += 1;
      if (group === undefined) continue;
      const result = await regressionsForGroup(group, baseline, binding);
      regressions.push(...result.regressions);
      checked.push(...result.checked);
    }
  }
  await Promise.all(Array.from({ length: limit }, async () => worker()));
  return { regressions, checked };
}

// Lint only the targeted (edited file, ratchet) pairs. A missing or
// structurally-invalid baseline yields no rows (a soft skip) so the edit-time
// hook never reports a false regression. `checked` reports which files actually
// ran ESLint, distinct from "linted with no regressions".
export async function runEditCheckRegressions(
  engine: LintRatchetEditCheckEngine,
  targets: readonly EditCheckTarget[],
  concurrency: number,
): Promise<EditCheckResult> {
  if (targets.length === 0) return { regressions: [], checked: [] };
  if (!existsSync(engine.baselinePath)) return { regressions: [], checked: [] };
  const structural = parseLintRatchetBaselineStructure(readFileSync(engine.baselinePath, "utf8"));
  if (structural.baseline === undefined) return { regressions: [], checked: [] };
  const groups = groupTargets(engine, targets, structural.baseline);
  const result = await runGroupsWithConcurrency(
    groups,
    concurrency,
    structural.baseline,
    engine.binding,
  );
  return { regressions: [...result.regressions].sort(byPathThenTestId), checked: result.checked };
}
