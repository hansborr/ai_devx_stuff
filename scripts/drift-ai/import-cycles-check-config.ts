import type { CheckConfigMetadata } from "./check-plugin.js";
import { makeEmptyCheckConfig } from "./config-readers.js";

export type ImportCyclesConfig = Record<string, never>;

// Opt-in: building the whole module graph is whole-project work even in changed
// scope (a cycle is a global property), so it stays off the routine default run
// and activates via --check import-cycles / --check all.
export const importCyclesCheckConfig: CheckConfigMetadata<ImportCyclesConfig, "import-cycles"> =
  makeEmptyCheckConfig("import-cycles", { runByDefault: false });
