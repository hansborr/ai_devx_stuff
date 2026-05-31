# drift:ai — next-checks default tracks (shipped)

Landed 2026-05-31 on `feat/drift-ai-enhancements`. Implements the three resolved
default-lane tracks from `backlog/drift-ai-next-checks-brainstorm.md` (the prototype/
heavy queue in that doc remains open). Orchestrated across implementation subagents
with a codex second-opinion review + fix pass per track.

## What shipped

### Track 1 — `coldspots` subcommand (sibling to `hotspots`)
A bespoke, brand-firewalled advisory over the same windowed git history `hotspots`
collects (`hotspots-history.ts` reused UNCHANGED). NOT a CheckPlugin — no `coldspots`
entry in `DriftCheckId`; reachable only via the subcommand. Own modules
(`coldspots-*.ts`), reusing `HotspotRowContext` + the actionability helpers + the
subcommand arg base. Two lenses (`--lens coldspot|stale-markers|all`):
- **coldspot**: gate = age past floor AND inverted-median age-standout AND
  `revisions <= floor` AND **≥1 amplifier**. Amplifiers (git+fs only):
  stale-in-hot-neighborhood (distinct dir commits / file revisions ≥ K),
  write-once-birth-burst (commit-wide ≥N files AND ≥M lines; degrades off on squash
  repos), gone-silent-author, large-file-cold (size proxy = accumulated churn;
  degrades off on blobless). Never a fixed top-N; `--top` is a disclosed display cap.
- **stale-markers**: TODO/FIXME/HACK/XXX/@deprecated restricted to comment regions
  (via `line-scanner`), aged by `git blame --line-porcelain` introduction date
  (cost-gated behind the scan; skipped + disclosed on blobless). Calendar-time
  reference, disclosed.

### Track 2 — non-function structural-duplication checks (4 opt-in)
`duplicate-types`, `duplicate-schemas`, `duplicate-literals`, `duplicate-constants`,
each its own `DriftCheckId`/config, all `runByDefault:false`, sharing one
exact-structural-hash core (`duplicate-shapes.ts`: walk → parse once → per-check
extractor → canonicalize → FNV-1a hash (`feature-hash.ts`, factored out of
`near-duplicates-fingerprint.ts`) → group cross-file → findings). Provenance
`drift-baseline`/`ts-morph`. types canonicalize a sorted prop bag + heritage;
schemas canonicalize sorted key NAMES only (lossy on validators, per spec), folding
`.extend`/`.merge` literal keys; literals/constants group by value with triviality
guards (min length, min distinct files, import/test-title skips, signed numbers).

### Track 3 — `unused-exports` check (knip pass-through expansion)
Symbol-level companion to file-level `orphan-files`: surfaces knip's `exports`,
`types`, `enumMembers`, `namespaceMembers` (each `details.category`-tagged),
`[target-config]` provenance, identical skip semantics (reuses orphan-files'
resolution/skip helpers). The knip invocation now requests the full `--include`
superset and the default runner memoizes by `(repoRoot, bin, configPath)`, cleared
at the start of each `runDriftAi` build, so enabling both knip checks under
`--check all` spawns knip ONCE. knip 6.14.1 JSON shape confirmed at runtime; fixture
`fixtures/knip-report.unused-exports.json`.

## Key decisions
- **Coldspots is its own subcommand, not lenses in `hotspots`** (resolved decision
  #1) — kept the hot/cold split clean; reused shared infra rather than copying.
- **Separate check id per duplication kind** (resolved decision #2) — granular
  enable/disable and legible findings over one mega-check.
- **`unused-exports` is a NEW check id, not folded into `orphan-files`** — keeps
  `orphan-files` strictly file-level so the `byCheck` summary stays legible; single
  shared knip spawn avoids the double-run that a naive two-check split would cause.
- **Evidence, not verdicts** throughout: every row names its source/amplifier/
  category with raw numbers + an inspect command; truncation is disclosed; no
  generated-file heuristics; only user-configured ignore/excludeGlobs filter input.

## Deferred (open follow-ups)
- knip `duplicates` category (conceptually a duplication signal; easy to add to the
  unused-exports parser).
- Shared ts-morph `Project`/parse layer (cross-cutting enabler #5) — now justified
  since ≥2 AST checks exist; each duplicate-* check re-parses per file today.
- The whole prototype/heavy queue in the brainstorm (Dolos/PMD-CPD/APTED, coverage
  overlays, feature-flag/env detection, DOA/ownership, complexity-at-birth,
  MinHash/pq-gram, the labeled fixture corpus).
- duplicate-literals/constants are inherently noisy on common small numeric values
  (e.g. 20, 3) — opt-in + evidence-framed by design; a numeric calibration knob
  (min magnitude / value allowlist) is a possible future refinement.
- **knip runtime on this monorepo is very slow (a usability cliff, not a
  regression).** Verifying `unused-exports` live, knip exceeded a 540s wall-clock
  even with no competing load. This is NOT caused by the single-spawn `--include`
  superset change: a direct `knip --include files` (the original orphan-files
  invocation, analysis untouched) also exceeds 150s with no output, so both knip
  checks (orphan-files and unused-exports) are equally slow here — it is knip's
  full project-graph build on a large TS monorepo. Correctness is covered by the
  unit tests, the codex review, and the committed real-shape fixture
  (`fixtures/knip-report.unused-exports.json`, captured from knip 6.14.1 against a
  controlled tiny project). Recommended follow-up: `defaultKnipRunner`'s `spawnSync`
  has no timeout, so a slow/hung knip blocks drift:ai indefinitely — add a
  configurable knip subprocess timeout that skips-with-reason
  (`tool-not-installed`-style) rather than hanging. This affects the pre-existing
  orphan-files check too; it was out of scope for these tracks.

## Commits
- `8df91533` coldspots subcommand + coldspot lens
- `34a41e77` stale-markers lens
- `3e33e12f` coldspots review fixes
- `f778d3f9` duplicate-* checks · `1c53d06e` review fixes
- `282a4091` unused-exports check (+ NUL-delimiter fix in knip-runner) · `b5288ef9` review fixes
