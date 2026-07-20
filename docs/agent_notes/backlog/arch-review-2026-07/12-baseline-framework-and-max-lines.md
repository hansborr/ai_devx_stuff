# 12. One baseline update/gate layer + max-lines exceptions as a real baseline

Status: **Done — leaf complete 2026-07-07**; the last deferred piece (the
git-attributes merge-driver wiring) landed via the merge-driver field
exercise (Done 2026-07-16): `.gitattributes` now maps both baselines to
their semantic merge drivers and `scripts/tests/test-lint-ratchet.sh`
asserts the driver install. Verified on main at the 2026-07-19 triage.
Slice 1 (framework + knip identity ledger) landed on main via
`chore/arch-12-baseline-framework`; slice 2 (max-lines) done on
`chore/arch-12-max-lines-baseline`. See "Slice 1 outcome" and "Slice 2 outcome".
Size: M-L · Severity: med · Risk: medium on the framework, low on max-lines
Source: 00-report.md T5 / A4, **rewritten during promotion** — see Corrections
in 00-report.md

## Slice 2 outcome (2026-07-07)

- Moved `maxLinesPolicy.exceptions` (25 per-file cap entries) out of
  `eslint-config/shared-policy.js` into a real baseline on the framework:
  `eslint-config/max-lines-exceptions.baseline.json`. Each exception is a
  count-bearing entry — key is the repo-relative path, count is the line cap —
  with the reason/lifecycle prose and severity/ratchetExcluded flags preserved
  as entry metadata. `scripts/max-lines-exceptions.ts` owns the framework spec,
  a `--check` gate (parse integrity + normalization), and a `--update`
  normalizer; the count-aware gate from slice 1 (`gateEntries`) is the diff
  primitive (a raised cap regresses, a lowered cap wants a baseline update).
- `shared-policy.js` reads the committed JSON at eslint-config-load time,
  **fail-loud** (mirrors `config-surfaces.js`'s manifest read), and exposes an
  identical `maxLinesPolicy.exceptions` shape, so the eslint-config override
  builder and `scripts/lint-ratchet/max-lines-policy.ts` are unchanged.
- Behavior-identical: the existing `eslint-rules/max-lines-policy.test.js`
  resolves `local/max-lines` via `eslint.calculateConfigForFile` for all 25
  exceptions and still gets the same `{severity, max, ...counting}`. The caps
  carried over exactly, including arch-10's `path-policy-smoke-subjects-data.ts`
  535→536 bump.
- Wiring: `lint:max-lines-exceptions` is a registered sensor control;
  `:update` is EXEMPT (mirrors `lint:ratchet:update`). Fixture copy-sets that
  copy `shared-policy.js` now copy the JSON too (7 shell fixtures); coverage-map
  rows added; the `local/max-lines` rule message and `local-eslint-rules.md`
  point people at the JSON + `--update` instead of the old source table.

### Review fixes (Codex, 2026-07-07 — land-after-fixes; both addressed)

- **P1 — the check now runs in every verify lane.** The registered control was
  a phantom: no verify/verify:changed/verify:parallel/pre-commit slot ran it, so
  framework-only drift (stale `summary.count`, unsorted entries, duplicate keys,
  non-normalized bytes, textual-merge damage) could land undetected. Added a
  `max-lines-exceptions` slot (`bun run lint:max-lines-exceptions`) to all four
  verify-wrapper controls in `harness.controls.json`, mirroring
  `knip-unused-exports`, and regenerated `scripts/verify/steps.generated.sh` +
  the harness-controls doc. The `--check` is a cheap JSON parse, so it runs in
  every lane (no relevance gating needed), and a real `verify:changed` executes
  it.
- **P2 — lifecycle enum aligned to two values.** `temporary` was accepted by
  the new core parser, the `.d.ts`, and the eslint-rules test but rejected by
  `scripts/lint-ratchet/max-lines-policy.ts`. Aligned all four surfaces to the
  strict `permanent | candidate-for-split` that the runtime validator already
  enforced (no committed entry uses `temporary`).

## Slice 1 outcome (2026-07-07)

- Extracted the ratchet's update/gate/merge layer over item-keyed baselines
  into `scripts/lib/baseline/` (`entry-baseline.ts` format/parse with a derived
  `summary` integrity check, `gate.ts` symmetric floor, `merge.ts` three-way
  min-merge with post-merge truth-up). Collectors stay bespoke; the framework
  never runs a tool. A `count` field defaults to 1 so identity ledgers and
  cap-style metrics share one merge.
- Migrated the knip unused-export sensor onto it as the first consumer (leaf
  61's identity ledger): `(category, path, symbol)` keys, counts derived from
  entries, a symmetric gate that now blocks same-count swaps, and a semantic
  merge CLI (`sensor-knip-unused-exports-merge-cli.ts`) on `mergeBaseline`.
- v1→v2 migration is count-verified with no `ignoreIssues` changes: exports
  preserved at 75; types 115→114 (190→189) solely because the rewrite drops the
  old count-only module's `KnipUnusedExportsCategoryCounts` type (exported but
  referenced only within its own file, so knip flagged it). No framework or
  sensor-internal symbol leaks into the ledger.
- The ratchet's own merge driver is **untouched** — merge-driver semantics
  preserved exactly; the full ratchet + merge-driver + knip-post-merge-hook
  smoke test and the 2266-test scripts suite stay green.
- **Deferred (tracked follow-up):** wiring the knip v2 baseline into
  `.git/info/attributes` so a real `git merge` auto-invokes the semantic merge
  CLI. The merge *capability* is delivered (framework `mergeBaseline` + knip
  merge CLI, unit-tested) and knip keeps its advisory post-merge truth-up hook;
  converging the two merge-driver installers touches the shared installer/lib
  and its ~14 assertion sites (the flagged highest-risk edge), so it belongs
  with the sanctioned merge-driver field exercise (completed Done 2026-07-16;
  note removed at the 2026-07-19 triage — git history) rather than riding
  this slice.

### Review fixes (Codex, 2026-07-07 — land-after-fixes; both P1s addressed)

- **P1-1 — the unwired v2 merge path must not fail silently.** While the
  git-attributes driver stays deferred, a plain textual merge of the ~200-entry
  v2 baseline can combine disjoint entry changes with a stale summary; the
  sensor then rejects it as an integrity failure (exit 2), which the advisory
  post-merge hook previously swallowed. The hook now distinguishes an
  `ERROR: baseline ...` integrity failure (loud, with repair guidance pointing
  at `--update` and the semantic merge CLI) from a transient `ERROR: knip ...`
  run failure (still silent). The discriminator is a line-anchored
  `grep -qE '^ERROR: baseline'` over the captured output, not a whole-output
  prefix match — `bun run` echoes the script command and the sensor prints a
  knip self-scan heartbeat before parsing, so the marker is never the first
  line. Covered by two new cases at the existing truth-up assertion site in
  `scripts/tests/test-lint-ratchet.sh`, whose fixtures carry that realistic
  echo+heartbeat prefix.
- **P1-2 — the shared gate is now count-aware.** `gate.ts` (renamed
  `gateEntryKeys` → `gateEntries`) compares per-key counts as well as key-set
  membership: a shared key whose current count rose blocks; a lower count
  requires a baseline update (symmetric). Identity ledgers (counts absent → 1)
  never move on the count axis, so knip's observable behavior is unchanged.
  This makes the gate reusable for slice 2's max-lines caps and the suppression
  ledger. New unit tests cover both axes.

## Corrections applied (2026-07-07)

- The report's "split `lint-ratchet.baseline.json` per-rule" proposal is
  **dropped**: per-rule sharding was rejected as won't-do on 2026-07-02
  (`../harness-review-2026-07/13-baseline-sharding-per-ratchet.md`) after the
  semantic min-merge driver landed (`e8b9f7db`, hardened `6a0106df`) and
  covered both collision classes, including one sharding cannot fix. Do not
  reopen without new evidence that the driver is insufficient. The owner has
  scheduled a real-merge field exercise of the driver — completed Done
  2026-07-16 (`merge-driver-field-exercise.md`, removed at the 2026-07-19
  triage; git history) — its findings are the sanctioned path to such
  evidence.
- The knip-sensor identity gap was implemented on the extracted framework;
  the remaining open seam is the git-attributes wiring tracked below.

## Problem (remaining, still real)

The count-floor idea is implemented four independent times with four
parse/compare/format/update UXes: the full ratchet engine
(`baseline-update.ts`, `baseline-merge.ts`, debt log, `--allow-worse`,
retirement proof); the knip sensor reimplementing compare/format from scratch
(`scripts/sensor-knip-unused-exports-baseline.ts:39-154`);
`scripts/sensor-blob-size.ts` (fixed thresholds + allowlist, a third model);
and `eslint-config/shared-policy.js:130-359` `maxLinesPolicy.exceptions` — a
28-entry hand-maintained cap table with manually-incremented counters in
prose ("+1 for the … import", `:193`) — exactly the drift the ratchet was
built to prevent, living in source.

## Scope — two slices (Fable consult ruling, 2026-07-07)

A Fable 5 consult on sequencing vs lint-deep-dive leaf 61 recommended
framework-first with this leaf sliced, and rejected a standalone leaf-61
implementation: 61's identity ledger is structurally the ratchet's item model
(richer key, implicit count of 1), so landing it standalone hand-writes a
second item-level compare/format/update that this leaf then deletes — and
silently gives up the semantic merge driver on a new ~282-entry baseline
file. The suppression ledger (harness-review leaf 50 step 2) is the queued
third consumer that makes the abstraction earned.

**Slice 1 — framework + knip (dispatch as one mission):** extract the
ratchet's update/gate/debt-log **+ merge-driver** layer over item-keyed
baselines behind a `Baseline<Metric>` abstraction (leave collectors bespoke;
do not force the ratchet's rich item model onto scalar sensors), then migrate
the knip sensor onto it as the first consumer, implementing leaf 61's
identity-ledger design (deterministic `(category, file, symbol)` keys, counts
derived from entries, symmetric gate, count-verified v1→v2 migration with no
`ignoreIssues` changes riding along).

**Slice 2 — max-lines (separate, later):** move `maxLinesPolicy.exceptions`
out of `shared-policy.js` into a real baseline on the framework, preserving
the reason/lifecycle prose as metadata. Kept out of slice 1 so 61 does not
inherit this slice's risk.

- Merge-driver semantics must be preserved exactly — highest-risk edge of
  slice 1.

## Verification

- Existing ratchet tests (14 files) green; knip sensor and max-lines gates
  behave identically on current baselines; merge-driver tests green.
