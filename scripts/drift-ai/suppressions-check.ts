import { type CheckOverrides, defineCheckPlugin } from "./check-plugin.js";
import { defaultFileReader, type FileReader } from "./comments.js";
import type { GitRunner } from "./git-changed-scope.js";
import {
  defaultSuppressionsGitRunner,
  runSuppressionsCheck,
  type SuppressionsGitRunner,
} from "./suppressions.js";
import { suppressionsCheckConfig, type SuppressionsConfig } from "./suppressions-check-config.js";

type SuppressionsServices = {
  readonly suppressionsGit: SuppressionsGitRunner;
  readonly readFile: FileReader;
};

export const suppressionsCheck = defineCheckPlugin<
  SuppressionsConfig,
  SuppressionsServices,
  "suppressions"
>({
  ...suppressionsCheckConfig,
  resolveServices: (env) => ({
    suppressionsGit: resolveSuppressionsGit(env.overrides),
    readFile: env.overrides.readFile ?? defaultFileReader(env.repoRoot),
  }),
  preflight: (ctx) =>
    ctx.detectorScope.scopeMode === "current" ? "only available in changed scope" : undefined,
  run: (ctx) => {
    const findings = runSuppressionsCheck({
      detectorScope: ctx.detectorScope,
      repoRoot: ctx.repoRoot,
      ref: ctx.suppressionDiffRef ?? "",
      git: ctx.services.suppressionsGit,
      readFile: ctx.services.readFile,
    });
    return { status: "ran", findings };
  },
});

// The suppressions check reads its diff via a SuppressionsGitRunner. When the
// caller injects a dedicated one we use it; otherwise we adapt an injected string
// GitRunner (the changed-scope seam) or fall back to the default spawning runner.
function resolveSuppressionsGit(overrides: CheckOverrides): SuppressionsGitRunner {
  if (overrides.suppressionsGit !== undefined) return overrides.suppressionsGit;
  if (overrides.git === undefined) return defaultSuppressionsGitRunner;
  return suppressionsGitRunnerFromStringGit(overrides.git);
}

function suppressionsGitRunnerFromStringGit(git: GitRunner): SuppressionsGitRunner {
  return (_repoRoot, ref) => git(["diff", ref]);
}
