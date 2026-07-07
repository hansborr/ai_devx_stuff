# 12. One baseline update/gate layer + max-lines exceptions as a real baseline

Status: Pending
Size: M-L · Severity: med · Risk: medium on the framework, low on max-lines
Source: 00-report.md T5 / A4, **rewritten during promotion** — see Corrections
in 00-report.md

## Corrections applied (2026-07-07)

- The report's "split `lint-ratchet.baseline.json` per-rule" proposal is
  **dropped**: per-rule sharding was rejected as won't-do on 2026-07-02
  (`../harness-review-2026-07/13-baseline-sharding-per-ratchet.md`) after the
  semantic min-merge driver landed (`e8b9f7db`, hardened `6a0106df`) and
  covered both collision classes, including one sharding cannot fix. Do not
  reopen without new evidence that the driver is insufficient. The owner has
  scheduled a real-merge field exercise of the driver
  (`../merge-driver-field-exercise.md`, after the agent-cli pack) — its
  findings are the sanctioned path to such evidence.
- The knip-sensor identity gap already has a drafted design:
  `../lint-deep-dive-2026-07/61-knip-identity-baseline.md` (deferred pending
  owner review). Coordinate — implementing 61's identity ledger *on* the
  extracted framework is the natural combined slice.

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
