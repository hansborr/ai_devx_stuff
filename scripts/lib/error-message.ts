/**
 * The one shared spelling of "turn an unknown thrown value into a string".
 *
 * `catch` binds `unknown`, so every caller needs this narrowing, and it had been
 * respelled nineteen times under three names (`errorMessage`, `describeError`,
 * `message`) in two syntactic shapes. Callers that need more than the message —
 * a `stderr`/`stdout` payload, or a structured JSON fallback — keep their own
 * helper on purpose; this one is deliberately the plain case. New callers, and
 * existing callers in files being edited, use this helper for plain unknown-error
 * stringification.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
