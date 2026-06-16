import type { CheckConfigMetadata } from "./check-plugin.js";
import { makeEmptyCheckConfig } from "./config-readers.js";

export type OrphanFilesConfig = Record<string, never>;

// Opt-in: knip analyzes the whole project graph even in changed scope, so this
// stays off the routine default run and activates via --check orphan-files /
// --check all.
export const orphanFilesCheckConfig: CheckConfigMetadata<OrphanFilesConfig, "orphan-files"> =
  makeEmptyCheckConfig("orphan-files", { runByDefault: false });
