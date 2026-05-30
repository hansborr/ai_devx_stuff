# 31 — Import-cycles plugin

**Status:** Done
**Track:** C  **Size:** medium
**Depends on:** 21 (CheckOutcome skip model), 30 (adapter policy & base contract)  **Blocks:** none

## Outcome (landed 2026-05-29)

New opt-in `import-cycles` check. Files: `import-cycles-graph.ts` (injected
`ModuleGraphRunner` I/O seam), `import-cycles.ts` (pure SCC + classification +
findings + partiality), `import-cycles-check.ts` (the `CheckPlugin`), plus
`import-cycles.test.ts`. Wired through the registry, CLI (`--tsconfig`), runner,
report-builder, types/config, README, and the lint-coverage-map.

**Spike (the locked decision) — ts-morph (c) PASS.** Measured against installed
Musi (1715 `.ts/.tsx`): full graph build + resolve + SCC in **~0.65s** using
ts-morph's re-exported `ts` compiler API (`ts.createSourceFile` for
import/export/dynamic-import extraction + `ts.resolveModuleName` over **per-file
nearest-tsconfig** discovery + iterative Kosaraju SCC). Honored the `@/*` client
alias; ~96% of internal imports resolved (the rest were `.css` assets and
deliberately-partial codemod fixtures). No new dependency; **no fallback to
import-x or madge needed.** A full ts-morph `Project` type-check was not needed and
would have been far slower — the raw-`ts` resolve path is the fast core.

**Resolved decisions:**
- *Skip-vs-partial:* no hard install gate (ts-morph resolves aliases offline — the
  point of (c)). Attempt the build, then skip `no-target-config` if no tsconfig
  governs any file, or skip when `unresolvedCount/candidateCount > 0.25`
  (`target-not-installed` if `node_modules` absent, else `resolution-too-partial`).
  Only genuine resolution *failures* count toward partiality — a candidate that
  resolves into `node_modules`/`.d.ts`/outside-the-walked-set is external, not a
  failure (codex review P2, fixed).
- *Type-only cycles:* **labeled**, not dropped (spike showed 14/18 Musi SCCs were
  type-only). Value-graph SCCs are runtime cycles (unlabeled); full-graph SCCs with
  no runtime-cycle member are reported as type-only with a "not a runtime defect"
  message + `details.typeOnly`. A type-only tangle fused into a component that also
  contains a runtime cycle is intentionally subsumed under the runtime finding (no
  overlapping double-report; the task permits ignore-or-label).

**Validation:** Musi installed — current scope 1700 files/~1.1s/exit 0 → 17 cycles
(5 runtime incl. a real one in `duplicates-runner.ts`, 12 type-only); changed scope
filters to cycles touching changed files. OpenClaw (uninstalled, 14923 files, ~30
aliases, shallow clone) — exit 0/~10s, aliases resolved offline → reported real
cycles (a 164-file runtime tangle, a 96-file type-only tangle) with no false skip.
26 unit/fixture tests (4 acceptance-criteria fixtures: alias-remap, type-only,
barrel, package boundary). `verify:changed` green; codex review found no P0/P1.

## Goal

Add the first new structural check: **import cycles.** A cycle is a concrete,
near-zero-false-positive defect that AI introduces routinely — when it splits a
module and the new child re-imports its parent, a cycle forms. Cycles are
verdict-free facts (there is no threshold to mis-import), which makes this the
highest-value, lowest-FP candidate (`../drift-ai-review/additional-checks-research.md`
#1; `../drift-ai-improvements.md` Part D / roadmap step 8).

## Background

Read [`01-shared-context.md`](./01-shared-context.md),
[`02-seam-map.md`](./02-seam-map.md), and the adapter contract
[`03-adapter-contract.md`](./03-adapter-contract.md) (task 30's deliverable) first.
This task is a **config-honoring structural adapter** under that contract.

This check registers as a new check and returns a `CheckOutcome` — both the
registry and the `CheckOutcome` skip model are **introduced by task 21**, not
existing seam-map sections. It is governed by the adapter policy from **task 30**
as a config-honoring structural adapter (it must honor the target's tsconfig
aliases), but cycles themselves are verdict-free, so there is no threshold to
defer. Install detection, the `ExternalAdapter` base, and the missing-tool skip
rule are **task 30's contract**, also not seam-map sections.

The OpenClaw validation (`01-shared-context.md` "Concrete target: OpenClaw")
illustrates three repo-agnostic constraints: a target may not be installed (no
`node_modules` at all), the tools checkout does **not** contain `madge` or
`dependency-cruiser` (only `ts-morph`, `knip`, `jscpd`, and
`eslint-plugin-import-x`), and real targets can have extensive tsconfig path
aliases (OpenClaw has ~30, including `@openclaw/*` and a remapping
`@openclaw/* → ./extensions/*`). Any resolver choice must survive all three.

## Seams to touch

Existing code:

- **`02-seam-map.md §5` (Git seam)** — `git-changed-scope.ts`; `discoverChangedFiles`
  at `:118–129` (the `:119` `git diff` SIGSEGV note matters: changed-scope must be
  validated on Musi / a full clone, not the shallow OpenClaw checkout). Changed
  scope = cycles touching changed files; current scope = whole graph.
- **`02-seam-map.md §10` (Config)** — config plumbing; the resolver must read the
  target's tsconfig `paths` (alias map). tsconfig discovery is target-local, per
  task 30's ladder.
- **`02-seam-map.md §12` (Dependency availability)** — `ts-morph@^28` present (no
  bin), `eslint-plugin-import-x 4.16.2` present, `madge` / `dependency-cruiser`
  absent. Drives the resolver decision below.

The check registration site and the `CheckOutcome` return are new surface from
task 21; the cycle detector itself is new code this task adds.

## What to do

Register the check (task 21 registry) and implement cycle detection over the
resolved file set, honoring scope (`02-seam-map.md §5`): **changed** scope reports
cycles touching changed files; **current** scope reports the whole graph.

### Resolver decision — the crux

`madge` and `dependency-cruiser` are NOT in the tools checkout; `ts-morph` and
`eslint-plugin-import-x 4.16.2` ARE (`02-seam-map.md §12`). Three options:

- **(a) Add `madge` as a tools-checkout dep** and shell `madge --circular --json`.
  Mature, battle-tested cycle output. Cost: a new tool dep and madge's own
  tsconfig-alias handling must be confirmed against OpenClaw's ~30 aliases
  including the `extensions/*` remap.
- **(b) Use `eslint-plugin-import-x`'s `no-cycle` rule.** **import-x `4.16.2` is
  already a root dependency** (`01-shared-context.md` / `02-seam-map.md §12`) —
  this is confirmed-available, no new dep. import-x resolves tsconfig paths via
  its resolver settings, but wiring it as a standalone cycle detector (outside a
  full eslint run) is awkward, and targets may use non-ESLint linters (OpenClaw
  uses oxlint), so there may be no eslint pipeline on the target to lean on —
  drift:ai would drive import-x itself.
- **(c) ts-morph-based cycle detection in-process.** Zero new dependency (ts-morph
  already present), honors tsconfig via its `Project` loader (which reads
  `compilerOptions.paths`), but more code for drift:ai to own (build the import
  graph, run a cycle search, label edges).

**Locked decision:** evaluate the **ts-morph path (c) first** — it is already
present and resolves tsconfig aliases through its project loader, so it has the
best chance of surviving OpenClaw's alias map with no new dependency. **Require a
spike** to confirm performance and correctness on a real graph before committing:
ts-morph's full-program load can be slow on a 15k-file repo, and its resolution
depends on the target being installed for non-aliased bare imports. If the spike
shows ts-morph is too slow or too partial when uninstalled, fall back to (b)
import-x `no-cycle` (already available). Do **not** add `madge` in the first
pass; treat a new dependency as a separate follow-up decision if both existing
options fail. Record the spike result in this task.

### Skip-vs-partial on uninstalled targets

An uninstalled target with ~30 aliases means full module resolution needs the
target installed (`01-shared-context.md`). Decide and document the degrade per
**task 30's** skip-vs-finding rule:

- **Recommended:** resolve via tsconfig `paths` where possible (alias-internal
  imports often resolve without `node_modules`), and **skip-with-reason** (`code`
  e.g. `target-not-installed` / `resolution-too-partial`) if resolution is too
  partial to trust. A partial, untrustworthy cycle graph must NOT be reported as
  fact — that would violate evidence-not-verdicts
  ([[feedback_drift_ai_evidence_not_verdicts]]).
- Do not emit a finding for an uninstalled target as if it were a defect —
  uninstalled = expected absence = skip (task 30's jscpd-precedent correction).

### Acceptance criteria for enabling by default (each is a fixture requirement)

Write each of these as a fixture the resolver must pass before the check is on by
default:

- **Honors target tsconfig path aliases.** Fixture with neutral aliases including
  a remap (e.g. `@app/* → ./src/*` plus `@workspace/* → ./packages/*`; OpenClaw's
  `@openclaw/* → ./extensions/*` is the motivating example, not the fixture
  target); a cycle through an aliased import is detected, a non-cycle through an
  aliased import is not falsely reported.
- **Type-only import cycles are ignored or clearly LABELED.** A cycle formed
  solely by `import type` edges is either excluded or surfaced with an explicit
  type-only label (decide below). A type-only cycle is not a runtime defect and
  must not read as one.
- **Barrel files do not collapse every fan-out into noise.** A barrel
  (`index.ts` re-exporting many modules) must not turn every consumer into a
  reported cycle; only genuine back-edges through the barrel count.
- **Monorepo package-boundary cycles are reported per the target's package
  graph.** A cycle that crosses workspace package boundaries is detected against
  the package graph, not just file paths.

## Locked decisions

- **Resolver dependency:** spike `ts-morph` first; fall back to
  `eslint-plugin-import-x`'s `no-cycle` only if the spike fails. Do not add
  `madge` without a separate follow-up decision.

## Open decisions

- **Skip vs. partial on uninstalled targets:** recommend tsconfig-paths
  resolution + skip-with-reason when too partial. (See above.)
- **Type-only cycle handling:** ignore vs. label. *Recommendation:* **label**
  rather than drop — a type-only cycle is still evidence the human may want, and
  labeling preserves the evidence-not-verdicts stance while making the
  runtime-irrelevance explicit. Decide during the spike based on noise on
  Musi/OpenClaw.

## Testing

- Fixtures for each acceptance criterion above: tsconfig aliases (with remap),
  type-only cycles, barrel files, monorepo package boundaries.
- Run against **Musi (installed)** for a real, fully-resolved result — Musi is the
  installed-target validation.
- Validate the resolver against **OpenClaw's alias map conceptually** (the ~30
  aliases including the `extensions/*` remap), but note that **full validation
  needs an installed target**, which OpenClaw is not (`01-shared-context.md`). So:
  prove resolution on a **small installed fixture + Musi**, and treat OpenClaw as
  a conceptual alias-map check plus a test of the uninstalled skip path (it should
  skip cleanly with a clear reason). Changed-scope must be validated on Musi / a
  full clone, never the shallow OpenClaw checkout (`02-seam-map.md §5`, the
  `git diff` SIGSEGV).

## Out of scope

- Layering / architecture rules (dependency-cruiser custom rulesets) — that is a
  later "Maybe", not this task.
- Adding `dependency-cruiser` to the tools checkout.
- The adapter policy itself (task 30) — this task consumes it.
- Hotspots-style coupling metrics (fan-in/fan-out ranking) — those belong in the
  `hotspots` subcommand (task 40), not this check.
