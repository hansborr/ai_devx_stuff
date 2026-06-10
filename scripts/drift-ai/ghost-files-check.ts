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
    const findings = runGhostFilesCheck({
      detectorScope: ctx.detectorScope,
      listDirectory: ctx.services.listDirectory,
      ...(ctx.inventoryByDir === null ? {} : { inventoryByDir: ctx.inventoryByDir }),
      excludeGlobs:
        ctx.detectorScope.scopeMode === "current"
          ? config.excludeGlobs
          : ghostExcludeGlobs(ctx.config.ignore.globs, config),
      currentAllowedPairs: config.currentAllowedPairs,
      ...(config.dependentsHint === undefined ? {} : { dependentsHint: config.dependentsHint }),
      weakTokens: new Set(config.weakTokens),
      entryPointStems: new Set(config.entryPointStems),
      roleMarkerTokens: new Set(config.roleMarkerTokens),
      sourceExtensions: ctx.sourceExtensions,
    });
    return { status: "ran", findings };
  },
});

function ghostExcludeGlobs(
  ignoredGlobs: readonly string[],
  config: DriftAiGhostFilesConfig,
): string[] {
  return [...ignoredGlobs, ...config.excludeGlobs];
}
