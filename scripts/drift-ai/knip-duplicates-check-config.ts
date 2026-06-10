import type { CheckConfigMetadata } from "./check-plugin.js";
import { parseEmptyCheckConfig } from "./config-readers.js";

export type KnipDuplicatesConfig = Record<string, never>;

export const knipDuplicatesCheckConfig: CheckConfigMetadata<
  KnipDuplicatesConfig,
  "knip-duplicates"
> = {
  id: "knip-duplicates",
  usage: "knip-duplicates",
  defaultConfig: {},
  parseConfig: parseEmptyCheckConfig,
  selectConfig: (config) => config.checks["knip-duplicates"],
  // Opt-in: knip analyzes the whole project graph even in changed scope, and this
  // category is target-config authority over duplicate export aliases.
  runByDefault: false,
};
