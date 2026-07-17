# 01 — Finish the extraction: one baseline kernel

Status: In progress — 2026-07-16: semantic-minimum merge unified (single
implementation); grouped-document migration re-scoped.

LANDED (the review's sharpest finding — "the invariant the whole system exists
to protect, implemented twice"): the semantic-minimum item merge now exists
exactly once. A shared union-key item-merge core (scripts/lib/baseline/item-merge.ts)
owns the loop + zero-count drop + post-merge truth-up accounting, with each
consumer injecting an ItemMergePolicy for the three genuine policy differences:
(a) base-present one-sided drop truth-up, (b) equal-count metric meet vs
formatEntry-equality, (c) different-count payload check vs take-lower. Both the
flat sensor merge (scripts/lib/baseline/merge.ts) and the ratchet's nested
tests->items merge (scripts/lint-ratchet/baseline-merge.ts) delegate to it —
baseline-merge.ts keeps its own nested document parse/shape, it only delegates
the per-item semantic-minimum decision. A fix to the min-floor accounting can no
longer be applied to one and missed in the other; the interim matched-pair guard
below is superseded. Commits: 57c01f9f, fccf99a3. All five suites green.

RE-SCOPED, not attempted here (orchestrator ruling 2026-07-16, on the
blast-radius map below): the rest of the "one kernel" headline — evolve
scripts/lib/baseline/ into a grouped BaselineSpec, migrate the ratchet's
parse/validate/format/compare onto it, delete the parallel stack, bump
lint-ratchet.baseline.json off {version:1}, and re-key the append-only debt log —
is its own multi-day mission and must NOT be done in a fast-commit lane. It
requires a dual-version-tolerant parser landed FIRST (before the version constant
flips), because a same-session 1->2 flip is a silent-floor-drop risk overnight.

## Remaining work (blast-radius facts, verified 2026-07-16)

- **One strict version gate, three read paths.** baseline-validation.ts:182 is a
  strict `parsed.version !== LINT_RATCHET_BASELINE_VERSION` check
  (scripts/lint-ratchet/baseline-constants.ts:1 = `1 as const`). It is shared by:
  (1) the 3-way merge driver, which parses base/current/other identically
  (baseline-merge.ts:261-263 -> parseLintRatchetBaselineStructure) — a bump makes
  it reject in-flight version-1 base blobs and fall back to conflict markers or a
  floor-losing regen; (2) trend.ts's history walk (trend.ts:185) — a bump makes
  every pre-bump commit fail the gate and silently drop from the series (stderr
  warning only, exit 0); (3) the debt-log parser (debt-log-schema.ts parseVersion
  accepts only "1"). A naive flip breaks all three at once, silently.
- **Dual-version-tolerant parser first.** The safe sequence is: land a parser that
  reads BOTH version 1 and 2 (or an explicit committed-artifact + debt-log upgrade
  step) BEFORE flipping the constant. That is the gating prerequisite, and it is
  the multi-day part.
- **Debt log.** lint-ratchet.debt-log.jsonl — 14 append-only entries, all
  version:"1", keyed by nested testId->path (orphansRemoved[].testId,
  regressions[].testId + .path, orphansRemoved[].baselineItems[].path, ratchetId
  on kind-tagged entries). Re-keying must preserve append-only + idempotent tail
  semantics (debt-log-write.ts).
- **Surface.** ~3,300 production LOC (baseline*.ts ~2,980 across 19 files + trend
  332 + debt-log-write/schema) and ~6,700 test LOC (baseline*.test.ts 5,058;
  baseline.test.ts alone 3,088) hardwire the nested tests->items shape AND version
  1. baseline-compare.ts (the core count-protection delta) and baseline-merge.ts's
  document parse are both hardwired to the nesting; 7 test files hardcode the
  version constant.
- **Leaf 02 stays blocked on this remainder** — its package seam is the grouped
  kernel API that this migration would define.

Sequencing note: the metric-strategy registry (leaf 03) is the item-level half of
the eventual grouped BaselineSpec; the re-scoped work is the group/document level
plus the parse/validate/format/compare migration, the version bump, and the
debt-log re-key — all behind the dual-version parser.
Priority: P0 · Size: L · Risk: medium (baseline schema bump + debt-log key migration)
Source: lint architecture review 2026-07-16 (R1) — unanimous across all five
reviewers (four ranked it P0, GPT P1). Headline claim spot-verified against
source during synthesis.

## Problem

`scripts/lib/baseline/entry-baseline.ts` describes itself as the generic
item-keyed baseline framework "extracted from the lint-ratchet's proven
update/gate/merge layer." Three sensors converged on it (knip-unused-exports,
max-lines-exceptions, near-duplicates). The lint ratchet itself — the
flagship, the one the adoption docs tell outsiders to copy — never did. It
keeps a parallel stack: `scripts/lint-ratchet/baseline-parse.ts`,
`baseline-validation.ts`, `baseline-format.ts`, `baseline-compare.ts`,
`baseline-merge.ts`, `baseline-update*.ts`, plus its own `atomic-write.ts`
beside `scripts/lib/baseline/atomic-write.ts`. Verified at HEAD (bc12a371,
2026-07-16): the eight named files are 1,831 LOC; all non-test
`baseline*.ts` in the directory total ~3,067 LOC across 20 files — larger
than the review's ~2,200 estimate.

Sharpest consequence (Opus): the semantic-minimum merge — the invariant the
whole system exists to protect — is implemented twice with the same
algorithm: `scripts/lint-ratchet/baseline-merge.ts` (325 LOC) and
`scripts/lib/baseline/merge.ts` (236 LOC). The derivation is explicit —
`merge.ts`'s header says "generalized from the lint-ratchet baseline merge
driver" — and both resolve conflicts to the lower count with the same
`postMergeTruthUpRequired` pattern. A fix applied to one and missed in the
other is a silent floor-drop.

Honest technical reason for the gap (Codex): the generic framework is
count-centric and flat, while ratchet baselines are two-level
(`tests → metadata → items`) with three metric kinds — not a drop-in, but
bridgeable (composite keys or a grouped-spec variant).

## Do

1. Evolve `scripts/lib/baseline/` from a count-centric spec into a grouped
   baseline algebra — roughly `BaselineSpec<GroupMeta, Item, Delta>` with a
   codec, `compareItem`, `meetItem` (semantic minimum), and delta
   formatting/accounting (GPT's sketch).
2. Migrate the ratchet's nested `tests → items` document onto it via
   composite keys or a nested-spec variant.
3. Delete `scripts/lint-ratchet/baseline-merge.ts`, the parallel
   parse/validate/format/compare stack, and the duplicate `atomic-write.ts`.
4. Design the leaf-02 package seam concurrently — this leaf's strategy
   interface (see leaf [03](./03-metrics-as-strategies.md)) is that leaf's
   kernel API.

## Payoff / cost

~2,000 LOC deleted — roughly double that counting the file-for-file mirror
under `examples/lint-ratchet-demo/`, which the demo-sync harness keeps in
byte-parity; the semantic-minimum invariant exists exactly once; the repo
teaches one baseline mental model instead of two. Cost: a one-time baseline
schema bump and debt-log key migration (the committed debt log is 14
`version:"1"` JSONL entries — real but small).

## Interim guard (superseded 2026-07-16)

RESOLVED for the merge invariant: `baseline-merge.ts` and
`scripts/lib/baseline/merge.ts` no longer carry their own copy of the
semantic-minimum loop — both delegate to `scripts/lib/baseline/item-merge.ts`,
so the min-floor accounting is edited in exactly one place. The matched-pair
review guard is no longer needed for that invariant. (The two OUTER drivers
still exist as separate functions until the deferred grouped-algebra migration
lands, but they share the item core.)

## Prior work

`arch-review-2026-07/12-baseline-framework-and-max-lines.md` (Done
2026-07-07) built the framework and migrated knip + max-lines onto it. This
leaf is the unfinished half: the ratchet itself.
