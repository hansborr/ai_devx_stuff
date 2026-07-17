# Sources and verdicts — lint-adoption-2026-07

Status: Provenance record (shared context for the pack; not a task leaf)
Created: 2026-07-15

## Where this pack comes from

The 2026-07-15 lint-as-harness research compared three repos: **Musi** (this
repo), **Factory AI's `@factory/eslint-plugin`**, and **`eslint-plugin-llm-core`**.
Inputs were six first-hand evidence reports (Sonnet/Opus explorers with shell
access) plus two cross-model opinion reports (07 = GPT/codex, 08 = Grok, thinner
evidence — no shell access). Where reports conflicted on facts, first-hand
evidence won; judgment disagreements were adjudicated inline in the consolidated
report.

Full report: `~/persist/lint-research-2026-07-15/FINAL-consolidated-report.md`
(outside the repo; the load-bearing claims for each leaf were re-verified
against HEAD on 2026-07-15 and recorded in the leaves, so the leaves stand
alone if the report directory is gone).

Headline verdict (codex, endorsed by the synthesis): the winning design is
**Musi's enforcement machinery carrying llm-core's rule catalog and message
science**. Musi already leads on type-escape discipline, artifact detection,
domain concurrency contracts, barrels/dead exports, and message contracts. Its
gaps — the ten leaves in this pack — are duplication *enforcement*, structural
looseness (function length, nesting), a correctness micro-rule cluster,
effect-misuse enforcement, error-semantics siblings, and measurement.

## Priority adjudications worth remembering

- **Leaf 10 (near-duplicate gate):** Grok ranked it P2 ("out of ESLint's sweet
  spot") — right about mechanism (it is a sensor, not an ESLint rule), wrong on
  priority because it missed that `scripts/drift-ai/near-duplicates.ts` already
  exists and gates nothing. Overruled to P0.
- **Leaf 11 (function length/nesting):** unanimous direction across all three
  models; codex's calibration adopted — do not copy llm-core's 50-line
  monorepo-wide limit in one step.
- **Leaf 13 (envelope overlay):** proposed only by codex; neither other report
  examined the envelope plumbing. Adopted at P0 on judgment — it multiplies the
  value of every rule Musi already runs.
- **Leaf 20 (correctness bundle):** Grok ranked P0, others P1. Adjudicated P1
  by leverage (individually low-frequency bugs) but trivially cheap to land.
- **Leaf 23 (`no-commented-out-code`):** 06 said P0, 07 said P2 with a
  calibration warning. Adjudicated P1 with codex's calibration (ratchet only
  multi-line operative-code regions).

## Explicit non-recommendations (unanimous — do not re-propose)

- **Factory's blanket bans** (`useEffect`/`useMemo`/`useCallback`/`.then()`/
  `fetch()`/`style` props): they erase legitimate intent and encourage
  syntactic workarounds; internally inconsistent even in Factory's own config
  (bans all `useEffect` while enabling `exhaustive-deps` to check the hooks it
  banned).
- **Factory's file-organization matrix** (`types.ts`/`enums.ts`/…): a different
  product's layout orthodoxy that fights Musi's colocation grain.
- **`require-test-files`** (file-existence coverage proxy): agents satisfy it
  with stubs; Musi's `test-file-location` (must contain a real test block) is
  already the stronger design.
- **llm-core's preset wholesale:** codex proved "recommended" ≠ internally
  coherent (its own preset contains a rule whose fix example, `as unknown as
  T`, is exactly what a sibling rule bans — an agent following the messages
  oscillates forever). Adopt rules individually; leaf 20 does that.
- **llm-core's `no-unsafe-array-access`:** redundant with Musi's
  `noUncheckedIndexedAccess`; would encourage redundant runtime checks.
- **Anything Musi already does better** — assertion boundary, TODO references,
  barrels, concurrency guards, artifact detection: no action.

## P2 watchlist (situational; not leaves, revisit if their trigger fires)

- `sonarjs/cognitive-complexity` alongside cyclomatic — partial overlap with
  the leaf-11 nesting rule; ratchet-in only if adopted after leaf 11 lands.
- `filename-match-export`, narrowly scoped to single-primary-export
  components/services/hooks with kebab-case translation (majority P2). Agents
  navigate by names, but Musi's mixed modules and route files make an
  indiscriminate version noisy.
- Session-start active-instructions surface (07): a compact, scope-aware
  equivalent of llm-core's `get_active_instructions`, supplementing the
  edit-time envelope leaf 13 extends.
- Promote `no-magic-numbers` and `naming-convention` warn→error via ratchet —
  low incremental value; `--max-warnings=0` already blocks them in gates, so
  this is mostly editor-signal hygiene.

## Known caveat carried from the research

llm-core's "54% fewer iterations" eval table is example output illustrating its
report format — the results directory is empty in the clone and no committed
run exists. Leaf 22 adopts the eval *method* (treatment vs. control messages),
not that number.
