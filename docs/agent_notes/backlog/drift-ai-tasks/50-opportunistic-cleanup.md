# Task 50 — Opportunistic maintainability cleanup (checklist)

**Track:** X (cleanup / optional)  **Size:** medium (a checklist — each item is independently pickable)
**Status:** Done
**Depends on:** none globally; **per-item** dependencies noted inline (several items depend on tasks **20** and **21**).
**Blocks:** none.

**Progress (2026-05-29):** Done — all checklist items are closed. Final pass
landed Med-1 (shared `formatFindingLines` plus `repo-io` safe path/read/list/probe
factories), Med-3 (duplicates no longer re-export runner/bin APIs; suppressions
keeps parser constants in the parser module), Med-4 (shared `scanLine` lexer
core used by comments and suppressions), and Low-4 (`ghost-files` `weakTokens`
and `entryPointStems` config knobs). Earlier passes had already landed Med-2,
Med-5, A6, Low-1, Low-3, and Low-5. Low-2 remains closed with task 51.

## Goal

Land the medium/low maintainability cleanups that are **not** on the critical
path but still remove real drift risk from `scripts/drift-ai/`. These are the
Med-1..Med-5 / Low-1..Low-5 findings from the code-quality review plus the A6 /
M4 / L1 UX items that don't belong to a single feature task.

This file is a **checklist**: each item is self-contained and can be picked up
independently (subject to its noted depends-on). Picking one item should not
require doing the others. Keep the drift:ai philosophy intact — evidence, not
verdicts; report-only default exit (see `01-shared-context.md` §3).

## Context

- Tool overview, layout, philosophy: `01-shared-context.md` §1–§3, §5.
- All `file:line` seams cited below live in `02-seam-map.md`; re-confirm line
  numbers before editing (they were captured at authoring time).
- Source review rationale: `../drift-ai-review/code-quality.md` (Med-1..Med-5,
  Low-1..Low-5, Tests) and `../drift-ai-review/ux-reporting.md` (M4, L1, A6).
- Critical-path tasks this file defers to: **20** (removes duplicated helpers),
  **21** (schemaVersion/details ownership), **22** (chunks test). **40** is the
  hotspots task that also wants the shared `--format`/`--output` parser —
  coordinate the parser retrofit (Med-1 sub-item) with it.

## What to do

Each box is independently pickable. Do the depends-on first.

### [x] Med-1 — Shared finding/line renderer + safe-repo-reader factory — **DONE (2026-05-29)**
*Depends on:* task **20** (it removes the duplicated helpers; do this after, or
coordinate so you don't both edit the same copies). *Coordinate with:* task **40**
for the shared parser retrofit.
- Extracted **one** `formatFindingLines` renderer used by both the main formatter
  and harness-freshness. Today the per-finding line rendering is duplicated
  between `format.ts` and `harness-freshness.ts`. Seams: seam-map §8 (renderer),
  §2 (Finding shape), `format.ts:40-120`.
- Extracted **one** `safeRepoPath` + reader + directory-listing/probe factory.
  Promoted
  the canonical version at `checks/harness-freshness-io.ts:35-100`; delete the
  near-duplicate inline copies in the other three check modules (they have
  drifted slightly in error swallowing). Seam: seam-map §6.
- ~~Retrofit harness-freshness onto the shared `--format`/`--output` arg
  parser~~ **DONE in task 40.** The shared subcommand parser landed as
  `scripts/drift-ai/subcommand-args.ts` (`parseSubcommandArgs` +
  `writeSubcommandOutput`, universal `--format`/`--output`/`--config` + per-
  subcommand value options), and `harness-freshness` was retrofitted onto it
  (it now honors `--format text|json` and `--output`). This was the M4 / L1 UX
  item.

### [x] Med-2 — `DRIFT_SCHEMA_VERSION` constant + `details` policy — **DONE (2026-05-29)**
*Depends on:* check task **21** first. **This is likely folded into task 21.**
Only do it here if 21 left it undone.
- ~~Replace the `schemaVersion: 1` magic literal at every emit site with a single
  `DRIFT_SCHEMA_VERSION` constant~~ **already done** — `DRIFT_SCHEMA_VERSION`
  (`types.ts`, now `3`) is the single source consumed by every emitter; no literals
  remain (landed with the schema bumps in tasks 21/32).
- ~~Decide the `details` policy~~ **resolved + documented.** The codebase already
  moved past "suppressions-only": `details` is now populated by suppressions,
  near-duplicates, import-cycles, and harness-freshness. Policy = **optional,
  per-check** (populated only where a check has structured specifics; readers must
  not assume a shape across checks). Documented on the `DriftFinding.details` field
  in `types.ts`.

### [x] Med-3 — Re-split the ceiling-driven module pairs — **DONE (2026-05-29)**
*Depends on:* task **20** (must remove the duplicated helpers first; the re-split
axis only makes sense once shared code is extracted).
- `duplicates.ts` / `duplicates-runner.ts` and `suppressions.ts` /
  `suppressions-parse.ts` were split **only** to stay under the 300-line
  ceiling, not along a responsibility boundary. `duplicates.ts` is a pure
  re-export round-trip of `duplicates-runner.ts`.
- Re-split each pair along a real axis (e.g. orchestration vs engine). Removed
  the round-trip re-export shim. Seams: seam-map §3, §4, §9.
- **Closed decision:** completed here after task 20; no task-20 bundling needed.

### [x] Med-4 — Shared `scanLine(line, state, visitor)` lexer core — **DONE (2026-05-29)**
*Depends on:* none (but it touches the two highest-risk files — coordinate if
task 20/22 is mid-flight there).
- This is the **highest correctness-drift risk** in the tool. `comments.ts` and
  `suppressions-parse.ts` each carry a near-identical hand-rolled state machine
  that walks a line tracking in-string / in-comment state. A fix to escape
  handling or template-literal handling in one **will not propagate** to the
  other. Seam: seam-map §9 (`comments.ts:40-140`,
  `suppressions-parse.ts:40-160`).
- Extracted a shared `scanLine(line, state, visitor)` core. Built the comment-ratio
  counter and the suppression-segment extractor as **two visitors** over that
  core.
- **Minimum viable** if a full extraction is too large for one sitting: share
  the `StringDelim` set + the delimiter/escape advance logic (the part most
  likely to drift).
- Added lexer edge-case tests for template literals and escaped delimiters across
  both the comment metrics path and suppression-segment extraction.

### [x] Med-5 — Single `DriftAiError`→exit-code wrapper — **DONE (2026-05-29)**
*Depends on:* coordinate with Med-1's parser retrofit (both touch
harness-freshness arg handling in `runner.ts`).
- Extracted `toExitResult(err)` in `runner.ts`: maps `DriftAiHelp`→exit 0,
  `DriftAiError`→exit 2, rethrows anything else. The arg-parse, run-preparation,
  and harness-freshness arg-parse try/catch blocks all route through it (the
  three had drifted to slightly different shapes — the prepare block only caught
  `DriftAiError`; now they share one mapping).

### [x] A6 — `--fail-on-findings` opt-in exit code — **DONE (2026-05-29)**
*Depends on:* none.
- Added the opt-in `--fail-on-findings` flag (parsed via the shared
  `parseBooleanFlag` in `cli-args.ts`, threaded through `CliOptions`). When set and
  the run produced findings, `runDriftAi` returns **exit 1**; usage/config errors
  still return **exit 2**. Default stays **exit 0** regardless of findings — the
  report-only contract is unchanged (verified end-to-end against this worktree's
  changed scope: 1 finding → default exit 0, `--fail-on-findings` exit 1).
- Scoped to the main command (the `harness-freshness`/`hotspots` subcommands keep
  their own report-only exit-0 surfaces; expanding the flag to them was left out of
  scope).
- Tests in `scripts/drift-ai.test.ts`: parse flag + default 0 / flag 1 / flag-no-
  findings 0 / usage-error 2.

### [x] Low-1 — Declarative per-option CLI parser — **DONE (already satisfied)**
*Depends on:* none (cleaner after Med-1's parser retrofit lands).
- Already in place: `cli-args.ts` dispatches through an `OPTION_PARSERS`
  `Record<string, OptionParser>` table keyed by option name, with small shared
  parsers (`parsePathOption`, `parseToolPathOption`, `parseBooleanFlag`, …) instead
  of an inline flag-by-flag switch. The `--fail-on-findings` flag (A6) slotted in as
  one table entry, confirming the shape. No further work needed.

### [x] Low-3 — `structuredClone` for `cloneDefaultConfig` — **DONE (2026-05-29)**
*Depends on:* none.
- `cloneDefaultConfig` in `config-paths.ts` is now `return
  structuredClone(DEFAULT_DRIFT_AI_CONFIG)`. Drops the hand-maintained per-field
  deep clone (which had to grow with each new check) and removes the shared-array
  aliasing risk. The defaults are plain JSON-shaped data, so structuredClone covers
  every nested array/object; `structuredClone` is already used elsewhere in the repo.

### [x] Low-4 — Surface ghost-files tuning knobs via config — **DONE (2026-05-29)**
*Depends on:* none.
- `ghost-files.ts:1-40` hard-codes the `WEAK_TOKENS` set and the entry-point
  list. Surface both via config so the check works against non-Musi repos.
  Seam: seam-map §7. (Keep the current values as defaults — evidence, not
  verdicts; don't hide findings.)
- Added `checks["ghost-files"].weakTokens` and `entryPointStems`, with current
  values preserved as defaults and threaded through changed/current matching and
  current-scope bucket fallback.

### [x] Low-5 — `Set`-based `intersection` — **DONE (2026-05-29)**
*Depends on:* none.
- `intersection` in `ghost-files-tokens.ts` already used a `Set` for membership;
  the remaining quadratic part was the `out.includes` dedup. Now both membership
  and dedup use Sets (a `seen` set), so the function is linear while still
  preserving `a`'s order. Covered by the existing ghost-files tests.

### [x] Low-2 — `globToRegExp` as a vetted dep — **CLOSED (task 51 won't-do)**
*Depends on:* the node/npm extraction work (task **51**), which is currently
closed as won't-do. Do not pick this item up unless task 51 is explicitly
reopened for a real distribution need.
- `config.ts:124-150` hand-rolls glob→regex. If the tool is extracted standalone,
  a vetted dep is lower-risk than maintaining the hand-rolled converter. Do
  **not** do this while the tool is bun-internal only. Cross-ref task 51.

## Testing

- Every item must keep all existing Vitest tests green.
- **Med-4** must add lexer edge-case tests covering template literals and escape
  handling that exercise **both** visitors (the comment-ratio counter and the
  suppression-segment extractor) over the shared `scanLine` core — that is the
  whole point of the extraction.
- Add the `chunks.ts` test here **if task 22 did not** (`chunks.ts` exists at
  `scripts/drift-ai/chunks.ts`; there is currently no `chunks.test.ts`).
- For A6, add a test asserting: default run exits 0 with findings;
  `--fail-on-findings` exits 1 with findings; usage/config errors still exit 2.
- For Med-1/Med-5/Low-1, add/keep tests around the shared renderer, reader
  factory, and the wrapper exit mapping.

## Out of scope

- Anything on the critical path: tasks **20**, **21**, **22**. If an item here
  turns out to be owned by one of those, defer to it rather than duplicating.
- New checks or new findings; this is maintainability cleanup, not features.
- The node/npm standalone package itself — task **51** is closed as won't-do.
  Low-2 remains closed unless 51 is reopened.
- Any change that hides findings or makes the default exit non-zero
  (`01-shared-context.md` §3).

## Closed decisions

- **Med-2 / `details` policy:** if task 21 did **not** settle it, decide here
  whether to populate `details` for all checks or document it as
  suppressions-only. Closed by task 21/32: `details` is optional and per-check.
- **Med-3 bundling:** decide whether Med-3 belongs here or should be folded into
  task 20 (it is tightly coupled to 20's helper removal). Default recommendation:
  closed here after task 20 landed.
- **Shared-parser shape (Med-1 / M4 / L1):** task **40** also adopts the shared
  `--format`/`--output` parser. Agree on one parser shape before both land so
  harness-freshness and hotspots converge rather than fork. Closed by task 40.
