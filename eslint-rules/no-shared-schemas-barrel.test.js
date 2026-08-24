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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import config from "../eslint.config.js";
import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";
import { repoRoot, resolvedConfigFor } from "./repo-config-harness.js";

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

/** @param {unknown[]} patterns @param {string} name */
function patternsWithGroup(patterns, name) {
  return patterns.filter((p) => {
    if (!p || typeof p !== "object") return false;
    const group = /** @type {{ group?: unknown }} */ (p).group;
    return Array.isArray(group) && group.includes(name);
  });
}

describe("schemas-barrel restriction", () => {
  it("keeps the bare-barrel fence in every restricted-import rule site", () => {
    const ruleSites = config.flatMap((entry) => {
      const rule = entry.rules?.["@typescript-eslint/no-restricted-imports"];
      return rule === undefined ? [] : [rule];
    });

    expect(ruleSites.length, "at least one restricted-import rule site must exist").toBeGreaterThan(
      0,
    );
    for (const rule of ruleSites) {
      expect(patternsMatchingBareBarrel(patternsOf(rule))).not.toHaveLength(0);
    }
  });

  it(
    "client files block the bare barrel alongside socket-client construction",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const cfg = await resolvedConfigFor(
        "packages/client/src/components/campaign/chat/chat-message.tsx",
      );
      const entry = cfg.rules?.["@typescript-eslint/no-restricted-imports"];
      expect(entry, "rule must be configured").toBeDefined();
      const patterns = patternsOf(entry);
      expect(patternsMatchingBareBarrel(patterns).length).toBeGreaterThan(0);
      expect(patternsWithGroup(patterns, "socket.io-client").length).toBeGreaterThan(0);
    },
  );

  it(
    "server files block the bare barrel alongside the RawTxClient restriction",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const cfg = await resolvedConfigFor("packages/server/src/index.ts");
      const entry = cfg.rules?.["@typescript-eslint/no-restricted-imports"];
      expect(entry, "rule must be configured").toBeDefined();
      const patterns = patternsOf(entry);
      const barrelPatterns = patternsMatchingBareBarrel(patterns);
      expect(barrelPatterns.length).toBeGreaterThan(0);
      // The barrel ban carries its architecture decision, not a dead roadmap id.
      for (const pattern of barrelPatterns) {
        const barrelMessage = /** @type {{ message?: unknown }} */ (pattern).message;
        expect(barrelMessage).toContain("ADR-0005");
      }
      // RawTxClient restriction must survive flat-config rule replacement.
      const rawTxPattern = patterns.find((p) => {
        if (!p || typeof p !== "object") return false;
        const names = /** @type {{ importNames?: unknown }} */ (p).importNames;
        return Array.isArray(names) && names.includes("RawTxClient");
      });
      expect(rawTxPattern).toBeDefined();
      const message = /** @type {{ message?: unknown }} */ (rawTxPattern).message;
      expect(message).toContain("ADR-0007");
    },
  );

  it(
    "shared files block client/server and runtime-specific imports",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const cfg = await resolvedConfigFor("packages/shared/src/rules/combat.ts");
      const entry = cfg.rules?.["@typescript-eslint/no-restricted-imports"];
      expect(entry, "rule must be configured").toBeDefined();
      const patterns = patternsOf(entry);
      expect(patternsMatchingBareBarrel(patterns).length).toBeGreaterThan(0);
      const layeringPatterns = [
        ...patternsWithGroup(patterns, "@musi/server"),
        ...patternsWithGroup(patterns, "react"),
      ];
      expect(patternsWithGroup(patterns, "@musi/server").length).toBeGreaterThan(0);
      expect(patternsWithGroup(patterns, "react").length).toBeGreaterThan(0);
      // Both layering bans name the decision that explains why shared is closed.
      for (const pattern of layeringPatterns) {
        const message = /** @type {{ message?: unknown }} */ (pattern).message;
        expect(message).toContain("ADR-0006");
      }
    },
  );
});

// The lint side above keeps the removed `@musi/shared/schemas` barrel
// unimportable. The manifest side is the other half of the same decision:
// ADR-0005 makes the *absence* of a `"."` root entry part of the boundary, and
// no lint rule can see a package.json `exports` map. Re-adding `"."` — even
// pointed at one existing module — reopens the bare `@musi/shared` specifier
// that the subpath split exists to remove, and nothing else in the repo
// notices.
describe("shared package export surface", () => {
  const manifest = /** @type {{ exports?: Record<string, unknown> }} */ (
    JSON.parse(readFileSync(resolve(repoRoot, "packages/shared/package.json"), "utf8"))
  );

  it("declares subpath exports and no root entry", () => {
    const exportKeys = Object.keys(manifest.exports ?? {});
    // Guard against a manifest reshape that would make the assertion below
    // pass over an empty key set.
    expect(exportKeys.length).toBeGreaterThan(0);
    expect(exportKeys).not.toContain(".");
    for (const key of exportKeys) {
      expect(key, "every export key must be a scoped subpath").toMatch(/^\.\/\S/);
    }
  });
});
