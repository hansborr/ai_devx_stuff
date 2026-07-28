# 52. All four SRD seed generators resolve their paths from `process.cwd()`, so leaf 06's proposed package scripts would break them on arrival

Status: **Done 2026-07-27** on branch `feat/cq-server-cluster`, merge
`6246c73cf` (`455bac12e`); see [Landed](./00-index.md#landed). All four
generators resolve through one new `seed/srd-generator-paths.ts`, pinned by
`seed/srd-generator-paths.test.ts`. **The `52 → 06 step 2` precondition is
discharged**, so leaf 06 step 2 can now add the package scripts. The
`docs/refs/` caveat below held: byte-identical regenerated output was **not**
proven — only that each generator run from a foreign cwd fails on the repo-root
input and writes no phantom tree. Leaf 06's regenerate-then-diff check is still
owed by whoever provisions the checkout.
Theme: Position-dependent code-generation scripts · Area: server · Severity: low · Size: XS

Source: server/comments cluster planning session, 2026-07-26 (recorded in [SERVER-COMMENTS-PLAN.md](./SERVER-COMMENTS-PLAN.md), "Two live defects the leaves do not record") · Confidence: high

**Evidence in this leaf is pinned to `5ff5751a` (`main`), not the pack's
`883d48bf`.** All four anchors were re-verified against the live files.

## Problem

Each of the four SRD generators derives every path it reads and writes from the
process working directory:

```ts
const ROOT = process.cwd();
const SRD_DIR = join(ROOT, "docs/refs/dndsrd5.2_markdown/src/03_Classes");
const OUT_DIR = join(ROOT, "packages/server/src/seed/class-features");
```

They therefore only work when invoked from the repository root. That is the
current invocation and it works, which is why nothing has ever failed — but it
makes the scripts position-dependent for no reason, and it collides directly
with the change leaf 06 proposes.

**[Leaf 06](./06-seed-pipeline-and-generators.md) step 2 asks for these four to
get npm scripts in `packages/server/package.json` "next to the existing
`backfill:*` entries".** A package script runs with `cwd` set to the package
directory, so `ROOT` becomes `packages/server` and every path becomes
`packages/server/packages/server/…`. The generator would fail to find its input
and, if it got that far, write its output into a nested phantom tree. The step
that is supposed to make the pipeline attestable would break it instead, and it
would break it at the moment of adoption rather than in review.

The fix is already in the same directory, in the scripts leaf 06 points at as
the model. The two `backfill:*` entries do **not** have this problem because
they resolve against the module rather than the process:
`backfill-srd-spell-combat.ts:14` and `backfill-srd-monster-actions.ts:13` both
use `resolve(import.meta.dirname, …)`.

**So this is a precondition for leaf 06 step 2, not a follow-up to it** — and
that is the whole point of writing it up separately. Anyone who picks up leaf 06
and adds the scripts without reading this will produce four scripts that fail on
first run.

## Evidence

- `packages/server/src/seed/generate-class-features.ts:18` — `const ROOT = process.cwd();`, with `:19` `SRD_DIR` and `:20` `OUT_DIR` both `join(ROOT, …)`.
- `packages/server/src/seed/generate-subclasses.ts:18` — same.
- `packages/server/src/seed/generate-srd-spells.ts:21` — same.
- `packages/server/src/seed/generate-srd-rules-glossary.ts:19` — same.
- These are the complete set: `grep -rn "process.cwd()" packages/server/src/seed/` returns exactly those four lines.
- The counter-example, in the same directory and named by leaf 06 as the placement model: `packages/server/src/seed/backfill-srd-spell-combat.ts:14` — `resolve(import.meta.dirname, "data/5e-srd-spells-5.2.json")`; `packages/server/src/seed/backfill-srd-monster-actions.ts:13` — `resolve(import.meta.dirname, "data/5e-srd-monsters.json")`.
- `docs/agent_notes/backlog/code-quality-2026-07-25/06-seed-pipeline-and-generators.md:104-106` — leaf 06 step 2, the request that turns this from harmless into breaking.
- `packages/server/package.json` — the `backfill:*` entries leaf 06 wants the new scripts placed beside; a script here runs with `cwd = packages/server`.

## Proposed direction

A hypothesis, not a spec, but a short one — this is close to mechanical.

1. **Replace `process.cwd()` with a module-relative root in all four
   generators**, matching the `backfill:*` form:
   `resolve(import.meta.dirname, "..", "..", "..", "..")` for the repo root, or —
   better — resolve each path directly against `import.meta.dirname` the way the
   backfill scripts do, since three of the four write into the generator's own
   directory or a sibling of it. Prefer the direct form; a
   count-the-dots repo-root walk is its own fragility.
2. **Verify by running each generator from a non-root directory** and asserting
   byte-identical output. This is the only verification that proves the change,
   and it needs `docs/refs/` provisioned — see the caveat.
3. **Land it before, or in the same slice as, leaf 06 step 2**, and say so in the
   commit message so the ordering is not lost.

## Scope / caveats

- **Verification needs `docs/refs/`, which is absent by design.** It is an
  optional gitignored operator checkout (`docs/srd-data-sources.md:34-37`,
  `.gitignore:63`). Without it the generators cannot run at all, so the
  cwd-independence change cannot be proven by execution — only read. That is the
  same constraint that parks half of leaf 06, and it is why this is written as a
  precondition to be applied with step 2 (where the checkout has to exist anyway)
  rather than as standalone work someone can verify today. Do not land a
  "cleanup" commit here that nobody has run.
- **Do not fold in a byte change to the generated output.** The generators write
  committed artifacts. A path refactor must produce identical files; if it does
  not, that is a finding, not a formatting change to accept. Leaf 06's
  "Reproduction check, before step 5" caveat describes the correct
  regenerate-then-diff procedure, including the prettier step — follow it.
- **This is not a bug today.** Run from the repo root, which is the only
  documented invocation, all four work. Severity is low for that reason. What
  makes it worth a leaf is exclusively its interaction with leaf 06 step 2.
- Sequencing: `52 → 06 step 2`. No other edge in this pack.
