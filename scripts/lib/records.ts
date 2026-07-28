/**
 * Shared record/object type guards for `scripts/`.
 *
 * Two guards, deliberately named apart, because the difference is a real
 * correctness seam rather than a style preference: an array is `typeof
 * "object"` and non-null, so the loose guard narrows `unknown[]` to
 * `Record<string, unknown>` and lets a caller index a field that is always
 * `undefined`. Prefer `isRecord`; reach for `isObjectLike` only where a caller
 * genuinely accepts arrays and handles them separately.
 */

/** Narrow to a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow to any non-null object, arrays included. */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
