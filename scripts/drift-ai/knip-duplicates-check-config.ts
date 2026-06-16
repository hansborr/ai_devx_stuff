import type { CheckConfigMetadata } from "./check-plugin.js";
import { makeEmptyCheckConfig } from "./config-readers.js";

export type KnipDuplicatesConfig = Record<string, never>;

// Opt-in: knip analyzes the whole project graph even in changed scope, and this
// category is target-config authority over duplicate export aliases.
export const knipDuplicatesCheckConfig: CheckConfigMetadata<
  KnipDuplicatesConfig,
  "knip-duplicates"
> = makeEmptyCheckConfig("knip-duplicates", { runByDefault: false });
