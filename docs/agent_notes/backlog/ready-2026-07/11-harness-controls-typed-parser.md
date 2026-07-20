# Typed harness-controls parser at the manifest seam

Status: Ready
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

file:line refs verified 2026-07-19 at HEAD 544a9d06; they drift fast.
