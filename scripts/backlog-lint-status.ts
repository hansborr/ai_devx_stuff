/**
 * Shared status-token vocabulary for the backlog advisory lint.
 *
 * Both the per-file front-matter checks (backlog-lint-core) and the pack-level
 * index checks (backlog-lint-packs) classify a note's `Status:` value against
 * this single source of truth, so index-vs-leaf drift and the per-file checks
 * agree on what "terminal" (finished) means.
 */

/**
 * Status words that mean a leaf/row is finished, wherever they sit in a clause.
 *
 * `cancelled`, `finalized`, and `finished` joined the list on 2026-08-30 (leaf
 * 084): they mean exactly what `rejected` and `done` already mean, and eight
 * tracked notes were reading as open work purely because the vocabulary lacked
 * the plain-English spelling. Membership here is the strong claim — a word
 * belongs only if it closes a note from anywhere in its clause.
 */
const TERMINAL_STATUS_TOKENS = [
  "cancelled",
  "closed",
  "decided",
  "done",
  "drained",
  "finalized",
  "finished",
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
  "final",
  "historical",
] as const;

/**
 * The ruling on self-declared closure (2026-08-30, leaf 084).
 *
 * Eight of the recognized non-terminal words above do double duty. In the
 * middle of a status they report on something else — "HC-1 landed", "the
 * provenance record lives in DRAIN.md", "largely landed", "the historical
 * finding below", "final parity measurements" — but when one of them *opens* a
 * status value the note is declaring its own state or role: `Landed on
 * fix/cq-084`, `Reference — standing rulings`, `Provenance record (not a task
 * leaf)`, `Historical — nothing here is in flight`, `Final audit record`. Read
 * in lead position they close the note; read anywhere else they do not. That is
 * the whole rule, and it is why these words stay in the one vocabulary below
 * rather than moving to the terminal list: `satisfies` pins every entry here to
 * a member of {@link ACTIVE_STATUS_TOKENS}, so there is no second vocabulary to
 * drift. A plain closure verb (`finished`, `cancelled`, `finalized`) is not on
 * this list because it needs no lead position — it is terminal outright.
 *
 * Deliberately not extended to {@link terminalStatus}, which asks a different
 * question about a different subject (an index row's claim about its leaf) and
 * whose answers the index-vs-leaf drift check is calibrated against.
 */
const LEAD_CLOSING_STATUS_TOKENS = [
  "landed",
  "resolved",
  "complete",
  "reference",
  "record",
  "provenance",
  "final",
  "historical",
] as const satisfies readonly (typeof ACTIVE_STATUS_TOKENS)[number][];

const LEAD_CLOSING_STATUS_TOKEN_SET: ReadonlySet<string> = new Set(LEAD_CLOSING_STATUS_TOKENS);

const RECOGNIZED_STATUS_TOKENS: readonly string[] = [
  ...TERMINAL_STATUS_TOKENS,
  ...ACTIVE_STATUS_TOKENS,
];

const TERMINAL_STATUS_TOKEN_SET: ReadonlySet<string> = new Set(TERMINAL_STATUS_TOKENS);

const RECOGNIZED_STATUS_TOKEN_SET: ReadonlySet<string> = new Set(RECOGNIZED_STATUS_TOKENS);

// Negation words that neutralize a terminal token appearing later in the same
// clause, so "NOT implemented" / "not yet done" / "no longer shipped" stay
// active. An intervening adverb ("not really done") does not clear the negation.
const NEGATION_TOKENS: ReadonlySet<string> = new Set(["not", "no", "never"]);

// Hedges neutralize a following terminal token the same way a negation does: a
// partial completion is not a completion. "Mostly drained — 10 and the 05 probe
// remain" and "PARTIALLY IMPLEMENTED … RESIDUAL OPEN" are the two tracked notes
// this rule keeps out of the terminal bucket, which is the costlier direction
// to get wrong — open work that reads finished disappears from the catalog.
// Order is load-bearing in both sets: the qualifier must precede the token it
// qualifies, so "Done for the pairing half" stays terminal.
const HEDGE_TOKENS: ReadonlySet<string> = new Set([
  "largely",
  "mostly",
  "partially",
  "partly",
  "nearly",
  "almost",
  "half",
]);

/** True when `token` denies or dilutes a terminal word later in its clause. */
function neutralizesCompletion(token: string): boolean {
  return NEGATION_TOKENS.has(token) || HEDGE_TOKENS.has(token);
}

// Punctuation that ends a clause; a negation does not carry past it, so a later
// clause's terminal token ("Not started; done elsewhere") still reads finished.
const CLAUSE_BOUNDARY_PATTERN = /[.;:,/|()[\]{}—–-]+/u;

// Split a clause into lowercase word tokens (letters/digits), dropping empties.
const TOKEN_SPLIT_PATTERN = /[^a-z0-9]+/u;

/**
 * True when the status value reads as finished work. Terminal tokens are matched
 * on whole words (so "unimplemented" is not read as "implemented"), and a token
 * is neutralized when a negation ("not"/"no"/"never") or a hedge ("mostly",
 * "partially", …) precedes it in the same clause, so "Proposed — NOT
 * implemented" and "Mostly drained" both remain active.
 */
export function terminalStatus(status: string): boolean {
  return status
    .toLowerCase()
    .split(CLAUSE_BOUNDARY_PATTERN)
    .some((clause) => {
      let neutralized = false;
      for (const token of clause.split(TOKEN_SPLIT_PATTERN)) {
        if (token === "") continue;
        if (neutralizesCompletion(token)) {
          neutralized = true;
          continue;
        }
        if (TERMINAL_STATUS_TOKEN_SET.has(token) && !neutralized) return true;
      }
      return false;
    });
}

/** The status value as clauses of lowercase word tokens, empty clauses dropped. */
function clauseTokens(status: string): string[][] {
  return status
    .toLowerCase()
    .split(CLAUSE_BOUNDARY_PATTERN)
    .map((clause) => clause.split(TOKEN_SPLIT_PATTERN).filter((token) => token !== ""))
    .filter((tokens) => tokens.length > 0);
}

/**
 * What one clause says about the note: that it is closed, that it declares some
 * other recognized state, or nothing the vocabulary recognizes.
 */
function scanClause(
  tokens: readonly string[],
  leadingClause: boolean,
): "terminal" | "declared" | "silent" {
  let neutralized = false;
  let recognized = false;
  for (const [position, token] of tokens.entries()) {
    if (neutralizesCompletion(token)) {
      neutralized = true;
      continue;
    }
    if (TERMINAL_STATUS_TOKEN_SET.has(token) && !neutralized) return "terminal";
    if (leadingClause && position === 0 && LEAD_CLOSING_STATUS_TOKEN_SET.has(token)) {
      return "terminal";
    }
    if (RECOGNIZED_STATUS_TOKEN_SET.has(token)) recognized = true;
  }
  return recognized ? "declared" : "silent";
}

/**
 * The lifecycle state a note declares **for itself**.
 *
 * This is a different question from {@link terminalStatus}, which asks whether
 * a piece of status text asserts completion *anywhere* — the right reading for
 * an index row's short Status cell, where any completion claim is about that
 * row's leaf. A note's own Status value is a sentence, and its later clauses
 * routinely report on sub-items: `largely landed (reconciled 2026-07-19). DL-1
 * and A11Y-1 are Done` declares unfinished work while naming two finished
 * children.
 *
 * Three rules, in the order the scan applies them:
 *
 * 1. **A terminal word closes the note, wherever it sits in its clause, unless
 *    a negation or a hedge precedes it there.** A clause is one statement, so
 *    `Parked superseded by 142` is terminal — the unpunctuated sentence says
 *    the parked item was superseded — while `Mostly drained` is not, because a
 *    partial completion is not a completion. Punctuation is therefore
 *    load-bearing: `Parked. Superseded by 142` is two statements, and rule 3
 *    stops at the first.
 * 2. **A {@link LEAD_CLOSING_STATUS_TOKENS} word closes the note only when it
 *    opens the status value** — `Landed on fix/cq-084` and `Reference —
 *    standing rulings` declare themselves closed; `largely landed`, `HC-1
 *    landed`, and `Not landed yet` do not, the last because the negation takes
 *    the lead position.
 * 3. **Otherwise the first clause that declares any recognized state wins**,
 *    and a status with no recognized token at all (`Not started`) stays
 *    actionable rather than becoming a third, unactionable bucket.
 *
 * Known limits. Measured by classifying the whole tracked corpus on 2026-08-30
 * — 709 notes, 282 actionable / 311 terminal / 116 with no status:
 *
 * - **Closure past the first token stays actionable.** 32 actionable notes
 *   carry a completion or role word somewhere after the lead position. The
 *   reading is right for most of them (`HC-1 landed (…); HS-1 is half-landed`,
 *   `Open leaves (small); item 1 landed 2026-07-19`) and wrong for ten that
 *   are genuinely closed: the six `Scheduled work landed 2026-08-01 on …`
 *   leaves, `All 15 slices landed.`, `triage + review complete …`, `review
 *   complete; … superseded by …`, and `Living reference index`. The classifier
 *   cannot tell a note's own subject from a sub-item's, so this is the note's
 *   wording to fix, not the classifier's.
 * - **A note that misdescribes itself is classified as it is written.** The
 *   lead-position rule closes 147 notes on their own first word. One names a
 *   remainder it does not hedge — `Landed (3a, 3b, 3c-Track-A) — only
 *   3c-Track-B deferred` — and one closes a still-dispatching pack index:
 *   `code-quality-2026-08-01/00-index.md` opens `Finalized and landed on
 *   main`, so its own row reads terminal while the pack still holds 150
 *   actionable leaves. Read the per-pack counts, not the index row, for a
 *   pack's state.
 *
 * Both readings share this module's one vocabulary, clause splitting, and
 * negation/hedge semantics; neither forks it.
 */
export function lifecycleFromStatus(status: string): "actionable" | "terminal" {
  for (const [index, tokens] of clauseTokens(status).entries()) {
    const verdict = scanClause(tokens, index === 0);
    if (verdict === "terminal") return "terminal";
    if (verdict === "declared") return "actionable";
  }
  return "actionable";
}

/** True when the status contains any recognized status word. */
export function recognizedStatus(status: string): boolean {
  const lower = status.toLowerCase();
  return RECOGNIZED_STATUS_TOKENS.some((token) => lower.includes(token));
}
