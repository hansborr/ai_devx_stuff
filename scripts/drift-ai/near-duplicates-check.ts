// The near-duplicates CheckPlugin: a measurement-ish adapter over
// drift:ai-authored function similarity thresholds. Default engine is in-process
// ts-morph; optional similarity-ts is selected by config and skips cleanly when
// the Rust binary is absent.

import type { CheckOutcome, CheckRunContext } from "./check-plugin.js";
import { defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiNearDuplicatesConfig } from "./config.js";
import {
  buildNearDuplicateDiagnosticFinding,
  buildNearDuplicateFindings,
  findNearDuplicatePairs,
  NEAR_DUPLICATE_TOOL,
} from "./near-duplicates.js";
import {
  nearDuplicateExcludeGlobs,
  nearDuplicatesCheckConfig,
} from "./near-duplicates-check-config.js";
import { defaultNearDuplicateRunner, type NearDuplicateRunner } from "./near-duplicates-runner.js";

type NearDuplicatesServices = { readonly nearDuplicates: NearDuplicateRunner };

export const nearDuplicatesCheck = defineCheckPlugin<
  DriftAiNearDuplicatesConfig,
  NearDuplicatesServices,
  "near-duplicates"
>({
  ...nearDuplicatesCheckConfig,
  resolveServices: (env) => ({
    nearDuplicates: env.overrides.nearDuplicates ?? defaultNearDuplicateRunner(),
  }),
  run: runNearDuplicatesCheck,
});

function runNearDuplicatesCheck(
  ctx: CheckRunContext<NearDuplicatesServices>,
  config: DriftAiNearDuplicatesConfig,
): CheckOutcome {
  const result = ctx.services.nearDuplicates({
    repoRoot: ctx.repoRoot,
    roots: ctx.roots,
    sourceExtensions: ctx.sourceExtensions,
    ignore: ctx.config.ignore,
    excludeGlobs: nearDuplicateExcludeGlobs(ctx.config.ignore, config),
    engine: config.engine,
    minLines: config.minLines,
    minTokens: config.minTokens,
    similarityThreshold: config.similarityThreshold,
  });
  if (!result.ok) return outcomeForRunnerFailure(result);

  const pairs =
    result.engine === NEAR_DUPLICATE_TOOL
      ? findNearDuplicatePairs(result.functions, config)
      : result.pairs;
  const provenance = { configSource: "drift-baseline", tool: result.engine } as const;
  return {
    status: "ran",
    findings: buildNearDuplicateFindings(pairs, ctx.detectorScope, provenance),
  };
}

function outcomeForRunnerFailure(
  result: Extract<ReturnType<NearDuplicateRunner>, { readonly ok: false }>,
): CheckOutcome {
  if (result.reason === "tool-unavailable") {
    return {
      status: "skipped",
      reason:
        "similarity-ts executable not found on PATH; install it with `cargo install similarity-ts`, or use the default ts-morph engine.",
      code: "tool-not-installed",
    };
  }
  return {
    status: "ran",
    findings: [buildNearDuplicateDiagnosticFinding(result.error)],
  };
}
