// The orphan-files CheckPlugin: a Tier-1 pass-through adapter over the target's
// own knip. Config-discovery + install-detection happen in preflight (the skip
// path is the headline foreign-repo case); the knip subprocess runs in `run`.

import { defaultPathProbe, detectTargetInstall } from "./adapter-support.js";
import {
  type CheckOutcome,
  type CheckRunContext,
  type CheckServiceEnv,
  defineCheckPlugin,
} from "./check-plugin.js";
import { defaultFileReader } from "./comments.js";
import {
  buildKnipDiagnosticFinding,
  buildOrphanFindings,
  buildProvenance,
  knipUnreadableMessage,
  type OrphanFilesServices,
  parseKnipOrphanFiles,
  resolveKnipConfig,
  targetNotInstalledReason,
  toolNotInstalledReason,
} from "./knip-orphan-files.js";
import {
  orphanFilesCheckConfig,
  type OrphanFilesConfig,
} from "./knip-orphan-files-check-config.js";
import {
  defaultKnipRunner,
  type KnipRunner,
  resolveKnipBin,
  unresolvedKnipRunner,
} from "./knip-runner.js";

export const orphanFilesCheck = defineCheckPlugin<
  OrphanFilesConfig,
  OrphanFilesServices,
  "orphan-files"
>({
  ...orphanFilesCheckConfig,
  resolveServices: (env) => ({
    knip: resolveKnipRunner(env),
    pathExists: env.overrides.pathExists ?? defaultPathProbe(env.repoRoot),
    readFile: env.overrides.readFile ?? defaultFileReader(env.repoRoot),
    knipConfigOverride: env.cli.knipConfig ?? null,
  }),
  preflight: (ctx) => {
    const resolution = resolveKnipConfig(ctx);
    if (resolution.kind === "skip") return { reason: resolution.reason, code: resolution.code };
    // knip needs the target's installed modules to tell an orphan from a
    // merely-unresolved import; an uninstalled target is an expected absence.
    if (!detectTargetInstall(ctx.services.pathExists)) {
      return { reason: targetNotInstalledReason(), code: "target-not-installed" };
    }
    return undefined;
  },
  run: runOrphanFilesCheck,
});

// Resolve the knip executable from the tools checkout (primary), the target repo,
// or the injected runner. An injected runner wins as-is. This only runs when
// orphan-files is selected (plugins resolve their own services lazily), so an
// unrelated run never resolves or spawns knip. When knip resolves nowhere the
// runner reports `tool-unavailable`, which the adapter maps to a
// `tool-not-installed` skip (never a finding) — but only after its config /
// install preflight passes.
function resolveKnipRunner(env: CheckServiceEnv): KnipRunner {
  if (env.overrides.knip !== undefined) return env.overrides.knip;
  const resolution = resolveKnipBin({
    analyzedRepoRoot: env.repoRoot,
    ...(env.overrides.binExists === undefined ? {} : { fileExists: env.overrides.binExists }),
  });
  if (resolution.found) {
    return defaultKnipRunner({ analyzedRepoRoot: env.repoRoot, knipBin: resolution.binPath });
  }
  return unresolvedKnipRunner(`searched ${resolution.searched.join(", ")}`);
}

function runOrphanFilesCheck(ctx: CheckRunContext<OrphanFilesServices>): CheckOutcome {
  const resolution = resolveKnipConfig(ctx);
  // Defensive: preflight already gated this, but `run` re-resolves to recover the
  // config path/source without threading shared state through the plugin.
  if (resolution.kind === "skip") {
    return { status: "skipped", reason: resolution.reason, code: resolution.code };
  }

  const result = ctx.services.knip({ configPath: resolution.configPath });
  if (!result.ok) {
    if (result.reason === "tool-unavailable") {
      return {
        status: "skipped",
        reason: toolNotInstalledReason(result.error),
        code: "tool-not-installed",
      };
    }
    return {
      status: "ran",
      findings: [
        buildKnipDiagnosticFinding(
          resolution.displayPath,
          `knip subprocess failed (${result.error})`,
        ),
      ],
    };
  }

  const parsed = parseKnipOrphanFiles(result.reportJson);
  if (!parsed.ok) {
    return {
      status: "ran",
      findings: [
        buildKnipDiagnosticFinding(
          resolution.displayPath,
          knipUnreadableMessage(parsed.error, result.exitCode, result.stderr),
        ),
      ],
    };
  }

  const provenance = buildProvenance(resolution);
  return {
    status: "ran",
    findings: buildOrphanFindings(parsed.files, ctx.detectorScope, provenance),
  };
}
