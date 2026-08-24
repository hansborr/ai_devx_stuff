import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { MergeDriverCliConfig } from "@musi/lint-ratchet/git-rail/merge-cli.js";
import { describe, expect, it } from "vitest";

import {
  BASELINE_MERGE_CLI_TABLE,
  type BaselineMergeCliId,
  mergeCliConfigFor,
} from "./baseline-merge-cli-table.js";

const stubMerge: MergeDriverCliConfig["merge"] = () => {
  throw new Error("stub merge — string-derivation test only");
};

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("BASELINE_MERGE_CLI_TABLE", () => {
  it("derives the exact pre-collapse usage and failure strings for every entry", () => {
    const expected: Record<BaselineMergeCliId, { cliPath: string; label: string }> = {
      "max-lines-exceptions": {
        cliPath: "scripts/max-lines-exceptions-merge-cli.ts",
        label: "max-lines exceptions",
      },
      "knip-unused-exports": {
        cliPath: "scripts/sensor-knip-unused-exports-merge-cli.ts",
        label: "knip unused-exports",
      },
      "near-duplicates": {
        cliPath: "scripts/sensor-near-duplicates-merge-cli.ts",
        label: "near-duplicates",
      },
    };
    for (const [id, { cliPath, label }] of Object.entries(expected)) {
      // interop - Object.entries widens the table's literal key union to string
      const config = mergeCliConfigFor(id as BaselineMergeCliId, stubMerge); // type-assertion-boundary: interop - Object.entries widens the literal key union to string; the ids are spelled from the same union above
      expect(config.usage).toBe(
        `usage: bun ${cliPath} <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]`,
      );
      expect(config.unresolvedFailureLabel).toBe(
        `${label} baseline semantic merge could not resolve`,
      );
      expect(config.fatalFailureLabel).toBe(`${label} baseline semantic merge failed`);
      expect(config.markerMessage).toBe(
        `${label} baseline semantic merge requires post-merge truth-up`,
      );
      expect(config.merge).toBe(stubMerge);
    }
  });

  it("points every entry at an existing CLI wrapper file", () => {
    for (const entry of Object.values(BASELINE_MERGE_CLI_TABLE)) {
      expect(existsSync(path.join(repoRoot, entry.cliPath))).toBe(true);
    }
  });

  it("stays in lockstep with the semantic drivers scripts/git/baseline-merge-driver.sh dispatches", () => {
    const shell = readFileSync(path.join(repoRoot, "scripts/git/baseline-merge-driver.sh"), "utf8");
    const dispatched = [...shell.matchAll(/semantic_driver="([^"]+)"/gu)]
      .map((match) => match[1])
      .sort();
    const tablePaths = Object.values(BASELINE_MERGE_CLI_TABLE)
      .map((entry) => entry.cliPath)
      .sort();
    expect(tablePaths).toEqual(dispatched);
  });
});
