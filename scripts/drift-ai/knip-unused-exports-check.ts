// The unused-exports CheckPlugin: a Tier-1 pass-through adapter over the target's
// own knip, surfacing the symbol-level reachability categories orphan-files leaves
// alone (exports/types/enumMembers/namespaceMembers). It REUSES orphan-files'
// config resolution, services shape, skip-reason helpers, and the SHARED memoizing
// knip runner — so under `--check all` knip is spawned once and selected knip
// adapters parse from the same report. Config-discovery + install-detection happen in preflight
// (identical skip semantics to orphan-files); the knip subprocess runs in `run`.

import { defineKnipPassThroughCheck } from "./knip-pass-through-check.js";
import {
  buildUnusedExportFindings,
  type ParseKnipUnusedExportsResult,
  projectKnipUnusedExports,
} from "./knip-unused-exports.js";
import {
  unusedExportsCheckConfig,
  type UnusedExportsConfig,
} from "./knip-unused-exports-check-config.js";
import { createDeprecatedExportLookup } from "./knip-unused-exports-deprecated.js";

type ParsedUnusedExports = Extract<ParseKnipUnusedExportsResult, { readonly ok: true }>;

export const unusedExportsCheck = defineKnipPassThroughCheck<
  UnusedExportsConfig,
  "unused-exports",
  ParsedUnusedExports
>({
  ...unusedExportsCheckConfig,
  projectReport: projectKnipUnusedExports,
  buildFindings: (parsed, ctx, provenance) =>
    buildUnusedExportFindings(
      parsed.symbols,
      ctx.detectorScope,
      provenance,
      createDeprecatedExportLookup(ctx.services.readFile),
    ),
});
