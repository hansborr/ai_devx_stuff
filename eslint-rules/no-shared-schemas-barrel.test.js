// @ts-check
//
// Guard for the global `@typescript-eslint/no-restricted-imports` entry that
// blocks the `@musi/shared/schemas` barrel. The migration removed every
// existing barrel import (DX4.1); this test stops a well-meaning re-add from
// silently dropping the rule.
//
// We exercise the actual repo `eslint.config.js` via `calculateConfigForFile`
// so we verify the wiring (which configs match which files) rather than
// reconstructing the rule inline. We can't lint synthetic files because the
// real config enables `projectService`, which rejects paths not in any
// tsconfig.

import { ESLint } from "eslint";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

/** @returns {Promise<unknown>} */
async function configFor(/** @type {string} */ filePath) {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: resolve(repoRoot, "eslint.config.js"),
  });
  return eslint.calculateConfigForFile(filePath);
}

/** @param {unknown} entry */
function patternsOf(entry) {
  if (!Array.isArray(entry)) return [];
  const opts = entry[1];
  if (!opts || typeof opts !== "object") return [];
  const patterns = /** @type {{ patterns?: unknown }} */ (opts).patterns;
  return Array.isArray(patterns) ? patterns : [];
}

// Returns the patterns whose configured `regex` actually matches the bare
// barrel string AND does NOT match any subpath. Substring checks are too
// loose — `^@musi/shared/schemas/foo$` would slip past one.
/** @param {unknown[]} patterns */
function patternsMatchingBareBarrel(patterns) {
  return patterns.filter((p) => {
    if (!p || typeof p !== "object") return false;
    const regex = /** @type {{ regex?: unknown }} */ (p).regex;
    if (typeof regex !== "string") return false;
    let re;
    try {
      re = new RegExp(regex);
    } catch {
      return false;
    }
    if (!re.test("@musi/shared/schemas")) return false;
    // Must not match a real subpath import; otherwise the rule would block
    // the very paths we want people to migrate to.
    if (re.test("@musi/shared/schemas/spell.js")) return false;
    return true;
  });
}

describe("schemas-barrel restriction", () => {
  it("client files block the bare barrel via the global rule", async () => {
    const cfg = /** @type {{ rules?: Record<string, unknown> }} */ (
      await configFor(
        resolve(repoRoot, "packages/client/src/components/campaign/chat/chat-message.tsx"),
      )
    );
    const entry = cfg.rules?.["@typescript-eslint/no-restricted-imports"];
    expect(entry, "rule must be configured").toBeDefined();
    expect(patternsMatchingBareBarrel(patternsOf(entry)).length).toBeGreaterThan(0);
  });

  it("server files block the bare barrel alongside the RawTxClient restriction", async () => {
    const cfg = /** @type {{ rules?: Record<string, unknown> }} */ (
      await configFor(resolve(repoRoot, "packages/server/src/index.ts"))
    );
    const entry = cfg.rules?.["@typescript-eslint/no-restricted-imports"];
    expect(entry, "rule must be configured").toBeDefined();
    const patterns = patternsOf(entry);
    expect(patternsMatchingBareBarrel(patterns).length).toBeGreaterThan(0);
    // RawTxClient restriction must survive flat-config rule replacement.
    const hasRawTx = patterns.some((p) => {
      if (!p || typeof p !== "object") return false;
      const names = /** @type {{ importNames?: unknown }} */ (p).importNames;
      return Array.isArray(names) && names.includes("RawTxClient");
    });
    expect(hasRawTx).toBe(true);
  });
});
