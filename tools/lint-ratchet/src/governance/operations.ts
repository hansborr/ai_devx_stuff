// Neutral gate/update application operations (leaf 13 "In scope now" slice).
//
// Governance-layer functions, data in → data out: each takes the injected
// engine context/binding plus the adapter's registry and returns result data.
// They own the ordering invariants both adapters used to hand-copy — rule-source
// hashes → collect current → build/compare → round-trip-validate the rendered
// generated baseline → gated apply — so an adapter cannot skip or reorder a
// step (the demo's missing round-trip validation disappeared by construction).
// Everything CLI-shaped stays adapter-side: no argv parsing, no mode dispatch,
// no result envelopes, no exit codes, no registry preflight policy.
import { existsSync, readFileSync } from "node:fs";

import {
  buildLintRatchetBaseline,
  compareCurrentToBaseline,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetComparison,
  type LintRatchetCurrentById,
  type LintRatchetRuleSourceHashesById,
  parseLintRatchetBaseline,
} from "../kernel/baseline.js";
import type { LintRatchetConfig } from "../kernel/config-types.js";
import { collectCurrentById, totalCurrentCount } from "../kernel/current-collector.js";
import {
  type LintRatchetEngineBinding,
  type LintRatchetEngineContext,
  relativeToRepoRoot,
} from "../kernel/engine-context.js";
import { ConfigError } from "../kernel/metrics-types.js";
import { buildRuleSourceHashesById } from "../kernel/rule-source.js";
import {
  applyLintRatchetUpdate,
  type ApplyLintRatchetUpdateOptions,
} from "./baseline-update-apply.js";
import { BaselineParseError, MissingBaselineError } from "./errors.js";

/**
 * The injected engine surface both operations run against: the resolved
 * context (baseline/debt-log paths), the collection binding, and the adapter's
 * ratchet registry. `collectConcurrency` bounds the parallel ESLint sweeps and
 * defaults to the collector's own default.
 */
export interface LintRatchetOperationEngine {
  readonly context: LintRatchetEngineContext;
  readonly binding: LintRatchetEngineBinding;
  readonly registry: readonly LintRatchetConfig[];
  readonly collectConcurrency?: number;
}

// The collect step both operations share. Rule-source hashes are computed
// FIRST (they key both the baseline codec and the collector's cache identity)
// and passed in, so the gate can parse the committed baseline against the same
// hashes before spending an ESLint sweep.
async function collectCurrent(
  engine: LintRatchetOperationEngine,
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): Promise<LintRatchetCurrentById> {
  return collectCurrentById({
    ruleSourceHashesById,
    ratchets: engine.registry,
    binding: engine.binding,
    ...(engine.collectConcurrency === undefined ? {} : { concurrency: engine.collectConcurrency }),
  });
}

export interface LintRatchetGateResult {
  readonly comparison: LintRatchetComparison;
  readonly currentFindingCount: number;
  /** Non-blocking parse warnings on the committed baseline; render or drop them adapter-side. */
  readonly baselineWarnings: readonly string[];
}

function parseCommittedBaseline(
  engine: LintRatchetOperationEngine,
  ruleSourceHashesById: LintRatchetRuleSourceHashesById,
): { readonly baseline: LintRatchetBaseline; readonly warnings: readonly string[] } {
  const { repoRoot, baselinePath } = engine.context;
  if (!existsSync(baselinePath)) {
    // Recovery messaging (which command regenerates the baseline) is the
    // adapter's runner invocation, so the typed error carries only the data.
    throw new MissingBaselineError(relativeToRepoRoot(repoRoot, baselinePath));
  }
  const parsed = parseLintRatchetBaseline(
    readFileSync(baselinePath, "utf8"),
    engine.registry,
    ruleSourceHashesById,
    {
      workflowVocabulary: engine.context.workflowVocabulary,
      baselineFile: relativeToRepoRoot(repoRoot, baselinePath),
    },
  );
  if (parsed.baseline === undefined) {
    throw new BaselineParseError(parsed.failures, parsed.warnings);
  }
  return { baseline: parsed.baseline, warnings: parsed.warnings };
}

/**
 * The symmetric gate: parse the committed baseline (fail loud BEFORE spending
 * an ESLint sweep — `MissingBaselineError` when it is absent,
 * `BaselineParseError` carrying failures + warnings when it is unparseable),
 * collect current findings, and compare. Pure result data — the adapter
 * decides how to render the comparison, what recovery text a failure gets,
 * and what exit status a delta maps to.
 */
export async function runLintRatchetGate(
  engine: LintRatchetOperationEngine,
): Promise<LintRatchetGateResult> {
  const ruleSourceHashesById = buildRuleSourceHashesById(engine.registry, engine.binding);
  const parsed = parseCommittedBaseline(engine, ruleSourceHashesById);
  const currentById = await collectCurrent(engine, ruleSourceHashesById);
  return {
    comparison: compareCurrentToBaseline(
      parsed.baseline,
      engine.registry,
      currentById,
      engine.context.workflowVocabulary,
    ),
    currentFindingCount: totalCurrentCount(currentById),
    baselineWarnings: parsed.warnings,
  };
}

export interface LintRatchetUpdateResult {
  readonly currentFindingCount: number;
  /** True when an accepted-debt record was appended to the debt log. */
  readonly recordedDebt: boolean;
}

export interface RunLintRatchetUpdateParams extends LintRatchetOperationEngine {
  readonly options: ApplyLintRatchetUpdateOptions;
}

/**
 * The regeneration path: collect current findings, build and render the
 * generated baseline, fail closed unless the rendered text round-trips through
 * the parser against the same registry and hashes (formatter/parser drift must
 * abort before anything is written), then hand off to the gated apply — which
 * refuses a worse baseline without `allowWorse` and records accepted debt
 * before the single atomic baseline write.
 */
export async function runLintRatchetUpdate(
  params: RunLintRatchetUpdateParams,
): Promise<LintRatchetUpdateResult> {
  const ruleSourceHashesById = buildRuleSourceHashesById(params.registry, params.binding);
  const currentById = await collectCurrent(params, ruleSourceHashesById);
  const baselineFile = relativeToRepoRoot(params.context.repoRoot, params.context.baselinePath);
  const generated = buildLintRatchetBaseline(params.registry, currentById, ruleSourceHashesById, {
    workflowVocabulary: params.context.workflowVocabulary,
  });
  const rendered = formatLintRatchetBaseline(generated, params.context.workflowVocabulary);
  const parsedGenerated = parseLintRatchetBaseline(
    rendered,
    params.registry,
    ruleSourceHashesById,
    {
      workflowVocabulary: params.context.workflowVocabulary,
      baselineFile,
    },
  );
  if (parsedGenerated.baseline === undefined) {
    throw new ConfigError(
      `generated baseline failed validation:\n${parsedGenerated.failures.join("\n")}`,
    );
  }
  const currentFindingCount = totalCurrentCount(currentById);
  const recordedDebt = applyLintRatchetUpdate({
    context: params.context,
    generated,
    rendered,
    registry: params.registry,
    options: params.options,
    currentFindingCount,
  });
  return { currentFindingCount, recordedDebt };
}
