// @ts-check

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_LINES_EXCEPTIONS_TOOL,
  parseMaxLinesExceptionEntry,
} from "./max-lines-exceptions-codec.js";

/** @typedef {"error" | "warn"} MaxLinesPolicySeverity */
/** @typedef {"permanent" | "candidate-for-split"} MaxLinesPolicyLifecycle */
/**
 * @typedef {{
 *   readonly path: string;
 *   readonly cap: number;
 *   readonly severity: MaxLinesPolicySeverity;
 *   readonly reason: string;
 *   readonly lifecycle: MaxLinesPolicyLifecycle;
 *   readonly ratchetExcluded: boolean;
 * }} MaxLinesPolicyException
 */
/**
 * @typedef {{
 *   readonly path: string;
 *   readonly generator: string;
 *   readonly reason: string;
 * }} MaxLinesPolicyGeneratedExemption
 */
/** @typedef {{ readonly skipBlankLines: true; readonly skipComments: true }} MaxLinesPolicyCounting */
/**
 * @typedef {{
 *   readonly counting: MaxLinesPolicyCounting;
 *   readonly ratchetFloor: { readonly cap: number };
 *   readonly exceptions: readonly MaxLinesPolicyException[];
 *   readonly generatedExemptions: readonly MaxLinesPolicyGeneratedExemption[];
 * }} MaxLinesPolicy
 */

/** @type {MaxLinesPolicyCounting} */
const maxLinesCountingOptions = { skipBlankLines: true, skipComments: true };

const maxLinesExceptionsBaselinePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "max-lines-exceptions.baseline.json",
);
const maxLinesExceptionsConflictMarkerPattern = /^<{7} /mu;
const maxLinesExceptionsConflictMarkerTripwire =
  "eslint-config/max-lines-exceptions.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run lint:max-lines-exceptions:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours eslint-config/max-lines-exceptions.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then reconcile entries from both sides and normalize with `bun run lint:max-lines-exceptions:update`; never hand-merge conflict markers in this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPolicyObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The per-file max-lines cap exceptions live in a real baseline on the shared
// item-keyed framework (scripts/lib/baseline), not inline here. Read the
// committed JSON at config-load time — fail-loud, because a missing or malformed
// table would silently drop every cap override and let large files pass. Edit
// the caps in the JSON, then `bun scripts/max-lines-exceptions.ts --update` to
// normalize it; `--check` (default) is the gate.
/** @returns {readonly MaxLinesPolicyException[]} */
function readMaxLinesExceptions() {
  let text;
  let parsed;
  try {
    text = readFileSync(maxLinesExceptionsBaselinePath, "utf8");
    parsed = JSON.parse(text);
  } catch {
    if (text !== undefined && maxLinesExceptionsConflictMarkerPattern.test(text)) {
      throw new Error(maxLinesExceptionsConflictMarkerTripwire);
    }
    throw new Error(
      "Could not read or parse eslint-config/max-lines-exceptions.baseline.json; regenerate with `bun run lint:max-lines-exceptions:update`.",
    );
  }
  if (
    !isPolicyObject(parsed) ||
    parsed.tool !== MAX_LINES_EXCEPTIONS_TOOL ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(
      "max-lines-exceptions.baseline.json must declare tool 'eslint-max-lines' and an entries[] array",
    );
  }
  // Validate each entry with the shared codec so the live config load enforces
  // the same field schema (severity/lifecycle enums, positive-integer cap) as
  // the --check gate in scripts/max-lines-exceptions-core.ts.
  return parsed.entries.map((/** @type {unknown} */ entry, /** @type {number} */ index) => {
    const result = parseMaxLinesExceptionEntry(entry);
    if (result.ok) return result.value;
    throw new Error(`max-lines exception ${String(index)}: ${result.error}`);
  });
}

const maxLinesExceptions = readMaxLinesExceptions();

// Files a code generator fully owns are exempt from the per-file
// `local/max-lines` cap: the reviewable surface is the generator, not its
// emitted output, and the output grows with registrations (a table row per
// smoke subject), not with logic. This is an explicit allowlist, never a header
// regex — an authored file cannot opt itself out of the size gate by pasting a
// "Do not edit by hand" header; adding a path here is a reviewed change, and
// `bun run lint:max-lines-exceptions` fails loudly if any listed path is missing
// on disk, lacks its declared generator's header, or still carries a redundant
// baseline cap entry. A generated path lives here XOR in the caps baseline, never
// both, so hand-written files keep ratcheting through the baseline exactly as
// before.
/** @type {readonly MaxLinesPolicyGeneratedExemption[]} */
const maxLinesGeneratedExemptions = [
  {
    path: "scripts/path-policy/path-policy-smoke-subjects-data.ts",
    generator: "scripts/path-policy/generate-smoke-subjects.ts",
    reason:
      "Generated side-effect-free smoke-subject lookup table keyed by test name; it grows with smoke registrations, not logic, and is rewritten by `bun run test:scripts:subjects`.",
  },
];

/** @type {MaxLinesPolicy} */
export const maxLinesPolicy = {
  counting: maxLinesCountingOptions,
  ratchetFloor: { cap: 300 },
  exceptions: maxLinesExceptions,
  generatedExemptions: maxLinesGeneratedExemptions,
};
