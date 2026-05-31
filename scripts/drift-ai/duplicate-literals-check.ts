// The duplicate-literals CheckPlugin: drift:ai's own structural analysis that
// surfaces string/number literals appearing in many distinct files (a cross-file
// magic-value detector). Opt-in whole-project analyzer; findings carry
// `drift-baseline` provenance.

import type { CheckOutcome, CheckRunContext } from "./check-plugin.js";
import { defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiDuplicateLiteralsConfig } from "./config.js";
import { extractLiteralShapesFrom, type LiteralShapeExtra } from "./duplicate-literals.js";
import { duplicateLiteralsCheckConfig } from "./duplicate-literals-check-config.js";
import {
  type DuplicateShapeDetails,
  type DuplicateShapeGroup,
  type DuplicateShapeServices,
  firstDuplicateShapeMember,
  resolveDuplicateShapeServices,
  runDuplicateShapeCheck,
} from "./duplicate-shapes.js";

const DUPLICATE_LITERALS_HINT =
  "this literal is repeated across several files; if it is a shared magic value, hoist it to one named constant and import it. Noise-filtered (import paths, short strings, numeric literals unless opted in, and test titles are skipped) but not adjudicated.";

export const duplicateLiteralsCheck = defineCheckPlugin<
  DriftAiDuplicateLiteralsConfig,
  DuplicateShapeServices,
  "duplicate-literals"
>({
  ...duplicateLiteralsCheckConfig,
  resolveServices: resolveDuplicateShapeServices,
  run: runDuplicateLiteralsCheck,
});

function runDuplicateLiteralsCheck(
  ctx: CheckRunContext<DuplicateShapeServices>,
  config: DriftAiDuplicateLiteralsConfig,
): CheckOutcome {
  return runDuplicateShapeCheck(ctx, {
    check: "duplicate-literals",
    extract: (filePath, _source, sourceFile) =>
      extractLiteralShapesFrom(filePath, sourceFile, {
        minLength: config.minLength,
        includeNumbers: config.includeNumbers,
        minNumberDigits: config.minNumberDigits,
        skipTestTitleStrings: config.skipTestTitleStrings,
      }),
    minDistinctFiles: config.minDistinctFiles,
    configExcludeGlobs: config.excludeGlobs,
    messageForGroup,
    hint: DUPLICATE_LITERALS_HINT,
    detailsForGroup,
  });
}

function messageForGroup(group: DuplicateShapeGroup<LiteralShapeExtra>): string {
  const value = firstDuplicateShapeMember(group).label;
  return `literal ${value} repeated across ${String(group.distinctFileCount)} files (${String(group.members.length)} occurrences)`;
}

function detailsForGroup(group: DuplicateShapeGroup<LiteralShapeExtra>): DuplicateShapeDetails {
  const first = firstDuplicateShapeMember(group);
  return {
    literalKind: first.extra.literalKind,
    value: first.extra.value,
  };
}
