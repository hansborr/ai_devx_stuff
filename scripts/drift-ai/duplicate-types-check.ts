// The duplicate-types CheckPlugin: drift:ai's own structural analysis that groups
// interface / object-type-literal declarations with an identical sorted prop bag
// across files (evidence two agents wrote the same DTO). Opt-in whole-project
// analyzer; findings carry `drift-baseline` provenance.

import type { CheckOutcome, CheckRunContext } from "./check-plugin.js";
import { defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiDuplicateTypesConfig } from "./config.js";
import {
  type DuplicateShapeDetails,
  type DuplicateShapeGroup,
  type DuplicateShapeServices,
  firstDuplicateShapeMember,
  resolveDuplicateShapeServices,
  runDuplicateShapeCheck,
} from "./duplicate-shapes.js";
import { extractTypeShapesFrom, type TypeShapeExtra } from "./duplicate-types.js";
import { duplicateTypesCheckConfig } from "./duplicate-types-check-config.js";

const DUPLICATE_TYPES_HINT =
  "two declarations share an identical property shape (sorted name+type bag, order-insensitive); if they model the same DTO, define it once and import it. Text-structural evidence — it will not unify a type with an alias of the same type.";

export const duplicateTypesCheck = defineCheckPlugin<
  DriftAiDuplicateTypesConfig,
  DuplicateShapeServices,
  "duplicate-types"
>({
  ...duplicateTypesCheckConfig,
  resolveServices: resolveDuplicateShapeServices,
  run: runDuplicateTypesCheck,
});

function runDuplicateTypesCheck(
  ctx: CheckRunContext<DuplicateShapeServices>,
  config: DriftAiDuplicateTypesConfig,
): CheckOutcome {
  return runDuplicateShapeCheck(ctx, {
    check: "duplicate-types",
    extract: (filePath, _source, sourceFile) =>
      extractTypeShapesFrom(filePath, sourceFile, { minProps: config.minProps }),
    minDistinctFiles: 2,
    configExcludeGlobs: config.excludeGlobs,
    messageForGroup,
    hint: DUPLICATE_TYPES_HINT,
    detailsForGroup,
  });
}

function messageForGroup(group: DuplicateShapeGroup<TypeShapeExtra>): string {
  const names = group.members.map((member) => member.label).join(", ");
  return `duplicate type shape across ${String(group.distinctFileCount)} files (${names})`;
}

function detailsForGroup(group: DuplicateShapeGroup<TypeShapeExtra>): DuplicateShapeDetails {
  const first = firstDuplicateShapeMember(group);
  return {
    typeNames: group.members.map((member) => member.label),
    propCount: first.extra.propCount,
  };
}
