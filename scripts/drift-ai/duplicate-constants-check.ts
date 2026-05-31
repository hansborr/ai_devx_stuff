// The duplicate-constants CheckPlugin: drift:ai's own structural analysis that
// groups module-level `const`s initialized to the same literal value across files
// (a missed shared constant). Opt-in whole-project analyzer; findings carry
// `drift-baseline` provenance.

import type { CheckOutcome, CheckRunContext } from "./check-plugin.js";
import { defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiDuplicateConstantsConfig } from "./config.js";
import { type ConstantShapeExtra, extractConstantShapesFrom } from "./duplicate-constants.js";
import { duplicateConstantsCheckConfig } from "./duplicate-constants-check-config.js";
import {
  type DuplicateShapeDetails,
  type DuplicateShapeGroup,
  type DuplicateShapeServices,
  firstDuplicateShapeMember,
  resolveDuplicateShapeServices,
  runDuplicateShapeCheck,
} from "./duplicate-shapes.js";

const DUPLICATE_CONSTANTS_HINT =
  "these module-level constants hold the same literal value in different files; if they mean the same thing, define one and import it. Keyed on the value, with short strings and trivial numbers skipped — it does not assert the constants are semantically identical.";

export const duplicateConstantsCheck = defineCheckPlugin<
  DriftAiDuplicateConstantsConfig,
  DuplicateShapeServices,
  "duplicate-constants"
>({
  ...duplicateConstantsCheckConfig,
  resolveServices: resolveDuplicateShapeServices,
  run: runDuplicateConstantsCheck,
});

function runDuplicateConstantsCheck(
  ctx: CheckRunContext<DuplicateShapeServices>,
  config: DriftAiDuplicateConstantsConfig,
): CheckOutcome {
  return runDuplicateShapeCheck(ctx, {
    check: "duplicate-constants",
    extract: (filePath, _source, sourceFile) =>
      extractConstantShapesFrom(filePath, sourceFile, {
        minLength: config.minLength,
        minNumberDigits: config.minNumberDigits,
      }),
    minDistinctFiles: config.minDistinctFiles,
    configExcludeGlobs: config.excludeGlobs,
    messageForGroup,
    hint: DUPLICATE_CONSTANTS_HINT,
    detailsForGroup,
  });
}

function messageForGroup(group: DuplicateShapeGroup<ConstantShapeExtra>): string {
  const names = group.members.map((member) => member.label).join(", ");
  const value = firstDuplicateShapeMember(group).extra.value;
  return `${String(group.members.length)} constants across ${String(group.distinctFileCount)} files share the value ${value} (${names})`;
}

function detailsForGroup(group: DuplicateShapeGroup<ConstantShapeExtra>): DuplicateShapeDetails {
  const first = firstDuplicateShapeMember(group);
  return {
    constNames: group.members.map((member) => member.label),
    literalKind: first.extra.literalKind,
    value: first.extra.value,
  };
}
