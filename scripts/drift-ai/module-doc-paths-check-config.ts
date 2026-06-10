import type { CheckConfigMetadata } from "./check-plugin.js";
import type { DriftAiModuleDocPathsConfig } from "./config.js";
import { normalizeGlob } from "./config-paths.js";
import { assertConfigObject, assertKnownKeys, readStringArray } from "./config-readers.js";
import { uniqSorted } from "./path-util.js";

const DEFAULT_MODULE_DOC_PATHS_CONFIG: DriftAiModuleDocPathsConfig = { excludeGlobs: [] };

export const moduleDocPathsCheckConfig: CheckConfigMetadata<
  DriftAiModuleDocPathsConfig,
  "module-doc-paths"
> = {
  id: "module-doc-paths",
  usage: "module-doc-paths",
  defaultConfig: DEFAULT_MODULE_DOC_PATHS_CONFIG,
  parseConfig: parseModuleDocPathsConfig,
  selectConfig: (config) => config.checks["module-doc-paths"],
  // Opt-in: scans every MODULE.md across the roots regardless of changed scope, so
  // it stays off the routine changed-scope run and activates via
  // --check module-doc-paths / --check all.
  runByDefault: false,
};

function parseModuleDocPathsConfig(raw: unknown, keyPath: string): DriftAiModuleDocPathsConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["excludeGlobs"], keyPath);
  return {
    excludeGlobs:
      record["excludeGlobs"] === undefined
        ? DEFAULT_MODULE_DOC_PATHS_CONFIG.excludeGlobs
        : uniqSorted(
            readStringArray(record["excludeGlobs"], `${keyPath}.excludeGlobs`).map(normalizeGlob),
          ),
  };
}
