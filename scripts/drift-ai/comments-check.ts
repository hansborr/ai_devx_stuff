import { defineCheckPlugin } from "./check-plugin.js";
import { defaultFileReader, type FileReader, runCommentsCheck } from "./comments.js";
import { commentsCheckConfig } from "./comments-check-config.js";
import type { DriftAiCommentsConfig } from "./config.js";

type CommentsServices = { readonly readFile: FileReader };

export const commentsCheck = defineCheckPlugin<DriftAiCommentsConfig, CommentsServices, "comments">(
  {
    ...commentsCheckConfig,
    resolveServices: (env) => ({
      readFile: env.overrides.readFile ?? defaultFileReader(env.repoRoot),
    }),
    run: (ctx, config) => {
      const findings = runCommentsCheck({
        detectorScope: ctx.detectorScope,
        readFile: ctx.services.readFile,
        excludePrefixes: config.excludePrefixes,
      });
      return { status: "ran", findings };
    },
  },
);
