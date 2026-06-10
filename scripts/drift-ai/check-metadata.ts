// The lightweight check-metadata registry: check enumeration, CLI usage, the
// default-set membership, and per-check config defaults/parsing — all without
// importing any runtime adapter. config/CLI-time code (`cli-args.ts`,
// `config-parsing.ts`, `config-defaults.ts`) imports ONLY this module, so listing
// checks or parsing config never loads the tool runners / graph builders that the
// concrete plugins (`check-registry.ts` -> `*-check.ts`) pull in.

import { commentedOutCodeCheckConfig } from "./commented-out-code-check-config.js";
import { commentsCheckConfig } from "./comments-check-config.js";
import type { DriftAiChecksConfig } from "./config.js";
import { duplicateConstantsCheckConfig } from "./duplicate-constants-check-config.js";
import { duplicateLiteralsCheckConfig } from "./duplicate-literals-check-config.js";
import { duplicateSchemasCheckConfig } from "./duplicate-schemas-check-config.js";
import { duplicateTypesCheckConfig } from "./duplicate-types-check-config.js";
import { duplicatesCheckConfig } from "./duplicates-check-config.js";
import { ghostFilesCheckConfig } from "./ghost-files-check-config.js";
import { importCyclesCheckConfig } from "./import-cycles-check-config.js";
import { knipDuplicatesCheckConfig } from "./knip-duplicates-check-config.js";
import { orphanFilesCheckConfig } from "./knip-orphan-files-check-config.js";
import { unusedExportsCheckConfig } from "./knip-unused-exports-check-config.js";
import { layerDirectionCheckConfig } from "./layer-direction-check-config.js";
import { moduleDocPathsCheckConfig } from "./module-doc-paths-check-config.js";
import { nearDuplicatesCheckConfig } from "./near-duplicates-check-config.js";
import { suppressionsCheckConfig } from "./suppressions-check-config.js";
import type { DriftCheckId } from "./types.js";

// Canonical check order. The runtime registry (`check-registry.ts`) mirrors it so
// `CHECK_PLUGINS` and `CHECK_METADATA` enumerate checks identically.
export const CHECK_METADATA = [
  duplicatesCheckConfig,
  ghostFilesCheckConfig,
  commentsCheckConfig,
  commentedOutCodeCheckConfig,
  suppressionsCheckConfig,
  moduleDocPathsCheckConfig,
  orphanFilesCheckConfig,
  knipDuplicatesCheckConfig,
  importCyclesCheckConfig,
  layerDirectionCheckConfig,
  nearDuplicatesCheckConfig,
  duplicateTypesCheckConfig,
  duplicateSchemasCheckConfig,
  duplicateLiteralsCheckConfig,
  duplicateConstantsCheckConfig,
  unusedExportsCheckConfig,
] as const;

export type DriftAiCheckMetadata = (typeof CHECK_METADATA)[number];

export const ALL_CHECKS: readonly DriftCheckId[] = CHECK_METADATA.map((meta) => meta.id);

// The checks a no-`--check` run enables. Excludes opt-in checks (runByDefault:
// false) such as tool-backed adapters that analyze the whole project graph; those
// run under `--check all` or explicit `--check <id>`.
export const DEFAULT_CHECKS: readonly DriftCheckId[] = CHECK_METADATA.filter(
  (meta) => meta.runByDefault !== false,
).map((meta) => meta.id);

export const CHECK_USAGE = `${ALL_CHECKS.join("|")}|all`;

export const IMPLEMENTED_CHECKS: ReadonlySet<DriftCheckId> = new Set(ALL_CHECKS);

export function buildDefaultChecksConfig(): DriftAiChecksConfig {
  const entries = CHECK_METADATA.map((meta) => [meta.id, structuredClone(meta.defaultConfig)]);
  // type-assertion-boundary: interop - CHECK_METADATA preserves id/config correlation; Object.fromEntries widens computed keys.
  return Object.fromEntries(entries) as DriftAiChecksConfig;
}
