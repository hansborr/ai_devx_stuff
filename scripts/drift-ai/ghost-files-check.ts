import { defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiGhostFilesConfig } from "./config.js";
import {
  defaultDirectoryListing,
  type DirectoryListing,
  runGhostFilesCheck,
} from "./ghost-files.js";
import { ghostFilesCheckConfig } from "./ghost-files-check-config.js";

type GhostFilesServices = { readonly listDirectory: DirectoryListing };

export const ghostFilesCheck = defineCheckPlugin<
  DriftAiGhostFilesConfig,
  GhostFilesServices,
  "ghost-files"
>({
  ...ghostFilesCheckConfig,
  resolveServices: (env) => ({
    listDirectory: env.overrides.listDirectory ?? defaultDirectoryListing(env.repoRoot),
  }),
  run: (ctx, config) => {
    const sharedOptions = {
      ...(config.dependentsHint === undefined ? {} : { dependentsHint: config.dependentsHint }),
      weakTokens: new Set(config.weakTokens),
      entryPointStems: new Set(config.entryPointStems),
      sourceExtensions: ctx.sourceExtensions,
    };
    let findings;
    if (ctx.detectorScope.scopeMode === "current") {
      if (ctx.inventoryByDir === null) {
        throw new Error("runGhostFilesCheck requires inventoryByDir for current scope.");
      }
      findings = runGhostFilesCheck({
        ...sharedOptions,
        detectorScope: ctx.detectorScope,
        inventoryByDir: ctx.inventoryByDir,
        excludeGlobs: config.excludeGlobs,
        currentAllowedPairs: config.currentAllowedPairs,
        roleMarkerTokens: new Set(config.roleMarkerTokens),
      });
    } else {
      findings = runGhostFilesCheck({
        ...sharedOptions,
        detectorScope: ctx.detectorScope,
        listDirectory: ctx.services.listDirectory,
        excludeGlobs: ghostExcludeGlobs(ctx.config.ignore.globs, config),
      });
    }
    return { status: "ran", findings };
  },
});

function ghostExcludeGlobs(
  ignoredGlobs: readonly string[],
  config: DriftAiGhostFilesConfig,
): string[] {
  return [...ignoredGlobs, ...config.excludeGlobs];
}
