# Lint Architecture Review 2026-07 — Task Pack

Status: Reconciled residue — 2026-07-18 evening (the 2026-07-18 drain landed
leaf 05 item 1, leaf 12, and leaf 13's operations slice — see the drain
record; their leaf files were removed and are summarized in the landed
record below. Remaining open: 07 (trigger-gated), 13's rejected full-driver
record (trigger + owner ruling), 14 (accepted 2026-07-18 — adopt with
modifications, re-sized S→M, ready to schedule))
Created: 2026-07-16

Source: the 2026-07-16 five-model architecture review of the lint system
(Claude Sonnet 5, Claude Opus 4.8, GPT/Codex, Grok 4.5, Gemini 3.5 Flash —
independent read-only reviews, synthesized and spot-verified by Claude
Fable 5). Full report artifact:
<https://claude.ai/code/artifact/423b110c-a697-47a4-8e27-7be44510995e>.

Overall verdict: the semantics are right (strict floor, item-keyed committed
baselines, symmetric gate, semantic-minimum merge, append-only debt log,
zero-as-lifecycle-event — all unanimous KEEPs); the packaging is wrong. Of
the two root causes, one is fixed — the ratchet engine migrated onto the
generic `scripts/lib/baseline/` kernel 2026-07-17 (leaf 01) — and one is
open: the "portable" surface is still a synchronized source-tree fork (copy
manifest + demo-sync harness) instead of a package boundary (leaf 02).

## Open leaves

| # | Task | Priority | Size | Status |
| --- | --- | --- | --- | --- |
| 02 | [Replace the copy manifest with a real package seam](./02-package-seam-replaces-copy-manifest.md) | P0 | L | DONE 2026-07-18 — S0–S5 landed on main (final merge 6e685069): engine in `tools/lint-ratchet` (`@musi/lint-ratchet`, layers 1–3) behind the context/binding seam, Musi adapter stays in `scripts/`, demo flipped to a workspace consumer with an end-to-end CI smoke, copy manifest + demo-sync harness deleted. Follow-up recorded in the leaf: debt-accounting needs a net-neutral-rename primitive |
| 07 | [Author the coverage map as data, render the Markdown](./07-coverage-map-as-data.md) | P1 | M | Proposed — trigger: next checker schema change (deliberately skipped in the 2026-07 drains per this trigger) |
| 13 | [CLI driver inside the package](./13-package-cli-driver.md) | P2 | M | Operations slice DONE 2026-07-18 (drain phase 4, merge `e1fa3141`) — `runGate`/`runUpdate` live as typed-error, data-in/data-out package operations and both adapters are rebased onto them; the full driver stays rejected (trigger: a third real adapter, and reopening leaf 02 dispatch ruling 2 needs an owner ruling — the leaf records the evidence) |
| 14 | [Enumerate the package's subpath exports](./14-enumerated-subpath-exports.md) | P2 | M | Accepted 2026-07-18 — adopt with modifications (owner ruling in the leaf, via Fable + Codex consult): classify-then-enumerate, not wholesale; re-measured 39 adapter subpaths (one dynamic import); two prerequisites re-size S→M (internal imports go relative — 20 self-name imports; close the `tsconfig.scripts.json` wildcard-`paths` bypass). Ready to schedule |

## Landed record — 2026-07-18 (leaf files removed; full text in git history)

- **05 — stop the engine fragmenting under its own rules (P1/M)**: both items
  now landed. Item 2 (cap policy) landed 2026-07-17 as leaf 02's S0 (scoped
  ~500-line zone cap in config; exceptions baseline stays the outlier escape
  hatch). Item 1 (consolidation, merge `c3b233de`): `baseline-format.ts`
  merged into `kernel/baseline.ts` (mutual import killed), the
  `metrics-format`/`metrics-validation` delegators folded into
  `metric-strategies.ts` with the pure re-export barrel `metrics.ts` deleted
  and ~38 consumers repointed to the real modules, and the three debt-log
  schema satellites collapsed into `governance/debt-log-schema.ts` (420
  lines; the cap-headroom disposition from the leaf is preserved in the
  landed record's git history). The keep-separate list was honored verbatim.
- **12 — re-home engine-owned lint-ratchet tests into the package (P1/M)**
  (merge `0dbb5e5d`): 22 adapter-side test files triaged by the
  ownership-by-assertion rule — 12 moved/ported into package fixture
  contexts (helpers copied to `test/support/`), 3 split (`baseline.test.ts`
  per the settled slice-plan ruling, `edit-check`, `current-collector` —
  real-Musi assertions stay adapter-side), 7 stayed on subject ownership.
  Governance went from zero to 12 in-package test files; package suite
  241→~520 tests; smoke subjects, coverage map, and adoption-guide claims
  reconciled. Review round added a hardcoded-literal binding smoke
  (`baseline-debt-accounting-binding.test.ts`) and exact smoke subjects for
  the moved kernel tests.
- **13 (operations slice) — neutral gate/update application operations
  (P2/S)** (merge `e1fa3141`): `runLintRatchetGate`/`runLintRatchetUpdate`
  in `governance/operations.ts` own the shared ordering invariant
  (rule-source hashes → collect → build/compare → round-trip-validate →
  gated apply) behind typed `MissingBaselineError`/`BaselineParseError`
  errors; recovery text and rendering stay adapter-side; both adapters
  rebased; the demo gained round-trip validation by construction. The leaf
  file stays for the rejected full-driver record and its trigger.

## Landed record — 2026-07-16/17 (leaf files removed; full text in git history)

- **01 — one baseline kernel (P0/L)** and its approved slice plan: full
  kernel migration in five reviewed, individually-landed slices (S1 tolerance
  `a3a9109d`, S2 kernel `89a0714d`, S3a/b/c `ff202cd1`/`0f8fab03`/`08aa91a0`,
  S4 flip `a981e78c`, S5 deletion `15067711`); baseline now version 2,
  parallel stack deleted (net −1,700 LOC), debt log byte-untouched.
- **03 — metrics as strategies (P1/M)**: metric-strategy registry + single
  max-lines exceptions codec (landed with the 01 slices).
- **04 — one merge-driver shell body (P1/M)**: one keyed merge-driver body +
  one keyed truth-up body + awk→TS attributes rewriter. The leaf recorded an
  unpromoted follow-up idea: replace the shell truth-up state machine with a
  full TS implementation (in git history with the leaf).
- **06 — rule-source identity hashing (P2/S)**: fail-closed guard with
  literal- and regex-aware masking + regression tests for both fail-open
  categories.
- **08 — one validation and CLI idiom (P1/M)**: Zod-throughout ruling
  recorded; debt-log schema family on Zod; CLI on node:util parseArgs.
- **09 — docs split and portable doc hygiene (P2/M)**: lint-ratchet guide
  split (1,139→448 lines + `docs/guides/lint-ratchet-reference.md`); portable
  citations generalized; conflict recipes generated from the driver.
- **10 — trim report-only mode (P2/S)**: removed from types, filtering,
  validation, summaries, diagnostics kind, and guides (its item 3 belongs to
  leaf 02).
- **11 — kernel diagnostics parity (P2/S)**: item-conflict groups keep
  surviving items into failure-path validation; structural parse accumulates
  the full defect set again; formatted-group (normalized) equality in merge
  unchanged-detection ruled and pinned, with a per-field sensitivity suite
  guarding the invariant (`scripts/lint-ratchet/baseline-merge.test.ts`).

## Drain record — 2026-07-16/17

Phases 1 and 2 of this pack were drained by parallel worktree lanes and
landed on main via full-verify merges `fa8f74bb` (leaves 10, 03, 01-partial,
04, 06) and `0f3f8409` (leaves 08, 09). Every lane passed a codex review
plus an independent opus/grok/fable pre-land pass with confirm-then-fix on
all findings.

Phase 3 (2026-07-17) executed the leaf-01 remainder as its own mission per
the approved slice plan (removed with the leaf; in git history): two
independent designs (codex + claude) synthesized under owner rulings (minimal
v2 wire shape; debt log untouched), the plan adversarially reviewed by opus
before implementation, then five slices implemented by codex in a single
sequential lane — each independently landed through the full gate after
opus + grok reviews with confirm-then-fix (three findings fixed pre-land: a
failure-set parity gap in the kernel merge path, a time-bomb flip-equivalence
test comparing pinned history against the live working tree, and a
pin-honesty assert). Landed merges: `a3a9109d`, `89a0714d`, `ff202cd1`,
`0f8fab03`, `08aa91a0`, `a981e78c`, `15067711`.

Leaf 11 (the post-land diagnostics-parity follow-ups) was drained 2026-07-17
on `feat/backlog-kernel-diagnostics-parity`.

Phase 4 (2026-07-18) drained leaf 05 item 1, leaf 12, and leaf 13's
operations slice via three parallel provisioned worktree lanes, one Claude
Fable 5 implementer per lane against a full-verify baseline on the base.
Every lane passed a parallel codex + fable review with a single
confirm-then-fix agent per lane (lane 05: codex's restore-satellite-exports
P1 refuted — zero consumers, and leaf 14 records the wildcard surface as a
problem to shrink; lane 13: all 4 findings fixed, including moving
Musi-specific recovery text back adapter-side behind typed errors; lane 12:
codex's lost-binding-assertion P1 confirmed with corrected premise and fixed
with a hardcoded-literal smoke, plus re-registered smoke subjects for the
moved kernel tests). Landed sequentially via full-verify `land.sh` merges
`c3b233de` (05), `e1fa3141` (13-ops, after a modes.ts conflict resolution
with the consolidated kernel), `0dbb5e5d` (12, after a 3-conflict merge
reconciling re-homed tests with the consolidated module paths).

## What the review said to keep (do not "fix")

- The core semantics: strict floor + symmetric gate + item-keyed committed
  baselines + semantic-minimum merge + append-only debt log + zero-baseline
  lifecycle.
- Isolated per-rule generated ESLint configs (retrofit via an explicit
  adapter seam, not special cases in the config writer).
- The thin-shell / TS-semantics split for merge drivers (the duplication
  *within* the shell layer was the problem — leaf 04 fixed it — not the
  boundary).
- Suppression registers, ratchet-restricted disables, the `meta.docs` →
  generated rule catalog pipeline, and the structured agent-diagnostics
  envelope.

## Cross-pack overlaps

- Leaf 01 built on `arch-review-2026-07/12-baseline-framework-and-max-lines.md`
  (it built the framework; this pack migrated the ratchet onto it).
- Leaf 02 was adjudicated against
  `lint-deep-dive-2026-07/71-portable-engine-context.md` on 2026-07-16:
  71's copy-manifest mechanism is superseded by an internal workspace
  package; its engine-context design survives as the repo-adapter layer.
  Ruling recorded in leaf 02; 71 carries a matching addendum.
- Leaf 09 overlapped `lint-deep-dive-2026-07/70-ratchet-docs-accuracy-and-shape.md`
  item 3 (the guide split — executed 2026-07-17).
