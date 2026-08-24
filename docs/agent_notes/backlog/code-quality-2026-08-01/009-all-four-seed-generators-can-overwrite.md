# 9. All four SRD seed generators warn and still write, so a run that dropped records or blanked descriptions exits 0 and overwrites committed artifacts

Status: Not started
Theme: seed generator error policy · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/server/src/seed/` has exactly four generator entry points —
`generate-srd-spells.ts`, `generate-srd-rules-glossary.ts`,
`generate-subclasses.ts`, `generate-class-features.ts` — and all four share the
same error policy: a record that fails to parse, a subclass the parser cannot
find, or a feature whose description resolves to empty becomes a **warning**,
and the generator then writes its output files anyway and exits 0. Two of them
print the warnings only *after* the `writeFileSync`. None of the four ever sets
a non-zero exit code.

The output files are committed, attested artifacts: the regeneration procedure
in `docs/srd-data-sources.md` has the operator rerun the generators, update
`PROVENANCE.json` checksums by hand, and run an attestation test that — by
recorded design — proves only that the committed bytes match the recorded
checksums, never that they are complete. So the one moment completeness can be
checked is inside the generator run itself, and that is exactly the moment all
four downgrade to a warning. A routine SRD refresh where the upstream markdown
shifted a heading can silently drop spells, glossary entries, or a whole
subclass, or blank feature descriptions to `""`, and the only remaining line of
defense is a reviewer spotting an absence inside a large generated diff.

A separate lifecycle defect exists in the two Prisma seed entrypoints, outside
the artifact generators. Both hand-maintain the same bootstrap, failure, and
shutdown chain, and both call `process.exit(1)` in `catch` before their chained
async `finally` can reliably disconnect Prisma. A failed seed can therefore
terminate during the cleanup protocol that the source appears to guarantee.

## Evidence

- `packages/server/src/seed/generate-srd-spells.ts:36-63` — per-spell parse
  exceptions are caught into a `warnings` array, the successfully parsed subset
  is written, and warnings are logged only after the file is overwritten.
- `packages/server/src/seed/generate-srd-rules-glossary.ts:67-103` — the same
  catch-into-warnings shape writes the partial `entries` array before printing
  the warnings.
- `packages/server/src/seed/generate-subclasses.ts:118-187` — a `null`
  `parseSubclass` result logs "Missing subclass in source markdown", continues,
  and then writes the subclass entry module and both feature modules from the
  reduced set.
- `packages/server/src/seed/generate-class-features.ts:170-205` — a feature
  whose description resolves to `""` logs "Missing class feature description"
  and is emitted anyway; each class file is written inside the per-class loop,
  so a late failure would leave earlier class files overwritten.
- Measured with
  `git ls-tree -r --name-only ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages/server/src/seed | rg '^packages/server/src/seed/generate-[^/]+\.ts$' | wc -l`:
  the output is `4`, confirming these are all generator entrypoints.
- Measured with
  `git grep -n -E 'process\.exit(Code)?' ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages/server/src/seed/generate-srd-spells.ts packages/server/src/seed/generate-srd-rules-glossary.ts packages/server/src/seed/generate-subclasses.ts packages/server/src/seed/generate-class-features.ts | wc -l`:
  the output is `0`, so none of the four reports lossy generation through a
  nonzero process status.
- `docs/srd-data-sources.md:120-130` — the operator updates recorded checksums
  by hand, and the provenance test is explicitly an attestation rather than a
  drift gate; a partial regeneration attests cleanly once its reduced output
  is recorded.
- `packages/server/src/seed/spell-parser/parse-spell-block.test.ts:1-3`,
  `packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.test.ts:1-3`,
  `packages/server/src/seed/spell-splitter.test.ts:1-3`, and
  `packages/server/src/seed/level-heading.test.ts:1-3` — parser helpers have
  sibling tests, while the generator entrypoint policy remains in top-level
  script bodies.
- Measured with
  `git ls-tree -r --name-only ebf096580b31f604861fadb3d4cbd4079da4f017 -- packages/server/src/seed | rg '^packages/server/src/seed/generate-[^/]+\.test\.tsx?$' | wc -l`:
  the output is `0`; none of the four generator entrypoints has a sibling test.
- `packages/server/prisma/seed.ts:8-32` — the ordinary seed creates its logger
  and Prisma client, runs user and SRD seeding, then calls `process.exit(1)` in
  `catch` before the chained async disconnect in `finally`.
- `packages/server/prisma/seed-template.ts:10-33` — the template-only seed
  repeats the same configuration and forced-exit lifecycle around its distinct
  SRD-only callback.

## Proposed direction

Make all four generators fail closed before any write: collect parse results
and warnings first, and if any block failed to parse or any expected record is
missing (a `null` subclass, an empty class-feature description), exit non-zero
**without touching the output files**. Add an explicit opt-in flag (e.g.
`--allow-partial`) that restores today's warn-and-write behavior for parser
iteration. Concretely:

1. In `generate-srd-spells.ts` and `generate-srd-rules-glossary.ts`, move the
   warnings check ahead of the `writeFileSync` and make a non-empty warnings
   array fatal by default.
2. In `generate-subclasses.ts`, make the missing-subclass warning fatal before
   the three writes at `:158` and `:187`.
3. Restructure `generate-class-features.ts` from write-per-class-in-loop
   (`:205`) to collect-all-then-write-all, so a late failure cannot leave
   earlier class files already overwritten, and make the missing-description
   warning fatal.

Do not introduce temp-file staging: in-memory staging followed by a write
phase is already the dominant pattern. Spells and glossary each write one file,
and subclasses writes its three files only after collection; only
`generate-class-features.ts` needs the collect-then-write restructure.

Hard constraint: on a clean parse the emitted bytes must be identical to
today's committed artifacts. That keeps this leaf entirely in error-path
behavior — no committed output changes, nothing to regenerate, and no
`docs/refs/` checkout needed to verify the change.

Test the fail-closed paths with fixture strings by extracting testable main
functions from the script bodies, following the sibling-test convention the
parser helpers already use (e.g. `bun run test --
packages/server/src/seed/spell-splitter.test.ts` is the existing shape); the
scripts stay thin wrappers that call the extracted function and translate a
failure into a non-zero exit.

In the same leaf, update the regeneration procedure in
`docs/srd-data-sources.md` (the step-2 area at `:89-105`, where the four
generator commands are tabulated) to document the fail-closed default and the
`--allow-partial` diagnostic flag.

Separately, replace `process.exit(1)` in both Prisma seed entrypoints with
`process.exitCode = 1`. Preserve each command's explicit work:
`seed.ts` continues to run users followed by SRD data, while
`seed-template.ts` remains SRD-only. In both cases, log the failure, set the
nonzero status, and allow the chained async `finally` to await
`prisma.$disconnect()`.

Sharing a small lifecycle runner is optional and should happen only if it
reduces duplication without hiding those command-specific callbacks. Add a
focused regression check around the chosen seam proving that a rejected seed
sets the exit code and still awaits disconnect; reset global `process.exitCode`
during test cleanup.

## Scope / caveats

- **Out of scope: any regenerate-and-diff or `:check` gate.** The prior pack's
  [`SERVER-COMMENTS-PLAN.md`](../code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md)
  record CQ25-172 settled the attestation-not-drift-gate design
  (`docs/srd-data-sources.md:124-130`). This leaf changes only what a *manual*
  generator run does on incomplete input; it adds no gate and must not reopen
  that tradeoff.
- **Out of scope: any change to committed generator output.** The prior pack's
  [`06-seed-pipeline-and-generators.md`](../code-quality-2026-07-25/06-seed-pipeline-and-generators.md)
  record CQ25-171 parked its generator-output rewrite steps 5-8
  (prettier-in-generator, layout, renames, table-driving) because no gate and no
  implementer without `docs/refs/` can verify them. The
  byte-identical-on-clean-parse constraint above keeps this leaf outside that
  parked territory.
- **Residual risk, intended:** nobody without the gitignored `docs/refs/`
  checkout (`.gitignore:63`) can prove the current corpus parses warning-free
  today, so the first real post-change regeneration may hard-fail where it
  previously warned. That failure is the point — it surfaces exactly the
  completeness loss that currently ships silently — and `--allow-partial` is
  the escape hatch for diagnosing it. End-to-end verification against the real
  corpus needs a provisioned `docs/refs/` checkout; the fail-closed logic
  itself is fully verifiable with fixtures.
- **Adjacent leaf, same directory:** [003-seed-json-boundaries-alternate-between.md](./003-seed-json-boundaries-alternate-between.md)
  reworks the seed-data *consumers* in `packages/server/src/seed/`. No file
  overlaps with this leaf's four entrypoints and there is no ordering
  dependency, but avoid working the two concurrently in that directory.
- The Prisma seed lifecycle is a separate sub-scope from the four artifact
  generators. Do not change seeding order, callbacks, data behavior, or output
  policy while making shutdown failure-safe.
- Coordinate contributor documentation for the `src/seed` subsystem with
  [087-server-contributor-maps-contradict-omit.md](./087-server-contributor-maps-contradict-omit.md).
  This augmentation does not move files or add that module map.
- No prior-pack record covers the Prisma seed-entrypoint lifecycle residual.
- The `Usage:` headers in all four generators cite
  `bun run --filter @musi/server generate:{srd-spells,srd-rules-glossary,subclasses,class-features}`
  (real scripts, `packages/server/package.json:25-28`); if the flag is added,
  keep those headers and the doc table at `docs/srd-data-sources.md:100-105`
  in agreement.
