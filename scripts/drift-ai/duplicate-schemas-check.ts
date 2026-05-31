// The duplicate-schemas CheckPlugin: drift:ai's own structural analysis that groups
// `z.object({ ... })` schemas with an identical (order-insensitive) key set across
// files. Opt-in whole-project analyzer; findings carry `drift-baseline` provenance.

import type { CheckOutcome, CheckRunContext } from "./check-plugin.js";
import { defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiDuplicateSchemasConfig } from "./config.js";
import { extractSchemaShapesFrom, type SchemaShapeExtra } from "./duplicate-schemas.js";
import { duplicateSchemasCheckConfig } from "./duplicate-schemas-check-config.js";
import {
  type DuplicateShapeDetails,
  type DuplicateShapeGroup,
  type DuplicateShapeServices,
  firstDuplicateShapeMember,
  resolveDuplicateShapeServices,
  runDuplicateShapeCheck,
} from "./duplicate-shapes.js";

const DUPLICATE_SCHEMAS_HINT =
  "two schemas share an identical (order-insensitive) key set; if they validate the same payload, define one and reuse it. Grouped on key NAMES only — validators are lossy, so compare each member's `fields` evidence to confirm the shapes truly match before unifying.";

export const duplicateSchemasCheck = defineCheckPlugin<
  DriftAiDuplicateSchemasConfig,
  DuplicateShapeServices,
  "duplicate-schemas"
>({
  ...duplicateSchemasCheckConfig,
  resolveServices: resolveDuplicateShapeServices,
  run: runDuplicateSchemasCheck,
});

function runDuplicateSchemasCheck(
  ctx: CheckRunContext<DuplicateShapeServices>,
  config: DriftAiDuplicateSchemasConfig,
): CheckOutcome {
  return runDuplicateShapeCheck(ctx, {
    check: "duplicate-schemas",
    extract: (filePath, _source, sourceFile) =>
      extractSchemaShapesFrom(filePath, sourceFile, { minKeys: config.minKeys }),
    minDistinctFiles: 2,
    configExcludeGlobs: config.excludeGlobs,
    messageForGroup,
    hint: DUPLICATE_SCHEMAS_HINT,
    detailsForGroup,
  });
}

function messageForGroup(group: DuplicateShapeGroup<SchemaShapeExtra>): string {
  const names = group.members.map((member) => member.label).join(", ");
  return `duplicate schema shape across ${String(group.distinctFileCount)} files (${names})`;
}

function detailsForGroup(group: DuplicateShapeGroup<SchemaShapeExtra>): DuplicateShapeDetails {
  const first = firstDuplicateShapeMember(group);
  // One `label: name=validator, ...` line per member so a reader can compare the
  // grouped schemas' actual validators (the group key is key-names-only and lossy).
  const memberFields = group.members.map((member) => {
    const fieldText = member.extra.fields.join(", ");
    return `${member.label}: ${fieldText}`;
  });
  return {
    schemaNames: group.members.map((member) => member.label),
    keyCount: first.extra.keyCount,
    memberFields,
  };
}
