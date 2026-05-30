import { type CheckRunContext, type CheckServiceEnv, defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiDuplicatesConfig } from "./config.js";
import { globsForIgnoredPaths } from "./config-match.js";
import { DEFAULT_DUPLICATES_IGNORE_GLOBS, JSCPD_SUPPORTED_EXTENSIONS } from "./duplicates.js";
import { duplicatesCheckConfig } from "./duplicates-check-config.js";
import { defaultJscpdRunner, type JscpdRunner, runDuplicatesCheck } from "./duplicates-runner.js";
import { resolveJscpdBin } from "./jscpd-bin.js";

// jscpd runner plus the reason (if any) it could not be resolved. A null reason
// means the runner is usable; a non-null reason means the duplicates check skips
// (never a finding) during preflight.
type DuplicatesServices = {
  readonly jscpd: JscpdRunner;
  readonly jscpdUnavailableReason: string | null;
};

export const duplicatesCheck = defineCheckPlugin<
  DriftAiDuplicatesConfig,
  DuplicatesServices,
  "duplicates"
>({
  ...duplicatesCheckConfig,
  resolveServices: resolveJscpdSetup,
  preflight: (ctx) => {
    warnForUnsupportedDuplicateExtensions(ctx);
    if (ctx.services.jscpdUnavailableReason === null) return undefined;
    ctx.warnStderr(ctx.services.jscpdUnavailableReason);
    return ctx.services.jscpdUnavailableReason;
  },
  run: (ctx, config) => {
    const findings = runDuplicatesCheck({
      detectorScope: ctx.detectorScope,
      runner: ctx.services.jscpd,
      roots: ctx.roots,
      duplicateSupportedExtensions: JSCPD_SUPPORTED_EXTENSIONS,
      ...(config.minLines === undefined ? {} : { minLines: config.minLines }),
      ignoreGlobs:
        ctx.detectorScope.scopeMode === "current"
          ? currentDuplicateIgnoreGlobs(config)
          : duplicateIgnoreGlobs(ctx, config),
      ...(ctx.detectorScope.scopeMode === "current"
        ? {
            regularFileInventoryCount: ctx.detectorScope.files.length,
            warnStderr: ctx.warnStderr,
          }
        : {}),
    });
    return { status: "ran", findings };
  },
});

function duplicateIgnoreGlobs(ctx: CheckRunContext, config: DriftAiDuplicatesConfig): string[] {
  return [
    ...DEFAULT_DUPLICATES_IGNORE_GLOBS,
    ...globsForIgnoredPaths(ctx.config.ignore),
    ...config.excludeGlobs,
  ];
}

function currentDuplicateIgnoreGlobs(config: DriftAiDuplicatesConfig): string[] {
  return [...DEFAULT_DUPLICATES_IGNORE_GLOBS, ...config.excludeGlobs];
}

function warnForUnsupportedDuplicateExtensions(ctx: CheckRunContext): void {
  const unsupported = ctx.config.additionalSourceExtensions.filter(
    (extension) => !JSCPD_SUPPORTED_EXTENSIONS.has(extension),
  );
  if (unsupported.length === 0) return;
  ctx.warnStderr(
    `drift:ai: configured additionalSourceExtensions [${unsupported.join(", ")}] are not covered by jscpd; duplicates will not flag them.`,
  );
}

// Resolve the jscpd executable from the tools checkout (primary), the target repo,
// or an explicit --jscpd-bin override. An injected runner wins as-is. This only
// runs when the duplicates check is selected (plugins resolve their own services
// lazily), so an unrelated run never resolves or spawns jscpd. When jscpd resolves
// nowhere the runner is a placeholder and the check skips with a reason during
// preflight rather than emitting a failure finding.
function resolveJscpdSetup(env: CheckServiceEnv): DuplicatesServices {
  if (env.overrides.jscpd !== undefined) {
    return { jscpd: env.overrides.jscpd, jscpdUnavailableReason: null };
  }
  const resolution = resolveJscpdBin({
    analyzedRepoRoot: env.repoRoot,
    ...(env.overrides.binExists === undefined ? {} : { fileExists: env.overrides.binExists }),
    ...(env.cli.jscpdBin === undefined ? {} : { override: env.cli.jscpdBin }),
  });
  if (resolution.found) {
    return {
      jscpd: defaultJscpdRunner({ analyzedRepoRoot: env.repoRoot, jscpdBin: resolution.binPath }),
      jscpdUnavailableReason: null,
    };
  }
  return { jscpd: unresolvedJscpdRunner(), jscpdUnavailableReason: jscpdUnavailableMessage() };
}

// Placeholder for when jscpd is unresolved: the duplicates check skips in preflight
// in that case, so this is never actually invoked. Returns a clear error defensively.
function unresolvedJscpdRunner(): JscpdRunner {
  return () => ({ ok: false, error: "jscpd executable was not resolved" });
}

function jscpdUnavailableMessage(): string {
  return "drift:ai: jscpd executable not found in the tools checkout or the target repo; skipping the duplicates check. Run `bun install` in the drift:ai tools checkout, or pass --jscpd-bin <path>.";
}
