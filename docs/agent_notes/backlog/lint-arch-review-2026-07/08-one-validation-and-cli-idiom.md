# 08 — Pick one validation idiom and one CLI idiom

Status: Done — 2026-07-17 debt-log schema family migrated to Zod (zod added to
root deps; 14-entry committed log parses byte-identically) and the CLI parser
collapsed onto node:util parseArgs (six cli files down to four seams).
Priority: P1 · Size: M · Risk: low
Source: lint architecture review 2026-07-16 (R8) — hand-rolled validation
flagged by Sonnet and Grok (both P1); CLI-parser consolidation from the same
finding family.

## Problem

Two inconsistencies, both teaching adopters mixed idioms:

1. **Validation.** The debt log carries hand-rolled strict-object
   validation (verified at HEAD 2026-07-16: 811 LOC across the five
   `rejectUnknownKeys`-based schema files; 1,062 LOC across the seven-file
   subsystem), while the diagnostics envelope happily imports Zod from
   `packages/shared` — the boundary is inconsistent, and it contradicts the
   repo's own Zod-first policy in one direction or the other.

   **The documented justification is stale.** `debt-log-schema.ts:17-22`
   says Zod is banned because the import-boundary smoke can't resolve it —
   but at HEAD, `scripts/tests/test-lint-ratchet.sh:182` explicitly
   allowlists `zod`, and the Zod-based
   `packages/shared/src/schemas/harness-diagnostics.ts` is already listed
   as a portable runtime file in `portable-manifest.json`. The portable
   boundary no longer forbids Zod.
2. **CLI.** A ~493-LOC hand-rolled CLI parser spread over six `cli-*.ts`
   files for one entrypoint (re-verify counts at HEAD), where `node:util`'s
   `parseArgs` with mutual-exclusion validation layered on top would do.

## Do

1. Decide the validation idiom — either vendor a tiny validator into the
   kernel (portable, zero deps beyond eslint) or use Zod throughout. The
   stale-ban finding above tilts this toward Zod throughout: the boundary
   already admits it, the diagnostics envelope already depends on it, and a
   zero-dep kernel is not worth ~800 LOC of hand-rolled validation. Decide,
   don't default; record the ruling where leaf 02's layer definitions live
   (leaf 02's 2026-07-16 design ruling already leans the same way).
2. Collapse the CLI parser onto `node:util` `parseArgs` plus a small
   mutual-exclusion layer.

## Sequencing

The validation ruling is an input to leaf 02's kernel boundary — make the
call before or during that design, not after.

## Design ruling — 2026-07-17 (validation idiom: Zod throughout)

**Ruling: Zod throughout.** The hand-rolled `rejectUnknownKeys` debt-log schema
family is migrated onto Zod; the "vendor a tiny validator" alternative is
rejected. Grounds, in order of weight:

1. The documented ban in `debt-log-schema.ts` was stale, exactly as the review
   found: the import-boundary smoke
   (`scripts/tests/test-lint-ratchet.sh`) already allowlists `zod` alongside
   `eslint` and `minimatch`, and `packages/shared`'s `harness-diagnostics.ts`
   Zod schema is already a portable runtime file
   (`portable-manifest.json`). The portable boundary no longer forbids Zod.
2. The diagnostics envelope the ratchet already emits depends on Zod
   (`diagnostics.ts` imports the shared `harness-diagnostics` schema), so a
   count-only adopter already pulls Zod in transitively — a second, hand-rolled
   idiom for the debt log taught adopters two validation styles for no gain.
3. Leaf 02's 2026-07-16 owner ruling (item 6) leans the same way.

**Enabling correction folded in.** The stale-ban evidence chain was *almost*
complete but missed one link: `zod` was declared only in `packages/server` and
`packages/shared`, never in the **root** `package.json`, so a file physically
under `scripts/` could not resolve `zod` at runtime even though the smoke
allowlisted it. This migration adds `zod` to the root `devDependencies` (the
allowlist had already anticipated it). Without that line the ruling would have
been unbuildable as stated — recording it here so leaf 02's kernel-package work
inherits an accurate picture, not just the allowlist half of the story.

**Scope boundary.** The migration Zod-ifies the five debt-log-specific schema
files (envelope, discriminated union on `kind`, strict unknown-key rejection,
`version` literal `"1"`, regression shape-by-reason, coverage-shrink,
options-attestation). It does **not** reimplement the shared metric/baseline-item
validators (`metrics-*.ts`, `baseline-item-parse.ts`); those are baseline
infrastructure used across the whole engine, and the orphan-removal schema keeps
delegating to them (via a Zod refinement) rather than forking their logic.
