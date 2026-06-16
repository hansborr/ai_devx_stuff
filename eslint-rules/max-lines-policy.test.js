// @ts-check
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { maxLinesPolicy } from "../eslint-config/shared-policy.js";
import { lintRatchets } from "../scripts/lint-ratchet/lint-ratchet-config.ts";
import { globToRegExp, matchesRatchet } from "../scripts/lint-ratchet/ratchet-globs.ts";
import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";

const repoRoot = resolve(import.meta.dirname, "..");
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, "eslint.config.js"),
});

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** @param {string} pattern */
function hasGlobMeta(pattern) {
  return /[*?{}]/u.test(pattern);
}

/**
 * @param {string} pattern
 * @param {readonly string[]} files
 */
function policyPathExists(pattern, files) {
  if (!hasGlobMeta(pattern)) return existsSync(resolve(repoRoot, pattern));
  const regex = globToRegExp(pattern);
  return files.some((file) => regex.test(file));
}

/** @param {unknown} severity */
function severityName(severity) {
  if (severity === "error" || severity === 2) return "error";
  if (severity === "warn" || severity === 1) return "warn";
  return undefined;
}

/** @param {unknown} rule */
function readMaxLinesRule(rule) {
  if (!Array.isArray(rule)) return undefined;
  const severity = severityName(rule[0]);
  const options = rule[1];
  if (severity === undefined || options === null || typeof options !== "object") {
    return undefined;
  }

  const values =
    /** @type {{ max?: unknown; skipBlankLines?: unknown; skipComments?: unknown }} */ (options);
  if (
    typeof values.max !== "number" ||
    typeof values.skipBlankLines !== "boolean" ||
    typeof values.skipComments !== "boolean"
  ) {
    return undefined;
  }

  return {
    severity,
    max: values.max,
    skipBlankLines: values.skipBlankLines,
    skipComments: values.skipComments,
  };
}

/** @param {unknown} config */
function localMaxLinesRule(config) {
  if (config === null || typeof config !== "object") return undefined;
  const rules = /** @type {{ rules?: Record<string, unknown> }} */ (config).rules;
  return rules?.["local/max-lines"];
}

function maxLinesRatchets() {
  return lintRatchets.filter(
    (ratchet) => ratchet.ruleId === "local/max-lines" && ratchet.metric === "effective-line-count",
  );
}

describe("max-lines policy", () => {
  it("does not contain stale exception paths, missing reasons, or invalid lifecycle labels", () => {
    const files = trackedFiles();
    const validLifecycles = new Set(["temporary", "permanent", "candidate-for-split"]);

    for (const entry of maxLinesPolicy.exceptions) {
      expect(entry.reason.trim(), `${entry.path} must explain its exception`).not.toBe("");
      expect(policyPathExists(entry.path, files), `${entry.path} must exist`).toBe(true);
      expect(
        validLifecycles.has(entry.lifecycle),
        `${entry.path} must carry a valid lifecycle label (temporary | permanent | candidate-for-split)`,
      ).toBe(true);
    }
  });

  it(
    "matches the resolved ESLint local/max-lines caps",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const entry of maxLinesPolicy.exceptions) {
        const config = await eslint.calculateConfigForFile(resolve(repoRoot, entry.path));
        expect(readMaxLinesRule(localMaxLinesRule(config)), entry.path).toEqual({
          severity: entry.severity,
          max: entry.cap,
          ...maxLinesPolicy.counting,
        });
      }
    },
  );

  it("keeps max-lines ratchet floors aligned with policy", () => {
    const expectedRuleOptions = [
      {
        max: maxLinesPolicy.ratchetFloor.cap,
        ...maxLinesPolicy.counting,
      },
    ];
    expect(
      maxLinesRatchets().map((ratchet) => ({
        id: ratchet.id,
        files: ratchet.files,
        ignores: ratchet.ignores,
        ruleOptions: ratchet.ruleOptions,
        zeroBaselineDisposition: ratchet.zeroBaselineDisposition,
      })),
    ).toEqual(
      maxLinesPolicy.ratchets.map((ratchet) => ({
        id: ratchet.id,
        files: ratchet.files,
        ignores: ratchet.ignores,
        ruleOptions: expectedRuleOptions,
        zeroBaselineDisposition: ratchet.zeroBaselineDisposition,
      })),
    );
  });

  it("keeps each exception's ratchet exclusion flag aligned with ratchet coverage", () => {
    const ratchets = maxLinesRatchets();

    for (const entry of maxLinesPolicy.exceptions) {
      const isCovered = ratchets.some((ratchet) => matchesRatchet(ratchet, entry.path));
      expect(isCovered, entry.path).toBe(!entry.ratchetExcluded);
    }
  });
});
