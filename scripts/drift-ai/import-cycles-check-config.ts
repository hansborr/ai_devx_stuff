import type { CheckConfigMetadata } from "./check-plugin.js";
import { parseEmptyCheckConfig } from "./config-readers.js";

export type ImportCyclesConfig = Record<string, never>;

export const importCyclesCheckConfig: CheckConfigMetadata<ImportCyclesConfig, "import-cycles"> = {
  id: "import-cycles",
  usage: "import-cycles",
  defaultConfig: {},
  parseConfig: parseEmptyCheckConfig,
  selectConfig: (config) => config.checks["import-cycles"],
  // Opt-in: building the whole module graph is whole-project work even in changed
  // scope (a cycle is a global property), so it stays off the routine default run
  // and activates via --check import-cycles / --check all.
  runByDefault: false,
};
