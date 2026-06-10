// The commented-out-code CheckPlugin: drift:ai's own report-only sensor for
// tombstoned code blocks left behind in comments. Opt-in; reads each in-scope
// source file through an injectable reader and delegates region detection to
// commented-out-code.ts.

import { defineCheckPlugin } from "./check-plugin.js";
import {
  defaultFileReader,
  type FileReader,
  runCommentedOutCodeCheck,
} from "./commented-out-code.js";
import { commentedOutCodeCheckConfig } from "./commented-out-code-check-config.js";
import type { DriftAiCommentedOutCodeConfig } from "./config.js";

type CommentedOutCodeServices = { readonly readFile: FileReader };

export const commentedOutCodeCheck = defineCheckPlugin<
  DriftAiCommentedOutCodeConfig,
  CommentedOutCodeServices,
  "commented-out-code"
>({
  ...commentedOutCodeCheckConfig,
  resolveServices: (env) => ({
    readFile: env.overrides.readFile ?? defaultFileReader(env.repoRoot),
  }),
  run: (ctx, config) => {
    const findings = runCommentedOutCodeCheck({
      detectorScope: ctx.detectorScope,
      readFile: ctx.services.readFile,
      minLines: config.minLines,
      excludePrefixes: config.excludePrefixes,
    });
    return { status: "ran", findings };
  },
});
