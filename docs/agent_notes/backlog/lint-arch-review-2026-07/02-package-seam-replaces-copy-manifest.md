# 02 — Replace the copy manifest with a real package seam

Status: Approved — owner ruling recorded 2026-07-16 (see Design ruling
below; amends lint-deep-dive 71). Do after leaf 01; design the seam
concurrently with 01.
Priority: P0 · Size: L · Risk: medium
Source: lint architecture review 2026-07-16 (R2) — P0 from Opus, GPT, and
Grok; GPT ranked it above leaf 01. Headline claim spot-verified against
source during synthesis. Do AFTER leaf 01 converges the baseline stacks
(packaging the duplicated code would enshrine it), but design the seam
concurrently with 01.

## Problem

`scripts/lint-ratchet/portable-manifest.json` declares "the portable
surface" as one scoped wildcard (`scripts/lint-ratchet/*.ts` minus tests,
test-helpers, and `lint-ratchet-config.ts`) plus two explicit file lists —
in effect the entire engine directory. Adopters
inherit debt accounting, trend, propose, edit-check, retirement proofs, and
complexity metrics, then are told by the adoption guide to delete registry
helpers and stub the rule-doc loader. Keeping the fork honest costs a
dedicated harness (verified at HEAD 2026-07-16):
`scripts/lint-ratchet/portable-manifest-expand.ts` (134 LOC),
`scripts/check-lint-ratchet-demo-sync.ts` (320 LOC) plus its test (374
LOC), doing byte-parity against a full mirrored engine copy under
`examples/lint-ratchet-demo/` — ~830 lines whose only job is compensating
for a missing architectural seam, plus every engine edit landing twice. Meanwhile `scripts/lint-ratchet/lint-ratchet-config.ts` (~530 LOC)
co-locates the portable type system with Musi's production ratchet registry
and Musi glob imports, so the types adopters need live inside the one file
they are told to exclude.

## Do

Carve the engine into four explicit layers with injected configuration and
zero Musi imports:

1. **kernel** — registry types, collect, compare, update, baseline I/O.
2. **git rail** — merge driver + truth-up.
3. **governance extensions** — debt log, zero-baseline lifecycle,
   trend/report, agent diagnostics — each optional.
4. **repo adapter** — Musi's registry data, paths, harness-manifest wiring.

Even an internal workspace package beats the directory fork. Split
`lint-ratchet-config.ts` into portable types and a Musi registry data file
(the registry/types co-location was independently flagged by Opus, GPT, and
Grok).

## Payoff

The package boundary *becomes* the portable surface:
`portable-manifest-expand.ts` and the demo-sync harness (~1,000 LOC) are
deleted, and `examples/lint-ratchet-demo/` becomes an ordinary consumer.
Highest-leverage change for the public-reference mission — a count-only
adopter should need a handful of modules, not a pruned fork.

## Design ruling — 2026-07-16 (owner)

Overturn lint-deep-dive 71's *mechanism*, keep its *restraint*:

1. **Target shape: internal workspace package** (Bun workspaces already
   exist), carrying the four layers above. **No external publication** —
   leaf 75's demand-based deferral of published-package/separate-repo
   extraction still holds; an internal package needs no external demand to
   justify deleting the sync harness.
2. **71's engine-context design survives intact** — it *is* layer 4: the
   `LintRatchetEngineContext` the Musi adapter constructs becomes the
   injected configuration the kernel receives. 71's acceptance tests
   (non-Musi fixture context, import-boundary check, byte-identical Musi
   behavior) carry over as this leaf's acceptance tests, with the
   import-boundary check becoming structural (package deps + ESLint
   import-boundary/knip) instead of byte-parity of copies.
3. **Grounds.** (a) The carrying cost is quantified above and no longer
   matches 71's "cheaper seam to harden first" premise. (b) Sharper: leaf
   01 moves the kernel onto `scripts/lib/baseline/`, so the portable
   surface stops living in one directory — the manifest's single scoped
   wildcard breaks and the sync harness must grow to span two trees right
   as the stacks converge. 71's premise does not survive leaf 01, which
   this pack already commits to.
4. **Kernel placement:** `scripts/lib/baseline/` lands inside the package
   as the kernel layer; knip/max-lines/near-duplicates import it from
   there.
5. **Pull the `lint-ratchet-config.ts` registry/types split forward** as an
   independent slice — valuable regardless and it can precede the package
   move.
6. Leaf 08's validation ruling is an input to the kernel boundary; the
   stale-Zod-ban finding recorded there tilts it toward Zod throughout.
   **Recorded 2026-07-17: the ruling is now Zod throughout** (see leaf 08's
   "Design ruling — 2026-07-17"); it also folds in the missing enabling link —
   `zod` had to be added to the **root** `package.json`, not just allowlisted —
   so the kernel package inherits Zod as a real, resolvable dependency.

`lint-deep-dive-2026-07/71-portable-engine-context.md` carries a matching
addendum pointing here.
