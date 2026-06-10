// The module-doc-paths CheckPlugin: drift:ai's own report-only sensor for stale
// backtick *file* references in MODULE.md / *-MODULE.md docs. Opt-in; scans every
// module doc under the configured roots and resolves references across candidate
// bases (see module-doc-paths.ts).

import { defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiModuleDocPathsConfig } from "./config.js";
import {
  type RepoFileReader,
  type RepoPathProbe,
  runModuleDocPathsCheck,
} from "./module-doc-paths.js";
import { moduleDocPathsCheckConfig } from "./module-doc-paths-check-config.js";
import { defaultListModuleDocs } from "./module-doc-paths-io.js";
import { defaultFileReader, defaultPathProbe } from "./repo-io.js";

type ModuleDocPathsServices = {
  readonly readFile: RepoFileReader;
  readonly pathExists: RepoPathProbe;
};

export const moduleDocPathsCheck = defineCheckPlugin<
  DriftAiModuleDocPathsConfig,
  ModuleDocPathsServices,
  "module-doc-paths"
>({
  ...moduleDocPathsCheckConfig,
  resolveServices: (env) => ({
    readFile: env.overrides.readFile ?? defaultFileReader(env.repoRoot),
    pathExists: env.overrides.pathExists ?? defaultPathProbe(env.repoRoot),
  }),
  run: (ctx, config) => {
    const findings = runModuleDocPathsCheck({
      repoRoot: ctx.repoRoot,
      roots: ctx.roots,
      listModuleDocs: () => defaultListModuleDocs(ctx.repoRoot, ctx.roots, ctx.config.ignore),
      readFile: ctx.services.readFile,
      pathExists: ctx.services.pathExists,
      excludeGlobs: config.excludeGlobs,
    });
    return { status: "ran", findings: [...findings] };
  },
});
