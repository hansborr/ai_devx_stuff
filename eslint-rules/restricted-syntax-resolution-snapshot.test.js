// @ts-check
//
// Byte-identity guard for the resolved `no-restricted-syntax` policy.
//
// The composition builder (eslint-config/restricted-syntax-builder.js) replaced
// nine hand-maintained selector arrays that each repeated their neighbours'
// selectors because flat config replaces (not merges) rule entries by key. The
// refactor is only safe if every representative file still resolves to exactly
// the same severity and the same ordered selector list. This fixture was
// captured from `eslint.config.js` BEFORE that refactor (see the leaf note in
// docs/agent_notes/backlog/lint-deep-dive-2026-07/40-restricted-syntax-additive-composition.md)
// and must keep matching afterwards.
//
// Selectors are fingerprinted as sha256(selector + NUL + message) so the pin
// covers the selector text and its guidance without carrying kilobytes of
// duplicated AST selectors in the fixture.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";
import { eslintRulesDir, repoRoot, resolvedConfigFor } from "./repo-config-harness.js";

// The fixture sits next to this suite, so address it from the directory rather
// than from `repoRoot` — the path stays correct through a directory rename.
const snapshotPath = resolve(eslintRulesDir, "restricted-syntax-resolution.snapshot.json");
const selectorMessageSeparator = String.fromCharCode(0);
const representativeScopePrefixes = [
  "e2e/",
  "eslint-config/",
  "eslint-rules/",
  "packages/client/",
  "packages/server/",
  "packages/shared/",
  "scripts/",
  "tools/lint-ratchet/",
];

/** @param {unknown} option */
function fingerprintSelector(option) {
  const record = /** @type {{ selector?: unknown, message?: unknown }} */ (option);
  const selector = typeof option === "string" ? option : String(record?.selector ?? "");
  const message = typeof option === "string" ? "" : String(record?.message ?? "");
  return createHash("sha256")
    .update(selector + selectorMessageSeparator + message)
    .digest("hex")
    .slice(0, 16);
}

/** @param {unknown} entry */
function fingerprintEntry(entry) {
  if (entry === undefined || entry === null) return null;
  if (!Array.isArray(entry)) return { severity: entry, selectors: null };
  return { severity: entry[0], selectors: entry.slice(1).map(fingerprintSelector) };
}

/** @param {string} relPath */
async function resolvedFingerprint(relPath) {
  const config = await resolvedConfigFor(relPath);
  return fingerprintEntry(config.rules?.["no-restricted-syntax"]);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

describe("resolved no-restricted-syntax snapshot", () => {
  it(
    "resolves byte-identically to the pre-builder configuration",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const snapshotFiles = Object.keys(snapshot.files);
      expect(snapshotFiles, "snapshot must retain representative files").not.toHaveLength(0);
      const missingRepresentativeFiles = snapshotFiles.filter(
        (file) => !existsSync(resolve(repoRoot, file)),
      );
      expect(
        missingRepresentativeFiles,
        "snapshot representative paths must exist in the live tree",
      ).toEqual([]);
      const missingScopes = representativeScopePrefixes.filter(
        (prefix) => !snapshotFiles.some((file) => file.startsWith(prefix)),
      );
      expect(missingScopes, "snapshot must cover every representative source boundary").toEqual([]);

      /** @type {Record<string, unknown>} */
      const actual = {};
      for (const file of snapshotFiles) {
        actual[file] = await resolvedFingerprint(file);
      }

      // Deliberate policy changes regenerate the pin; a refactor never should.
      if (globalThis.process.env.MUSI_UPDATE_RESTRICTED_SYNTAX_SNAPSHOT === "1") {
        writeFileSync(
          snapshotPath,
          `${JSON.stringify({ note: snapshot.note, files: actual }, null, 2)}\n`,
        );
      }

      expect(actual).toEqual(snapshot.files);
    },
  );
});
