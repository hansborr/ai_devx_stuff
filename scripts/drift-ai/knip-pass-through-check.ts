import { defaultPathProbe, detectTargetInstall } from "./adapter-support.js";
import {
  type CheckConfigMetadata,
  type CheckOutcome,
  type CheckPlugin,
  type CheckRunContext,
  type CheckServiceEnv,
  defineCheckPlugin,
  type PreflightSkip,
} from "./check-plugin.js";
import { defaultFileReader } from "./comments.js";
import {
  buildKnipDiagnosticFinding,
  buildProvenance,
  knipUnreadableMessage,
  type OrphanFilesServices,
  resolveKnipConfig,
  targetNotInstalledReason,
  toolNotInstalledReason,
  toolTimedOutReason,
} from "./knip-orphan-files.js";
import {
  type KnipRunner,
  memoizingDefaultKnipRunner,
  resolveKnipBin,
  resolveKnipIncludeCategories,
  unresolvedKnipRunner,
} from "./knip-runner.js";
import type { DriftCheckId, DriftFinding, FindingProvenance } from "./types.js";

export type KnipPassThroughServices = OrphanFilesServices;

type KnipReportParseSuccess = { readonly ok: true };

type KnipReportParseFailure = { readonly ok: false; readonly error: string };

type KnipPassThroughCheckOptions<
  C,
  Id extends DriftCheckId,
  TParsed extends KnipReportParseSuccess,
> = CheckConfigMetadata<C, Id> & {
  readonly parseReport: (jsonText: string) => TParsed | KnipReportParseFailure;
  readonly buildFindings: (
    parsed: TParsed,
    ctx: CheckRunContext<KnipPassThroughServices>,
    provenance: FindingProvenance,
  ) => readonly DriftFinding[];
};

export function defineKnipPassThroughCheck<
  C,
  Id extends DriftCheckId,
  TParsed extends KnipReportParseSuccess,
>(
  options: KnipPassThroughCheckOptions<C, Id, TParsed>,
): CheckPlugin<C, KnipPassThroughServices, Id> {
  const { parseReport, buildFindings, ...metadata } = options;
  return defineCheckPlugin<C, KnipPassThroughServices, Id>({
    ...metadata,
    resolveServices: resolveKnipServices,
    preflight: knipPassThroughPreflight,
    run: (ctx) =>
      runKnipPassThroughCheck(ctx, {
        checkId: metadata.id,
        parseReport,
        buildFindings,
      }),
  });
}

function resolveKnipServices(env: CheckServiceEnv): KnipPassThroughServices {
  return {
    knip: resolveKnipRunner(env),
    pathExists: env.overrides.pathExists ?? defaultPathProbe(env.repoRoot),
    readFile: env.overrides.readFile ?? defaultFileReader(env.repoRoot),
    knipConfigOverride: env.cli.knipConfig ?? null,
  };
}

function knipPassThroughPreflight(
  ctx: CheckRunContext<KnipPassThroughServices>,
): PreflightSkip | undefined {
  const resolution = resolveKnipConfig(ctx);
  if (resolution.kind === "skip") return { reason: resolution.reason, code: resolution.code };
  if (!detectTargetInstall(ctx.services.pathExists)) {
    return {
      reason: targetNotInstalledReason(),
      code: "target-not-installed",
    };
  }
  return undefined;
}

// Resolve the knip executable from the tools checkout (primary), the target repo,
// or the injected runner. An injected runner wins as-is. This only runs when a
// knip-backed check is selected (plugins resolve their own services lazily), so
// unrelated runs never resolve or spawn knip. When knip resolves nowhere the
// runner reports `tool-unavailable`, which the adapter maps to a
// `tool-not-installed` skip after config / install preflight passes.
function resolveKnipRunner(env: CheckServiceEnv): KnipRunner {
  if (env.overrides.knip !== undefined) return env.overrides.knip;
  const resolution = resolveKnipBin({
    analyzedRepoRoot: env.repoRoot,
    ...(env.overrides.binExists === undefined ? {} : { fileExists: env.overrides.binExists }),
  });
  if (resolution.found) {
    return memoizingDefaultKnipRunner({
      analyzedRepoRoot: env.repoRoot,
      includeCategories: resolveKnipIncludeCategories(env.cli.checks),
      knipBin: resolution.binPath,
    });
  }
  return unresolvedKnipRunner(`searched ${resolution.searched.join(", ")}`);
}

type RunKnipPassThroughCheckOptions<TParsed extends KnipReportParseSuccess> = {
  readonly checkId: DriftCheckId;
  readonly parseReport: (jsonText: string) => TParsed | KnipReportParseFailure;
  readonly buildFindings: (
    parsed: TParsed,
    ctx: CheckRunContext<KnipPassThroughServices>,
    provenance: FindingProvenance,
  ) => readonly DriftFinding[];
};

function runKnipPassThroughCheck<TParsed extends KnipReportParseSuccess>(
  ctx: CheckRunContext<KnipPassThroughServices>,
  options: RunKnipPassThroughCheckOptions<TParsed>,
): CheckOutcome {
  const resolution = resolveKnipConfig(ctx);
  // Defensive: preflight already gated this, but `run` re-resolves to recover the
  // config path/source without threading shared state through the plugin.
  if (resolution.kind === "skip") {
    return { status: "skipped", reason: resolution.reason, code: resolution.code };
  }

  const result = ctx.services.knip({ configPath: resolution.configPath });
  if (!result.ok) return outcomeFromKnipFailure(result, options.checkId, resolution.displayPath);

  const parsed = options.parseReport(result.reportJson);
  if (!parsed.ok) {
    return {
      status: "ran",
      findings: [
        buildKnipDiagnosticFinding(
          resolution.displayPath,
          knipUnreadableMessage(parsed.error, result.exitCode, result.stderr),
          options.checkId,
        ),
      ],
    };
  }

  return {
    status: "ran",
    findings: options.buildFindings(parsed, ctx, buildProvenance(resolution)),
  };
}

function outcomeFromKnipFailure(
  result: Exclude<ReturnType<KnipRunner>, { readonly ok: true }>,
  checkId: DriftCheckId,
  displayPath: string,
): CheckOutcome {
  if (result.reason === "tool-unavailable") {
    return {
      status: "skipped",
      reason: toolNotInstalledReason(result.error),
      code: "tool-not-installed",
    };
  }
  if (result.reason === "timeout") {
    return {
      status: "skipped",
      reason: toolTimedOutReason(result.error),
      code: "tool-timeout",
    };
  }
  return {
    status: "ran",
    findings: [
      buildKnipDiagnosticFinding(displayPath, `knip subprocess failed (${result.error})`, checkId),
    ],
  };
}
