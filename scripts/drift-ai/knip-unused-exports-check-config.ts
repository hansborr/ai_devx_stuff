import type { CheckConfigMetadata } from "./check-plugin.js";
import { parseEmptyCheckConfig } from "./config-readers.js";

export type UnusedExportsConfig = Record<string, never>;

export const unusedExportsCheckConfig: CheckConfigMetadata<UnusedExportsConfig, "unused-exports"> =
  {
    id: "unused-exports",
    usage: "unused-exports",
    defaultConfig: {},
    parseConfig: parseEmptyCheckConfig,
    selectConfig: (config) => config.checks["unused-exports"],
    // Opt-in: knip analyzes the whole project graph even in changed scope, so this
    // stays off the routine default run and activates via --check unused-exports /
    // --check all. No per-category toggles — the target's knip config already
    // controls which symbol categories knip analyzes.
    runByDefault: false,
  };
