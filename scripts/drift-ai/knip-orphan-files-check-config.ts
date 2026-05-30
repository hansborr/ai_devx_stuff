import type { CheckConfigMetadata } from "./check-plugin.js";
import { parseEmptyCheckConfig } from "./config-readers.js";

export type OrphanFilesConfig = Record<string, never>;

export const orphanFilesCheckConfig: CheckConfigMetadata<OrphanFilesConfig, "orphan-files"> = {
  id: "orphan-files",
  usage: "orphan-files",
  defaultConfig: {},
  parseConfig: parseEmptyCheckConfig,
  selectConfig: (config) => config.checks["orphan-files"],
  // Opt-in: knip analyzes the whole project graph even in changed scope, so this
  // stays off the routine default run and activates via --check orphan-files /
  // --check all.
  runByDefault: false,
};
