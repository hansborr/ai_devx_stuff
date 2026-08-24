// @ts-check

// Single source of truth for the per-entry schema of
// eslint-config/max-lines-exceptions.baseline.json. It has two readers that used
// to hand-write their own validation and drifted: the TypeScript baseline spec
// (scripts/max-lines-exceptions-core.ts) that backs the --check/--update gate,
// and this directory's plain-JS config loader (eslint-config/max-lines-policy.js)
// that reads the committed JSON fail-loud at eslint-config-load time. The live
// loader used to accept any string for `lifecycle` and any number for `cap`
// while the gate enforced the enum and positive integers, so a malformed cap
// entry could load into the real ESLint config yet fail CI (or vice versa).
// Keeping the field rules here means both consume the same entry schema.
//
// Plain JS so eslint-config/*.js can import it natively at config-load time;
// scripts/*.ts resolves this module directly (tsconfig.scripts.json sets
// allowJs), so the JSDoc below is the type contract both sides see.

export const MAX_LINES_EXCEPTIONS_TOOL = "eslint-max-lines";
export const MAX_LINES_EXCEPTIONS_METRIC = "file-line-cap-exceptions";

/** @type {readonly ["error", "warn"]} */
const MAX_LINES_SEVERITIES = ["error", "warn"];
/** @type {readonly ["permanent", "candidate-for-split"]} */
const MAX_LINES_LIFECYCLES = ["permanent", "candidate-for-split"];

/** @typedef {"error" | "warn"} MaxLinesSeverity */
/** @typedef {"permanent" | "candidate-for-split"} MaxLinesLifecycle */

/**
 * @typedef {{
 *   readonly path: string;
 *   readonly cap: number;
 *   readonly severity: MaxLinesSeverity;
 *   readonly reason: string;
 *   readonly lifecycle: MaxLinesLifecycle;
 *   readonly ratchetExcluded: boolean;
 * }} MaxLinesExceptionFields
 */

// Both members carry `value` and `error` (the inactive side is null) so a
// consumer can read `.error` without narrowing. eslint-config/*.js is checked
// under non-strict checkJs (tsconfig.eslint-js.json), where negative
// discriminant narrowing on `!result.ok` is unreliable; the strict TypeScript
// spec that also consumes this still narrows the union cleanly on `ok`.
/**
 * @typedef {(
 *   | { readonly ok: true, readonly value: MaxLinesExceptionFields, readonly error: null }
 *   | { readonly ok: false, readonly value: null, readonly error: string }
 * )} MaxLinesExceptionParse
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * @param {unknown} value
 * @returns {value is MaxLinesSeverity}
 */
function isSeverity(value) {
  return typeof value === "string" && MAX_LINES_SEVERITIES.some((severity) => severity === value);
}

/**
 * @param {unknown} value
 * @returns {value is MaxLinesLifecycle}
 */
function isLifecycle(value) {
  return typeof value === "string" && MAX_LINES_LIFECYCLES.some((lifecycle) => lifecycle === value);
}

/**
 * Validate one raw entry against the exception schema, returning the canonical
 * field object or a specific error. The error strings are the gate's asserted
 * messages, so both readers surface the same diagnostic.
 *
 * @param {unknown} raw
 * @returns {MaxLinesExceptionParse}
 */
export function parseMaxLinesExceptionEntry(raw) {
  if (!isRecord(raw)) return fail("entry must be an object");
  const { path, cap, severity, reason, lifecycle, ratchetExcluded } = raw;
  if (!isNonBlankString(path)) {
    return fail("entry path must be a non-empty string");
  }
  if (!isPositiveInteger(cap)) {
    return fail(`entry cap must be a positive integer (${path})`);
  }
  if (!isSeverity(severity)) {
    return fail(`entry severity must be "error" or "warn" (${path})`);
  }
  if (!isNonBlankString(reason)) {
    return fail(`entry reason must be a non-empty string (${path})`);
  }
  if (!isLifecycle(lifecycle)) {
    return fail(`entry lifecycle is invalid (${path})`);
  }
  if (typeof ratchetExcluded !== "boolean") {
    return fail(`entry ratchetExcluded must be a boolean (${path})`);
  }
  return {
    ok: true,
    value: { path, cap, severity, reason, lifecycle, ratchetExcluded },
    error: null,
  };
}

/**
 * @param {string} error
 * @returns {MaxLinesExceptionParse}
 */
function fail(error) {
  return { ok: false, value: null, error };
}
