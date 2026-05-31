import { commentsCheck } from "./comments-check.js";
import { duplicateConstantsCheck } from "./duplicate-constants-check.js";
import { duplicateLiteralsCheck } from "./duplicate-literals-check.js";
import { duplicateSchemasCheck } from "./duplicate-schemas-check.js";
import { duplicateTypesCheck } from "./duplicate-types-check.js";
import { duplicatesCheck } from "./duplicates-check.js";
import { ghostFilesCheck } from "./ghost-files-check.js";
import { importCyclesCheck } from "./import-cycles-check.js";
import { orphanFilesCheck } from "./knip-orphan-files-check.js";
import { unusedExportsCheck } from "./knip-unused-exports-check.js";
import { nearDuplicatesCheck } from "./near-duplicates-check.js";
import { suppressionsCheck } from "./suppressions-check.js";
import type { DriftCheckId } from "./types.js";

// The runtime plugin registry: concrete `CheckPlugin`s wired to their tool runners
// and graph builders. Importing this module loads those adapters, so config/CLI
// code that only needs to enumerate checks or parse config uses the lightweight
// `check-metadata.ts` registry instead. The order mirrors `CHECK_METADATA`.
export const CHECK_PLUGINS = [
  duplicatesCheck,
  ghostFilesCheck,
  commentsCheck,
  suppressionsCheck,
  orphanFilesCheck,
  importCyclesCheck,
  nearDuplicatesCheck,
  duplicateTypesCheck,
  duplicateSchemasCheck,
  duplicateLiteralsCheck,
  duplicateConstantsCheck,
  unusedExportsCheck,
] as const;

export type DriftAiCheckPlugin = (typeof CHECK_PLUGINS)[number];

export function checkPluginFor(check: DriftCheckId): DriftAiCheckPlugin | undefined {
  return CHECK_PLUGINS.find((plugin) => plugin.id === check);
}
