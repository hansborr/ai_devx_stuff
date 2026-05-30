# 33 — Near-duplicate functions plugin (ts-morph)

Status: Done
Track: C · Size: M
Depends on: 21, 30 · Blocks: none

## Goal

Catch AI-typical **near-clones** — same logic with renamed variables, reordered
statements, or a tweaked signature — that the existing `duplicates` (jscpd) check
misses because jscpd is exact/token-based. Near-duplication is the #1
empirically-measured AI-drift signal (GitClear, OX Security), so this deepens
drift:ai's strongest existing surface.

## Background

Read the adapter contract [`03-adapter-contract.md`](./03-adapter-contract.md)
(task 30's deliverable) first. This is a **measurement-ish adapter** under that
contract (`../drift-ai-hotspots-brainstorm.md` §2.4 catalog row): there is no "target
standard" for duplication, so the similarity threshold is unavoidably
**drift:ai-authored** — tolerable precisely because there is nothing in the target
to defer to. The config-authority ladder from task 30 therefore does **not** apply
here, but the skip-clean-when-engine-absent rule does. It registers as a check via
**task 21's registry** and returns a `CheckOutcome` (skip model: task 21).

The default engine is shaped by the OpenClaw validation: the tools checkout has
`ts-morph` but NOT `similarity-ts` (`02-seam-map.md` §12 Dependency availability).
Critically, the ts-morph engine needs **no target install** — it fingerprints
source directly — so unlike tasks 31 and 32, this check **is testable on
OpenClaw** even though OpenClaw is uninstalled.

## Seams to touch

- **New check** registered in task 21's registry; returns `CheckOutcome`.
- **Complements (does not replace)** the existing exact-clone duplicates check
  (`02-seam-map.md` §4 jscpd resolution).
- **Deps:** `02-seam-map.md` §12 — `ts-morph@^28` is present (default engine);
  `similarity-ts` is NOT (optional engine, cargo-installed, never an npm dep).
- **Scope:** the existing git seam (`02-seam-map.md` §5) for the changed set when
  bounding the comparison to changed/churned files.

## What to do

**Default engine = `ts-morph`** (already present), needing no target install:
- Fingerprint functions by normalized AST shape: normalize identifiers, hash the
  AST structure, compare within a token-count band.
- Conservative similarity floor (≥0.85) plus a min-lines / min-tokens floor to
  protect the low-FP contract (tiny functions must not flood the report).
- Sort by `lines × similarity` so the report leads with the highest-impact pairs.
- Report-only, like every other check.

**Optional engine = `similarity-ts`** (a Rust binary installed via `cargo install`,
**NOT** npm — it is not and will not be a tools-checkout npm dep, `02-seam-map.md`
§12): a higher-fidelity mode that activates ONLY if the binary is present, else
**skips cleanly** (measurement-ish adapter — per task 30, skip when the engine is
absent; never a WARN finding). Never on by default.

## Open decisions

Resolved decisions:

- **Fingerprint normalization** — default ts-morph engine fingerprints named
  functions/methods/assigned arrows. It normalizes binding identifiers and type
  annotations, keeps property names, and buckets candidates by normalized
  statement-shape before similarity comparison. That catches renamed variables and
  reordered independent statements without all-pairs comparison across unrelated
  callbacks.
- **Defaults** — `minLines: 8`, `minTokens: 45`, `similarityThreshold: 0.85`,
  `tokenBandRatio: 0.35`; config may tune these, but the parser rejects
  thresholds below `0.85` to preserve the low-FP contract.
- **Scope** — both intra-file and cross-file pairs are eligible. In changed scope,
  only pairs touching a changed file are reported; current scope reports all.
- **Engines** — `ts-morph` is the default and needs no target install.
  `similarity-ts` is a config-selected optional engine; if the Cargo binary is
  absent from `PATH`, the check skips with `code: tool-not-installed`.
- **Default run set** — the check is opt-in (`runByDefault: false`) because it
  compares functions across the project. Use `--check near-duplicates` or
  `--check all`.

## Testing

- Fixtures of near-clones jscpd misses (renamed variables, reordered statements,
  tweaked signatures); confirm the min-lines floor keeps tiny functions out.
- Validate on Musi and on **OpenClaw current scope** — ts-morph needs no target
  install, so OpenClaw IS testable here (unlike tasks 31/32). Measure runtime on
  OpenClaw's ~15k files and decide whether to bound the comparison to the
  changed/churned set rather than the whole repo.

Validation:

- `bunx vitest run scripts/drift-ai/near-duplicates.test.ts` — 10 tests passed
  (renamed variables, reordered statements, tiny-function floor, changed-scope
  filtering, runner walk, plugin provenance, optional-engine skip).
- `bun scripts/drift-ai.ts --scope current --check near-duplicates --root
  scripts/drift-ai` — exit 0, 65 scoped files, 2 findings (the existing jscpd/knip
  resolver helper clones), `[drift-baseline]`.
- OpenClaw current scope (`src packages apps extensions ui config`) — exit 0,
  14,923 scoped files, 619 findings, no skips, ~9s after statement-bucket
  bounding. The first all-pairs attempt exceeded 60s and was aborted; that is why
  the landed comparison is bucketed by normalized statement shape.

## Out of scope

- Replacing jscpd — keep the exact/token-clone `duplicates` check; this is an
  additive near-clone surface.
