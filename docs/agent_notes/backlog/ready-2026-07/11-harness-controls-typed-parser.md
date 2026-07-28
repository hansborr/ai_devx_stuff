# Typed harness-controls parser at the manifest seam

Status: Phase 1 Done — landed 2026-07-19 (4211f1b6). Phase 2 Done — 2026-07-25.

> **2026-07-25 phase-2 outcome.** Delivered on branch
> `refactor/harness-controls-typed-parser-2`. A new composition seam
> (`scripts/harness/harness-manifest-loader.ts`) joins the leaf's IO to the Zod
> contract; **4 of the 6** `reader-pending-migration` entries migrated onto it
> (`generated-surfaces-loader.ts`, `generate-hook-timeout-constants.ts`,
> `generate-hook-wiring.ts`, `generate-verify-steps.ts`). The
> `reader-pending-migration` class is now EMPTY: the other 2 were recategorized
> `sanctioned-reader` with their reasons recorded inline, because migrating
> them was proven harmful, not merely inconvenient —
>
> - `generate-harness-controls.ts` owns the one-pass granular registration
>   report and must read past schema-level defects; the throwing parser would
>   replace three smoke-pinned diagnostics with generic Zod text.
> - `check-registry.ts` ships in the lint-ratchet smoke fixture's portable
>   runtime copy set and runs against partial/absent manifests. A/B proved the
>   migration turns that smoke's conflict-marker recovery case from exit 2 into
>   exit 1.
>
> The missing guide is now `docs/guides/harness-manifest-parser.md`, registered
> in the `docs/ai-harness.md` guide table.
>
> **Correction to an earlier correction:** the "portable lint-ratchet copy set"
> was NOT deleted in S5 — only its copy manifest and expander were. The set is
> alive as `PORTABLE_RUNTIME_FILES` in `scripts/tests/test-lint-ratchet.sh` and
> it still ships `harness-manifest.ts`. So "fixture copy closure" is the right
> rationale, and that copy set is one of the two closures it names (the other
> is `scripts/tests/harness-check-fixture-manifest.generated.txt`). Both module
> headers now say so.
>
> Also of note: the 2 entries this leaf called untouchable `sanctioned-reader`
> (`registration-check.ts`, `generate-skill-artifacts.ts`) were indeed left
> alone, and `scripts/ai-hooks/check-wiring.sh` stays a deliberate `jq`
> consumer — its independence from the generator is the point of that checker.
Date: 2026-07-19
Source: 2026-07-19 harness architecture review, candidate 3 (session artifact,
claims verified against HEAD 544a9d06 the same day); design calls consulted
with Fable 5 + Codex 2026-07-19, rulings folded in below. First of the review
chain 11 → 12 → 13.
Size: M (phase 1) + a separate follow-up phase for the bypass migration.

## Evidence

`loadHarnessManifest` returns `unknown[]`
(scripts/harness/harness-manifest.ts:34); its doc comment (:32) says callers
layer their own per-entry validation on top. In practice that seam is mostly
bypassed: 21 script files reference `harness.controls.json`, but only 4 import
the loader — the rest read or wire the file directly. Consumers that do go
through the loader then cast their way to shape, e.g.
scripts/harness/generate-harness-controls-validation.ts:154
(`raw.category as ControlCategory`).

The result is N independent, partial, drift-prone pictures of the manifest's
shape, with casts standing in for a contract.

## Phase 1 (M): the parser and the sanctioned readers

- One Zod discriminated-union parser over the control kinds, parsing the
  ENTIRE manifest — top-level fields and arrays are contract too, not just
  `controls` entries (Codex ruling).
- Placement: a SIBLING module layered above the leaf reader.
  `scripts/harness/harness-manifest.ts` is deliberately a dependency-free LEAF
  importing only node builtins so the portable lint-ratchet copy set can ship
  it (header :3-6); it must not gain a Zod import.
- Migrate the sanctioned TS readers to the typed facets, retiring their casts.
- Division of labor: centralize JSON shape, uniqueness, and facet typing in
  the parser; PRESERVE consumer-owned semantic and live-tree validation
  (checks against the actual tree stay with their consumers). Some per-consumer
  error text is test-pinned — preserve it or consciously replace it (and its
  tests); a strict global parser must not silently change failure modes.

## Phase 2 (follow-up; separate from phase 1's acceptance)

Bypass inventory over the 21 `harness.controls.json` references: classify each
as path-only wiring (filename/path plumbing, no migration needed) vs
content-parsing (migrate to the typed parser). Then migrate the parsers.
"21/21 through one function" is explicitly the wrong metric — path-only
consumers keep their sanctioned direct paths.

Also in phase 2: agent-facing docs for the phase-1 surfaces (2026-07-19
5-model review, P3). Phase 1 shipped the typed parser
(`harness-manifest-schema.ts`), the read tripwire
(`manifest-contract-check.ts`), and `MANIFEST_DIRECT_READERS` with no
docs/guides coverage — an agent hitting the tripwire only has the failure
message and module headers to go on. Document the seam (when to use the typed
parser vs the leaf reader, how to shrink the allowlist) alongside the
migration so the docs describe the end state, not the interim one.

## Acceptance criterion (not a follow-up — both consults)

A no-direct-read tripwire lands with phase 1: a `harness:check` facet or lint
rule asserting that only sanctioned modules read `harness.controls.json`
directly. Without it the bypass population (currently 21-vs-4) simply regrows;
with it, phase 2's migration can safely be gradual. Migrate-once proposals
without a regression guard are the pattern this review flagged.

## Constraints

- Decide explicitly whether the portable copy set ships the typed parser or
  keeps the untyped leaf reader. This interacts with lint-arch leaf 14's
  subpath-export curation (= ready-row B1) and with the lint-ratchet S3
  engine-kernel hold at 68a3f000 — check the S3 disposition first.
- Coordinate with ready-row B9 (generatedSurface.triggerPaths rescope); avoid
  parallel edits to scripts/harness/generated-surfaces.ts.
- Keep path/IO concerns separate from the schema module so the seam does not
  become a portability-heavy god module.
- New script/config files carry the known registration surfaces:
  smoke-subjects header + `bun run test:scripts:subjects` regen,
  eslint-config/config-surface-manifest.json + generator rerun, coverage map
  (hand-edited), and the fixture-copy/import-closure sweep until ready-row B5
  generalizes it.

file:line refs verified 2026-07-19 at HEAD 544a9d06; they drift fast. The
phase-2 outcome banner at the top is the current record — the Evidence and
Phase 2 sections below it describe the pre-migration tree.
