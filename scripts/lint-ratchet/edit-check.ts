import { existsSync, readFileSync } from "node:fs";

import {
  compareCurrentToBaseline,
  computeLintRatchetConfigHash,
  type LintRatchetBaseline,
  type LintRatchetCurrentItem,
  parseLintRatchetBaselineStructure,
} from "../lint-ratchet-baseline.js";
import { lintRatchets, type LintRatchetConfig } from "../lint-ratchet-config.js";
import { collectCurrentForRatchet } from "./current-collector.js";
import { usesEslintCache } from "./eslint-config.js";
import { baselinePath, relativePath } from "./paths.js";
import { matchesRatchet } from "./ratchet-globs.js";
import { buildRuleSourceHashesById } from "./rule-source.js";

// One (edited file, cacheable ratchet) pair the edit-time hook may check.
export interface EditCheckTarget {
  readonly path: string;
  readonly testId: string;
  readonly ruleId: string;
}

export interface EditCheckRegression {
  readonly path: string;
  readonly testId: string;
  readonly ruleId: string;
  readonly reason: string;
  readonly line?: number;
  readonly baselineCount: number;
  readonly currentCount: number;
}

function byPathThenTestId(
  left: { readonly path: string; readonly testId: string },
  right: { readonly path: string; readonly testId: string },
): number {
  return left.path.localeCompare(right.path) || left.testId.localeCompare(right.testId);
}

// Discovery: the minimal-TS (cache-using) ratchets whose globs match each edited
// path. Type-aware ratchets are intentionally excluded from edit-time checks —
// they rebuild a TS program and are too expensive for the hot path. Ordering is
// deterministic (path then ratchet id) so the hook's per-target caps are stable.
export function discoverEditCheckTargets(paths: readonly string[]): EditCheckTarget[] {
  const targets: EditCheckTarget[] = [];
  const seen = new Set<string>();
  for (const rawPath of paths) {
    const path = relativePath(rawPath);
    for (const ratchet of lintRatchets) {
      if (!usesEslintCache(ratchet)) continue;
      if (!matchesRatchet(ratchet, path)) continue;
      const key = `${path}\t${ratchet.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ path, testId: ratchet.id, ruleId: ratchet.ruleId });
    }
  }
  return targets.sort(byPathThenTestId);
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
  targets: readonly EditCheckTarget[],
  baseline: LintRatchetBaseline,
): RatchetGroup[] {
  const ratchetById = new Map(lintRatchets.map((ratchet) => [ratchet.id, ratchet]));
  const ruleSourceHashesById = buildRuleSourceHashesById(lintRatchets);
  const groups = new Map<string, RatchetGroup>();
  for (const target of targets) {
    const ratchet = ratchetById.get(target.testId);
    if (ratchet === undefined || !usesEslintCache(ratchet)) continue;
    const test = baseline.tests[target.testId];
    if (test === undefined) continue;
    const ruleSourceHash = ruleSourceHashesById.get(target.testId);
    if (ruleSourceHash === undefined) continue;
    if (test.configHash !== computeLintRatchetConfigHash(ratchet)) continue;
    if (test.ruleSourceHash !== ruleSourceHash) continue;
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
): Promise<GroupResult> {
  // A mid-edit file that fails to parse throws here; treat it as a soft skip
  // (no rows, not checked) rather than a regression — the byte source is the
  // working tree.
  let items: ReadonlyMap<string, LintRatchetCurrentItem>;
  try {
    items = await collectCurrentForRatchet(group.ratchet, group.ruleSourceHash, group.files);
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
      const result = await regressionsForGroup(group, baseline);
      regressions.push(...result.regressions);
      checked.push(...result.checked);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return { regressions, checked };
}

// Lint only the targeted (edited file, ratchet) pairs. A missing or
// structurally-invalid baseline yields no rows (a soft skip) so the edit-time
// hook never reports a false regression. `checked` reports which files actually
// ran ESLint, distinct from "linted with no regressions".
export async function runEditCheckRegressions(
  targets: readonly EditCheckTarget[],
  concurrency: number,
): Promise<EditCheckResult> {
  if (targets.length === 0) return { regressions: [], checked: [] };
  if (!existsSync(baselinePath)) return { regressions: [], checked: [] };
  const structural = parseLintRatchetBaselineStructure(readFileSync(baselinePath, "utf8"));
  if (structural.baseline === undefined) return { regressions: [], checked: [] };
  const groups = groupTargets(targets, structural.baseline);
  const result = await runGroupsWithConcurrency(groups, concurrency, structural.baseline);
  return { regressions: [...result.regressions].sort(byPathThenTestId), checked: result.checked };
}
