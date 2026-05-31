// The orphan-files CheckPlugin: a Tier-1 pass-through adapter over the target's
// own knip. Config-discovery + install-detection happen in preflight (the skip
// path is the headline foreign-repo case); the knip subprocess runs in `run`.

import {
  buildOrphanFindings,
  parseKnipOrphanFiles,
  type ParseKnipOrphanFilesResult,
} from "./knip-orphan-files.js";
import {
  orphanFilesCheckConfig,
  type OrphanFilesConfig,
} from "./knip-orphan-files-check-config.js";
import { defineKnipPassThroughCheck } from "./knip-pass-through-check.js";

type ParsedOrphanFiles = Extract<ParseKnipOrphanFilesResult, { readonly ok: true }>;

export const orphanFilesCheck = defineKnipPassThroughCheck<
  OrphanFilesConfig,
  "orphan-files",
  ParsedOrphanFiles
>({
  ...orphanFilesCheckConfig,
  parseReport: parseKnipOrphanFiles,
  buildFindings: (parsed, ctx, provenance) =>
    buildOrphanFindings(parsed.files, ctx.detectorScope, provenance),
});
