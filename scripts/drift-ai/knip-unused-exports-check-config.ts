import type { CheckConfigMetadata } from "./check-plugin.js";
import { makeEmptyCheckConfig } from "./config-readers.js";

export type UnusedExportsConfig = Record<string, never>;

// Opt-in: knip analyzes the whole project graph even in changed scope, so this
// stays off the routine default run and activates via --check unused-exports /
// --check all. No per-category toggles — the target's knip config already
// controls which symbol categories knip analyzes.
export const unusedExportsCheckConfig: CheckConfigMetadata<UnusedExportsConfig, "unused-exports"> =
  makeEmptyCheckConfig("unused-exports", { runByDefault: false });
