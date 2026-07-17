// Resolution of the jscpd executable for the duplicates check. Kept separate
// from the subprocess runner so locating the binary (a portability concern) and
// invoking it (an I/O concern) stay focused modules.

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveToolBin,
  type ResolveToolBinOptions,
  type ToolBinConfig,
  type ToolBinResolution,
} from "./tool-bin.js";

// Relative location of the jscpd executable shim inside any node_modules tree.
const JSCPD_BIN_RELATIVE = path.join("node_modules", ".bin", "jscpd");

// This module's own directory, used to locate the tools-checkout node_modules.
const DRIFT_AI_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const JSCPD_TOOL_BIN: ToolBinConfig = {
  toolName: "jscpd",
  binRelativePath: JSCPD_BIN_RELATIVE,
  moduleDir: DRIFT_AI_MODULE_DIR,
};
export type JscpdBinResolution = ToolBinResolution;

export type ResolveJscpdBinOptions = ResolveToolBinOptions;

// Resolve the jscpd executable. Precedence:
//   1. an explicit --jscpd-bin override — authoritative when supplied (a missing
//      override is not-found, never silently replaced by a checkout bin);
//   2. the tools checkout (this script's own node_modules) — the default PRIMARY
//      path, so a pnpm/npm/yarn or entirely uninstalled target need not own jscpd;
//   3. the target repo's node_modules (an already-installed target still works).
// The tools-checkout bin is found by walking up from this module's directory to
// the nearest `node_modules/.bin/jscpd`, rather than `import.meta.resolve("jscpd")`:
// resolve() yields the package *entry* (build/index.js), and deriving the
// `.bin/jscpd` shim from it is unreliable across nested/pnpm layouts. The tools
// checkout uses a flat Bun `node_modules/.bin`, which the walk-up finds directly
// and independently of the subprocess cwd.
export function resolveJscpdBin(options: ResolveJscpdBinOptions = {}): JscpdBinResolution {
  return resolveToolBin(JSCPD_TOOL_BIN, options);
}
