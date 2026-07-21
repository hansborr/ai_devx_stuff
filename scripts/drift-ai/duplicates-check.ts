import { type CheckRunContext, type CheckServiceEnv, defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiDuplicatesConfig, DriftAiIgnoreConfig } from "./config.js";
import { globsForIgnoredPaths } from "./config-match.js";
import { DEFAULT_DUPLICATES_IGNORE_GLOBS, JSCPD_SUPPORTED_EXTENSIONS } from "./duplicates.js";
import { duplicatesCheckConfig } from "./duplicates-check-config.js";
import { defaultJscpdRunner, type JscpdRunner, runDuplicatesCheck } from "./duplicates-runner.js";
import { resolveJscpdBin } from "./jscpd-bin.js";
import { isWholeRepoRoots, uniqSorted } from "./path-util.js";

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
      ...(config.minTokens === undefined ? {} : { minTokens: config.minTokens }),
      ...(config.mode === undefined ? {} : { mode: config.mode }),
      ignoreGlobs:
        ctx.detectorScope.scopeMode === "current"
          ? currentDuplicateIgnoreGlobs(ctx, config)
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

function currentDuplicateIgnoreGlobs(
  ctx: CheckRunContext,
  config: DriftAiDuplicatesConfig,
): string[] {
  return [
    ...DEFAULT_DUPLICATES_IGNORE_GLOBS,
    ...currentUniversalIgnoreGlobs(ctx.roots, ctx.config.ignore),
    ...config.excludeGlobs,
  ];
}

function currentUniversalIgnoreGlobs(
  roots: readonly string[],
  ignore: DriftAiIgnoreConfig,
): string[] {
  if (isWholeRepoRoots(roots)) return globsForIgnoredPaths(ignore);
  return uniqSorted(roots.flatMap((root) => rootRelativeIgnoreGlobs(root, ignore)));
}

function rootRelativeIgnoreGlobs(root: string, ignore: DriftAiIgnoreConfig): string[] {
  return [
    ...ignore.segments.map((segment) => `${root}/**/${segment}/**`),
    ...ignore.prefixes.map((prefix) => `${root}/${prefix.endsWith("/") ? prefix : `${prefix}/`}**`),
    ...ignore.globs.map((glob) => `${root}/${trimLeadingDotSlash(glob)}`),
  ];
}

function trimLeadingDotSlash(value: string): string {
  let out = value;
  while (out.startsWith("./")) out = out.slice(2);
  return out;
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

// Resolve the jscpd executable from an explicit --jscpd-bin override, the tools
// checkout, or the target repo. An injected runner wins as-is. This only runs when
// the duplicates check is selected (plugins resolve their own services lazily), so
// an unrelated run never resolves or spawns jscpd. When jscpd resolves nowhere the
// runner is a placeholder and the check skips with a reason during preflight
// rather than emitting a failure finding.
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
  return {
    jscpd: unresolvedJscpdRunner(),
    jscpdUnavailableReason: jscpdUnavailableMessage(resolution.searched, env.cli.jscpdBin ?? null),
  };
}

// Placeholder for when jscpd is unresolved: the duplicates check skips in preflight
// in that case, so this is never actually invoked. Returns a clear error defensively.
function unresolvedJscpdRunner(): JscpdRunner {
  return () => ({ ok: false, error: "jscpd executable was not resolved" });
}

function jscpdUnavailableMessage(searched: readonly string[], override: string | null): string {
  const searchedText = searched.length === 0 ? "no candidate paths" : searched.join(", ");
  if (override !== null) {
    return `drift:ai: jscpd executable not found at --jscpd-bin path (searched ${searchedText}); skipping the duplicates check. Pass a valid --jscpd-bin path, or omit --jscpd-bin to use the tools checkout/target lookup.`;
  }
  return `drift:ai: jscpd executable not found (searched ${searchedText}); skipping the duplicates check. Run \`bun install\` in the drift:ai tools checkout, or pass --jscpd-bin <path>.`;
}
