// The knip-duplicates CheckPlugin: a Tier-1 pass-through adapter over knip's
// duplicate export aliases category. It reuses the shared knip config discovery,
// target-install preflight, skip mapping, and memoized subprocess runner.

import {
  buildKnipDuplicateFindings,
  parseKnipDuplicates,
  type ParseKnipDuplicatesResult,
} from "./knip-duplicates.js";
import {
  knipDuplicatesCheckConfig,
  type KnipDuplicatesConfig,
} from "./knip-duplicates-check-config.js";
import { defineKnipPassThroughCheck } from "./knip-pass-through-check.js";

type ParsedKnipDuplicates = Extract<ParseKnipDuplicatesResult, { readonly ok: true }>;

export const knipDuplicatesCheck = defineKnipPassThroughCheck<
  KnipDuplicatesConfig,
  "knip-duplicates",
  ParsedKnipDuplicates
>({
  ...knipDuplicatesCheckConfig,
  parseReport: parseKnipDuplicates,
  buildFindings: (parsed, ctx, provenance) =>
    buildKnipDuplicateFindings(parsed.groups, ctx.detectorScope, provenance),
});
