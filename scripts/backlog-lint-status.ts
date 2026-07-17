/**
 * Shared status-token vocabulary for the backlog advisory lint.
 *
 * Both the per-file front-matter checks (backlog-lint-core) and the pack-level
 * index checks (backlog-lint-packs) classify a note's `Status:` value against
 * this single source of truth, so index-vs-leaf drift and the per-file checks
 * agree on what "terminal" (finished) means.
 */

/** Status words that mean a leaf/row is finished. */
const TERMINAL_STATUS_TOKENS = [
  "closed",
  "decided",
  "done",
  "drained",
  "implemented",
  "rejected",
  "shipped",
  "superseded",
] as const;

/**
 * Non-terminal status words the tree actually uses — active work, dispositions,
 * and companion-doc roles ("shared context", "provenance record"). Combined
 * with the terminal tokens this is the full recognized vocabulary; a status
 * containing none of it reads as a typo in a freshly written note.
 */
const ACTIVE_STATUS_TOKENS = [
  "parked",
  "ready",
  "proposed",
  "proposal",
  "blocked",
  "deferred",
  "backlog",
  "open",
  "accepted",
  "draft",
  "partial",
  "progress",
  "planned",
  "investigating",
  "promoted",
  "landed",
  "resolved",
  "complete",
  "research",
  "design",
  "addressed",
  "context",
  "provenance",
  "record",
  "reference",
] as const;

const RECOGNIZED_STATUS_TOKENS: readonly string[] = [
  ...TERMINAL_STATUS_TOKENS,
  ...ACTIVE_STATUS_TOKENS,
];

const TERMINAL_STATUS_TOKEN_SET: ReadonlySet<string> = new Set(TERMINAL_STATUS_TOKENS);

// Negation words that neutralize a terminal token appearing later in the same
// clause, so "NOT implemented" / "not yet done" / "no longer shipped" stay
// active. An intervening adverb ("not really done") does not clear the negation.
const NEGATION_TOKENS: ReadonlySet<string> = new Set(["not", "no", "never"]);

// Punctuation that ends a clause; a negation does not carry past it, so a later
// clause's terminal token ("Not started; done elsewhere") still reads finished.
const CLAUSE_BOUNDARY_PATTERN = /[.;:,/|()[\]{}—–-]+/u;

// Split a clause into lowercase word tokens (letters/digits), dropping empties.
const TOKEN_SPLIT_PATTERN = /[^a-z0-9]+/u;

/**
 * True when the status value reads as finished work. Terminal tokens are matched
 * on whole words (so "unimplemented" is not read as "implemented"), and a token
 * is neutralized when a negation ("not"/"no"/"never") precedes it in the same
 * clause, so "Proposed — NOT implemented" remains active.
 */
export function terminalStatus(status: string): boolean {
  return status
    .toLowerCase()
    .split(CLAUSE_BOUNDARY_PATTERN)
    .some((clause) => {
      let negated = false;
      for (const token of clause.split(TOKEN_SPLIT_PATTERN)) {
        if (token === "") continue;
        if (NEGATION_TOKENS.has(token)) {
          negated = true;
          continue;
        }
        if (TERMINAL_STATUS_TOKEN_SET.has(token) && !negated) return true;
      }
      return false;
    });
}

/** True when the status contains any recognized status word. */
export function recognizedStatus(status: string): boolean {
  const lower = status.toLowerCase();
  return RECOGNIZED_STATUS_TOKENS.some((token) => lower.includes(token));
}
