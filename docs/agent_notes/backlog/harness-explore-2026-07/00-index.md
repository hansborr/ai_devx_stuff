# Harness Explore 2026-07 — Task Pack

Status: Parked task index (14 surviving leaves)
Created: 2026-07-11
Last triaged: 2026-07-11
Source: read-only exploration of the lint stack, the verify/commit-gate
pipeline, and the harness-controls meta-tooling on 2026-07-11, run as three
of four parallel sweeps (the fourth, worktree-lane infrastructure, is filed
as `../worktree-lane-hardening-2026-07/`).

A **2026-07-11 adversarial triage pass** then ran over every leaf (multi-agent,
one adversarial judge per leaf, each citation re-read at HEAD): **3 confirmed,
14 amended, 5 rejected**. Confirmed and amended leaves carry the triage's
corrections and implementation caveats in place (amended Evidence blocks note
what was added or fixed); rejected leaves are marked `Status: Rejected` here and
in the leaf, with the rejection rationale in the leaf's header. See the Triage
Record below. Even so, re-verify each Evidence block at HEAD before implementing.

Each leaf is one small commit unless its Size says otherwise. Line numbers
were read at HEAD on 2026-07-11 and will drift; reconfirm seams with `rg`
before editing.

Three themes: **mitigations that don't follow the tool** (heap policy only at
gate boundaries, an unsalted agent cache), **hand-maintained lists next to a
generator culture that already knows better** (staleness regex, allowlists,
exempt scripts, the coverage map), and **duplication across the gate scripts**
(changed-file collection, the gate skeleton, hook trios).

The exploration also confirmed two previously-recorded frictions are already
solved and only under-documented: smoke-test registration is single-sourced
via `# smoke-subjects:` headers, and config-file registration via
`eslint-config/config-surface-manifest.json`. Leaf 13 covers the one surface
still hand-edited.

## Task List

Tracks: **T** tooling/config, **DOC** docs.

| # | Task | Track | Size | Priority | Depends on | Status |
|---|---|---|---|---|---|---|
| 03 | [lint-agent uses a different, unsalted ESLint cache](./03-lint-agent-unsalted-cache.md) | T | S | P2 | none | Done |
| 04 | [Gate timing constants duplicated as bare literals](./04-gate-timing-constants.md) | T | S | P2 | none | Done |
| 05 | [Generated-surface staleness regex is hand-maintained](./05-generated-surface-regex-from-manifest.md) | T | S | P2 | none | Done |
| 06 | [doctor-check ids not parity-gated against the manifest](./06-doctor-check-manifest-parity.md) | T | S | P2 | none | Done |
| 07 | [test-scripts log dir is /tmp-global, not worktree-scoped](./07-test-scripts-log-dir-worktree-scope.md) | T | XS | P2 | none | Done |
| 08 | [Changed-file collection loop copy-pasted across three scripts](./08-shared-changed-file-collection.md) | T | M | P2 | none | Done |
| 09 | [Suppression scanners have no changed-scope mode](./09-suppression-scanners-changed-scope.md) | T | M | P2 | none | Done |
| 11 | [Hook trios triplicated; installers run on file checkouts](./11-hook-trio-dedup.md) | T | S | P3 | none | Done |
| 12 | [Suppression allowlists buried in bash; hadolint pin ineffective](./12-suppression-policy-as-data.md) | T | M | P2 | none | Done |
| 13 | [lint-coverage-map.md is hand-edited under docs/generated/](./13-generate-lint-coverage-map.md) | T | S | P3 | none | Done |
| 16 | [Gate outcome (real/bridged/skipped) not recorded in run metadata](./16-record-gate-run-mode.md) | T | S | P3 | none | Done |
| 19 | [Make the porting-knob list greppable and verifiable](./19-copyability-config-block.md) | T | M | P3 | none | Done |
| 20 | [lint-ratchet module naming/fragmentation consolidation](./20-lint-ratchet-module-naming.md) | T | M | P3 | none | Done |
| 21 | [Split the merge-conflict runbook out of lint-ratchet.md](./21-split-lint-ratchet-guide.md) | DOC | S | P3 | none | Done |

## Triage Record (2026-07-11 adversarial pass)

Multi-agent adversarial triage, one judge per leaf, every citation re-read at
HEAD. Tally: **3 confirmed, 14 amended, 5 rejected** (22 leaves).

- **Confirmed (finding + fix stand):** 04, 07. Citations exact; the judge's
  implementation caveats are folded into each leaf's header note.
- **Amended (kept, corrected in place):** 01, 02, 03, 05, 06, 08, 09, 11, 12,
  13, 16, 19, 20, 21. Evidence errors fixed, fixes tightened, and several
  Size/Priority adjusted: **03** P1→P2 (only the advisory agent cache can lie;
  gate lanes stay salted), **12** P3→P2 / S→M (the hadolint pin is dead, not
  duplicated — the wrapper floats to `latest`), **13** M→S, **19** L→M (scope
  narrowed to a greppable porting-knob marker), **01**'s widest race path (the
  prepare-time `rm -f`) added.
- **Rejected (do not re-file without new evidence):** 10 (dedup already largely
  done in `76bdb9cc`; residual differences are intentional policy), 14
  (perf/duplication premise false; ~20ms/spawn, nothing duplicated), 15 (fix
  cannot recover wall time — producing dist *is* `tsc -b`), 17 (commitlint's own
  output already prints config-derived thresholds), 18 (`lint.sh` already a
  registered smoke subject of `test-lint-dist-preflight.sh`). Each leaf carries
  its full rejection rationale.

## Recommended Order

(Rejected leaves 10, 14, 15, 17, 18 are omitted below.)

1. **P1 correctness first:** 02 (smallest, closes the known OOM path) →
   01 (needs a two-worktree regression test; larger of the two).
2. **P2 drift/robustness:** 03, 04, 05, 06, 07, 12 in any order; then 08 → 09
   (09 builds on 08's shared collection helper).
3. **P3 in any order.** 19 benefits from landing after 05 and 12 shrink the
   list of scattered assumptions.

## Promotion Rules

1. Promote one leaf at a time; read the leaf's Evidence block and re-verify
   every citation at HEAD before editing.
2. Keep each leaf to one commit unless the leaf says otherwise; update this
   index's Status column in the same commit that finishes a leaf.
