import { ALL_CHECKS } from "./check-metadata.js";
import { commentedOutCodeCheck } from "./commented-out-code-check.js";
import { commentsCheck } from "./comments-check.js";
import { duplicateConstantsCheck } from "./duplicate-constants-check.js";
import { duplicateLiteralsCheck } from "./duplicate-literals-check.js";
import { duplicateSchemasCheck } from "./duplicate-schemas-check.js";
import { duplicateTypesCheck } from "./duplicate-types-check.js";
import { duplicatesCheck } from "./duplicates-check.js";
import { ghostFilesCheck } from "./ghost-files-check.js";
import { importCyclesCheck } from "./import-cycles-check.js";
import { knipDuplicatesCheck } from "./knip-duplicates-check.js";
import { orphanFilesCheck } from "./knip-orphan-files-check.js";
import { unusedExportsCheck } from "./knip-unused-exports-check.js";
import { layerDirectionCheck } from "./layer-direction-check.js";
import { moduleDocPathsCheck } from "./module-doc-paths-check.js";
import { nearDuplicatesCheck } from "./near-duplicates-check.js";
import { suppressionsCheck } from "./suppressions-check.js";
import type { DriftCheckId } from "./types.js";

// The runtime plugin registry: concrete `CheckPlugin`s wired to their tool runners
// and graph builders. Importing this module loads those adapters, so config/CLI
// code that only needs to enumerate checks or parse config uses the lightweight
// `check-metadata.ts` registry instead. Membership is compiler-checked: the
// `satisfies` clause forces exactly one entry per `DriftCheckId`, with each
// plugin under its own id, so an unregistered check stops compiling here.
const PLUGIN_BY_ID = {
  duplicates: duplicatesCheck,
  "ghost-files": ghostFilesCheck,
  comments: commentsCheck,
  "commented-out-code": commentedOutCodeCheck,
  suppressions: suppressionsCheck,
  "module-doc-paths": moduleDocPathsCheck,
  "orphan-files": orphanFilesCheck,
  "knip-duplicates": knipDuplicatesCheck,
  "import-cycles": importCyclesCheck,
  "layer-direction": layerDirectionCheck,
  "near-duplicates": nearDuplicatesCheck,
  "duplicate-types": duplicateTypesCheck,
  "duplicate-schemas": duplicateSchemasCheck,
  "duplicate-literals": duplicateLiteralsCheck,
  "duplicate-constants": duplicateConstantsCheck,
  "unused-exports": unusedExportsCheck,
} as const satisfies { readonly [Id in DriftCheckId]: { readonly id: Id } };

export type DriftAiCheckPlugin = (typeof PLUGIN_BY_ID)[DriftCheckId];

// Runtime order is derived from `CHECK_METADATA`'s canonical order (via
// `ALL_CHECKS`), not maintained by hand: the two registries cannot enumerate
// checks differently. The import edge points registry -> metadata, which is the
// permitted direction — the lightweight surface must never import this module.
export const CHECK_PLUGINS: readonly DriftAiCheckPlugin[] = ALL_CHECKS.map(
  (id) => PLUGIN_BY_ID[id],
);

export function checkPluginFor(check: DriftCheckId): DriftAiCheckPlugin {
  return PLUGIN_BY_ID[check];
}
