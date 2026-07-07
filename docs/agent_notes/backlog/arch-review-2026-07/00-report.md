# Architectural review — 2026-07-06

**Status:** report — retained as source material. **Promoted 2026-07-07:**
every ranked candidate now lives as a leaf in this folder or as a fold into
the pack that owned the seam — see [`01-promotion-map.md`](./01-promotion-map.md).
Dispatch from the leaves, not from this file; where a leaf and this report
disagree, trust the leaf (two claims were corrected during promotion — see
Corrections at the end).
**Date:** 2026-07-06
**Method:** five parallel read-only survey agents (agent-cli dispatch harness,
verify/hook system, lint/ratchet/policy ecosystem, analysis tooling, product
packages), orchestrator synthesis, churn stats from `git log` since 2026-04.
Every load-bearing claim carries a `file:line` citation from the survey pass;
re-verify citations before acting — this tree moves fast.
**Lens (owner ruling, this session):** the repo is a public
harness-engineering reference. Refactors are weighted by maintenance cost
**and** by legibility/copyability of the harness ideas — a harness idea
tangled into repo-specific wiring is a worse exhibit than one that travels by
file copy. This matches the portability constraint already codified in
`agent-cli-consolidation-pass/00-index.md` and the Portable Core / Promotion Rule
sections of `docs/ai-harness.md`.

## Headline verdict

1. **The product code needs no large-scale refactor.** The documented
   architecture holds in the code: shared→server→client Zod contract flow,
   services-own-logic (routers are one-line delegates), socket-after-persistence
   (verified in `packages/server/src/services/encounter-combat/turn-action.ts`:
   auth → persist → reload → broadcast), concurrency `version` helpers and auth
   helpers used as documented. Largest real source file is ~650 lines. Only
   two nameable items, both optional: `packages/server/src/routers/homebrew.ts`
   inlines collection CRUD against Prisma (lines ~139/207/221) instead of
   delegating, and is the only router without a sibling test;
   `packages/client/src/stores/map-canvas-store.ts` (620 lines, ~40 actions) is
   large but cohesive ephemeral canvas state.
2. **The harness is where the leverage is — as expected.** Harness tooling
   under `scripts/` is ~155k lines excluding fixtures (product source is ~85k
   across the three packages, excluding generated Prisma). Churn since April
   concentrates almost entirely on hand-written harness orchestration and
   manifests: `harness.controls.json` (~115 commits), `.husky/pre-commit`
   (72), `scripts/ai-hooks/policy.sh` (51), `scripts/verify.sh` (43),
   `scripts/harness-check.ts` (38), `agent-run.sh` (41). Generated files
   barely move (`steps.generated.sh`: 8). The churn is telling you where the
   architecture is still hand-held.
3. **One pattern-smell dominates the findings: "reconciled by tripwire, not
   single-sourced."** The repo's best machinery generates derived surfaces
   from one source and `--check`s freshness (hook wiring, verify slots, lint
   guidance — all healthy). But around the edges, half a dozen contracts are
   instead maintained by hand in N places and guarded by a test or a warning
   that fires *after* divergence: the pre-commit generator-freshness regex,
   the TS↔bash resolver bindings, hook timeout constants, the agent-run
   trailer/exit-code contract, and the `.claude`/`.codex` skill mirror. The
   highest-value refactor theme is finishing the single-source story the repo
   already believes in.

## Cross-cutting findings

### T1 — Hand-duplicated orchestration above a single-sourced slot table

The verify slot *table* is generated (`harness.controls.json` →
`scripts/harness/generate-verify-steps.ts` → `scripts/verify/steps.generated.sh`)
and validated by `harness-check.ts`. But the two *runners* above it —
`scripts/verify.sh` (376 lines) and `.husky/pre-commit` (458 lines) — carry
near-identical hand-written blocks that drift independently: watchdog
(`verify.sh:185-197` vs `pre-commit:319-335`), timeout-budget reporting
(`verify.sh:215-220` vs `pre-commit:367-372`), signal-wrapper meta + traps
(`verify.sh:221-233` vs `pre-commit:380-392`), and the failure-summary loop
including the same lint/format hint `case` statements (`verify.sh:334-357` vs
`pre-commit:410-436`). These are the #2 and #4 churn files in the system.

### T2 — Four copies of the generator registry

Adding a generator today means editing: (1) `harness.controls.json`,
(2) `harness-check.ts` freshness list (`checkGeneratedFreshnessOutputs`,
~187-223), (3) `harness-check.ts` EXEMPT_SCRIPTS (~66-95), (4) the
hand-maintained 12-path `generated_pattern` regex plus hard-coded `:check`
list in `.husky/pre-commit:185-192`, and package.json scripts. The manifest
already models generators as controls; the other copies should be derived.
Related existing item: `ci-local-gate-parity-guard.md`.

### T3 — TS↔bash bindings held together by string matching

Dynamic slot resolvers are declared in TS
(`scripts/harness/verify-step-schema.ts` `VERIFY_STEP_DYNAMIC_RESOLVERS`) and
implemented as bash `case` arms in `scripts/verify/steps-lib.sh:155-169`; the
only guard is `harness-check.ts:251-270` doing a substring match on a
close-paren. Hook watchdog timeouts are similarly duplicated between shell
and manifest, reconciled by `checkHookTimeoutConstants` (`harness-check.ts:393`).
Both could be *emitted* into generated bash (steps.generated.sh already emits
`MUSI_VERIFY_SLOT_DYNAMIC`; a generated constants file the shells source
would do the same for timeouts), converting reconciled-by-test into
impossible-by-construction.

### T4 — agent-run.sh: the backend switch is written four to six times

Beyond what the agent-cli consolidation pack already plans (main() +
source-guard, trailer contract, pid-capture residual, per-phase tests), the
survey found the deeper duplication axis: the claude/codex/copilot split
appears as **four separate switches** — passthrough guards (~260 lines,
`agent-run.sh:226-486`), command construction (`:873-924`), launch/wait/parse
(~137 lines, `:1112-1248`), and session-id extraction forked again inside
`on_fatal_signal` (`:1073-1083` vs `:1197/:1246`) — plus two extra
copilot-only PASSTHRU rescans (`--share` `:606-626`, CWD-move `:786-810`).
Roughly 450-500 of 1312 lines are per-backend; a new backend is five edit
sites. An adapter table (each backend supplies guard/build/launch/extract
functions; the shared lifecycle calls them uniformly) removes more complexity
than the phase split alone, and composes with it. Caution: the adapter
boundary must not paper over codex's unique pid-capture semantics — that is
the exact gap consolidation item 3 closes.

Also found there:

- The exit-code/trailer contract lives as a 39-line prose header comment
  (`agent-run.sh:1-40`), restated by hand in SKILL.md and asserted only
  implicitly by the 1762-line fork-exec test. Consolidation item 2 should own
  making the table a single artifact all three consume.
- The `.codex` mirror is duplication + post-hoc tripwire: SKILL.md and three
  references are byte-copied by hand, guarded only by the mirror-invariant
  test (`test-skill-dispatch-wrappers.sh:1748-1759`), while `.codex` already
  has *no* wrapper and points at `.claude` via `openai.yaml`. Either symlink
  or generate the `.codex` tree so the copy is derived, not authored.
- Usability asymmetry: the wrapper's own option parser accepts only
  space-separated values (`-m opus`, not `--model=opus` — rejected at
  `agent-run.sh:169`) while its passthrough guards painstakingly handle every
  attached/equals spelling.
- SKILL.md prose was cross-checked against wrapper behavior and **currently
  holds** (dead-run signature, auto-`-o` cleanup on TERM, pid-capture-failed
  trailer, `-o`-outside-worktree). The risk is drift, which consolidation
  item 6 already targets.

### T5 — Four bespoke "committed floor" implementations

The count-floor idea is implemented four independent times, each with its own
parse/compare/format/update UX:

1. `lint-ratchet.baseline.json` (55 KB, 204 items, 14 tests) — the full
   engine: `baseline-update.ts`, `baseline-merge.ts` (custom git merge driver
   per `.gitattributes:12`), debt log, `--allow-worse --reason`, retirement
   proof (`--retire-ratchet`).
2. `sensor-knip-unused-exports.baseline.json` — reimplements
   parse/compare/format from scratch in
   `scripts/sensor-knip-unused-exports-baseline.ts:39-154`.
3. `scripts/sensor-blob-size.ts` — fixed thresholds + allowlist file, a third
   model.
4. `eslint-config/shared-policy.js:130-359` `maxLinesPolicy.exceptions` — a
   28-entry hand-maintained per-file cap table with manually-incremented
   counters in prose ("+1 for the … import", `:193`) — exactly the drift the
   ratchet was built to prevent, living in source.

The ratchet's update/gate/debt-log layer is the extractable asset; the knip
sensor alone reinvents it in ~214 lines. Separately, the 55 KB single-file
baseline is a merge magnet the repo has engineered *around* (custom driver,
`postMergeTruthUpRequired` escape hatch, `post-merge-baseline-preflight.ts`)
rather than *out of* — splitting the baseline per-rule (14 small files) would
mostly dissolve the collision surface the driver exists to manage.

### T6 — No shared substrate under the TS analysis tools

The strong shared contract is at the *output* edge: paired text/JSON
formatters and the `HarnessDiagnostics` envelope validated by one Zod schema
(`packages/shared/src/schemas/harness-diagnostics.ts`) — healthy, keep. Below
it, almost nothing is shared:

- **Git plumbing spawned independently in 19 TS files.** drift-ai has a real
  injectable `GitRunner` (`scripts/drift-ai/git-changed-scope.ts:54-64`) that
  stops at the drift-ai boundary; lint-ratchet, logs-audit, sensor-blob-size,
  lint-coverage-map each re-implement merge-base/name-status/tracked-files.
- **Three full arg-parser frameworks** (`drift-ai/cli-args.ts` + 14 per-check
  `*-args.ts`, `code-intel/cli-args.ts`, inline in `harness-audit.ts:106-164`)
  above one shared value-reader (`scripts/cli-option-values.ts`).
- **File classification answered independently by four systems**:
  `scripts/path-policy/path-policy.ts` (the canonical selector engine),
  `eslint-config/shared-policy.js:13-108` globs,
  `eslint-config/config-surfaces.js` + manifest, and
  `scripts/doc-length-policy.sh:14-56` case-globs. A new config surface must
  be registered in 3-4 places (e.g. `path-policy.ts:79-88`
  `ESLINT_FULL_SCAN_TRIGGERS` re-lists what `config-surfaces.js` enumerates).
- **Test-layout inconsistency**: drift-ai/lint-ratchet co-locate ~1:1 tests;
  code-intel concentrates 2437 lines in root `scripts/code-intel.test.ts`
  plus one in-dir `.spec.ts`.

### T7 — Advisory surfaces nobody is forced to read

`sensor:blob-size` / `sensor:knip` / `sensor:knip-unused-exports` are declared
controls with maintained baselines but are wired into no gate — knip runs
weekly and non-gating (`slow-drift.yml`). Already ticketed:
`harness-review-2026-07/39-wire-or-drop-knip-jscpd.md`; this review seconds
it. Similarly `harness:audit` (diagnostics fusion) never affects an exit code
by design and has no confirmed scheduled consumer — fine as a first slice,
but its consumer story is the open half of the harness-review-tasks 20-25
track. `docs/agent_notes/` itself is a well-documented append-only knowledge
base (57 backlog + 62 finished notes) with **zero enforcement tooling** — no
staleness lint, no front-matter validation — and two large *generated* docs
(`lint-coverage-map.md`, 124 KB; `observed_flaky_tests.md`) live inside the
hand-authored tree where they read as curated context.

## Ranked refactor candidates

Ordered by leverage within tiers. Effort/risk are relative to this repo's
test safety net, which is unusually strong.

### Tier 1 — structural, do these

- **A1. Single verify engine.** Extract the duplicated watchdog / lock / trap
  / marker / failure-summary machinery (T1) into one
  `scripts/lib/verify-engine.sh` (or grow `steps-lib.sh`) parameterized by
  consumer (manual verify, pre-commit, land). Kills the divergence risk
  between the two highest-churn hand-written files. Risk: high — this is the
  correctness core (locks, watchdog signals, `verify-metadata.sh` markers);
  lean on `scripts/tests/test-verify.sh` / `test-pre-push.sh` and do it as a
  mechanical extraction, not a redesign.
- **A2. Finish single-sourcing: generate every reconciled-by-tripwire
  binding.** Derive the pre-commit freshness block from the manifest (T2);
  emit the resolver dispatch table and hook timeout constants into generated
  shell (T3); make the agent-run exit-code/trailer table one artifact
  consumed by wrapper, test, and SKILL.md (T4, extends consolidation item 2).
  Risk: low-medium, mostly mechanical; the generator + `--check` pattern is
  already the house style. Fold the pre-commit piece into
  `ci-local-gate-parity-guard.md`.
- **A3. Backend adapter table in agent-run.sh.** Amend
  the agent-cli consolidation pack's phase-split leaf: the phase split alone leaves the
  4-6× backend switch intact; restructure per-backend logic as one adapter
  set per backend (guard/build/launch/extract), folding in the copilot
  special-cases. Keep single-file bash (portability ruling stands). Risk:
  medium — preserve codex pid-capture semantics exactly; the fork-exec test
  suite is the behavioral contract.
- **A4. One baseline framework, smaller baselines.** Extract the ratchet's
  update/gate/debt-log layer behind a `Baseline<Metric>` abstraction; migrate
  the knip sensor onto it; move `maxLinesPolicy.exceptions` out of
  `shared-policy.js` into a real baseline (preserving reason/lifecycle prose
  as metadata); split `lint-ratchet.baseline.json` per-rule to dissolve the
  merge magnet (the merge driver already operates per-test-id). Risk: medium
  on the framework (don't force the ratchet's rich item model onto scalar
  sensors — extract the update/gate layer first, leave collectors bespoke);
  low on the per-rule split; high only for merge-driver semantics, which must
  be preserved exactly.

### Tier 2 — decide first, then execute

- **B1. Write down the substrate ruling (bash vs TS).** Today the boundary is
  by-accident (T6; `db-status.sh` *and* `db-status.ts`; 831-line `doctor.sh`
  holding analysis logic in bash). Proposed policy, consistent with
  `docs/ai-harness.md`'s Portable Core section: portable-skill surfaces stay
  single-file dependency-free bash; repo-local gate orchestration stays bash
  but shares engine libs (A1); anything analytical lives in TS. A full
  Bun/TS rewrite of agent-run.sh was considered and is **not recommended**
  under the copyability lens — a `.sh` runs before `bun install` in a fresh
  worktree; A3 shrinks the bash instead. Record the ruling in
  `docs/ai-harness.md` so future tools don't re-litigate it.
- **B2. Shared TS script substrate, adopted incrementally.** Promote
  drift-ai's `GitRunner` to `scripts/lib/git.ts` and migrate callers one at a
  time (19 sites; each has subtly different name-status/rename handling —
  superset API, per-tool regression). Add `scripts/lib/cli.ts` (arg loop +
  `--format` + envelope output) and adopt in the three simple tools
  (code-intel, logs-audit, harness-audit) first; leave drift-ai's internal
  arg matrix alone initially.
- **B3. Path-policy as the single file-classification source.** Make
  `shared-policy.js` globs, the config-surface manifest, and
  `doc-length-policy.sh` derive from (or generate into) path-policy
  selectors. Overlaps the lint-deep-dive-2026-07 config-architecture track —
  reconcile before starting. Risk: medium-high; ESLint flat-config glob
  semantics are unforgiving, so start with the config-surface list, which
  already has a manifest.
- **B4. agent_notes: light tooling, not a database.** A `backlog:lint` that
  validates Status/Date front-matter and flags items stale past N months,
  plus moving the two generated docs out of the hand-authored tree. The
  folder's schema is good; it just isn't enforced.

### Tier 3 — cheap cleanups (bundle into a drain leaf)

- `.codex` skill mirror: derive instead of hand-copy (symlink if the Codex
  loader dereferences; else a tiny sync-check that *regenerates* rather than
  just trips).
- agent-run.sh option parser: accept `--opt=value` spellings for its own
  options.
- Dead defense: `MultiEdit` in the claude guard/disallow list
  (`agent-run.sh:303,895`) — acknowledged gone from claude 2.x.
- `.no-stop-verify` legacy kill-switch alias (`stop-policy.sh:14`) and the
  `MUSI_VERIFY_TIMEOUT` back-compat env (3 files) — retire when no worktree
  carries them.
- `db-status.sh` vs `db-status.ts` — pick one.
- `scripts/harness-audit/` is a hollow directory (fixtures only; logic lives
  in `scripts/harness/harness-audit-report.ts`) — fold into
  `scripts-flat-family-reorg.md`.
- Split root `scripts/code-intel.test.ts` (2437 lines) into co-located
  `code-intel/*.test.ts`; standardize `.test.ts` vs `.spec.ts`.
- Model/version pins in agent-cli references (`gemini-3.5-flash`,
  CLI versions) — consolidation item 7 should own a version-drift note.

## Explicit non-findings (healthy; copy these patterns, don't touch them)

- **Rule-metadata single-sourcing** — `meta.docs` → guidance doc + agent
  envelope via `scripts/lib/lint-rule-docs.js`; guidance cannot drift from
  rules. This is the model A2 generalizes.
- **`HarnessDiagnostics` envelope** — one Zod schema, emitted by drift-ai /
  logs-audit / lint-agent / lint-ratchet; the strongest shared contract in
  the tooling.
- **Hook wiring generation** — one manifest fans out to Claude/Codex/Copilot
  configs; all 13 hooks wired, zero orphans. (The per-harness 300-byte shim
  dirs are a minor tax; only revisit if hook count grows.)
- **Ratchet hygiene** — zero stale baseline paths (orphan gate works), debt
  log functioning as a retirement ledger (12/13 entries drain ratchets into
  normal ESLint). The endgame trend is correct; A4 accelerates it.
- **drift-ai internals** — 253 files with near-1:1 co-located tests and a
  consistent per-check file grammar; large but disciplined.
- **Product packages** — see headline; no structural work warranted.

## Cross-references

- `agent-cli-consolidation-pass/00-index.md` — A3 and parts of A2/Tier-3
  were folded into its leaves 10/13/20 during promotion; do not run a
  parallel effort.
- `ci-local-gate-parity-guard.md` — A2's pre-commit piece lands there.
- `harness-review-2026-07/39-wire-or-drop-knip-jscpd.md` — T7 seconds it.
- `lint-deep-dive-2026-07/00-index.md` (config architecture track) — B3
  overlaps; reconcile first.
- `scripts-flat-family-reorg.md` — absorbs the hollow-dir and flat-family
  cleanups.
- `harness-review-tasks/` items 20-25 — harness:audit consumer story (T7).

## Corrections (2026-07-07, promotion pass)

Found while promoting candidates into leaves (Claude + Codex + Gemini
delegability review); the leaves carry the corrected scope.

- **A4's per-rule baseline split is withdrawn.** Sharding
  `lint-ratchet.baseline.json` per rule was already rejected as won't-do on
  2026-07-02 (`../harness-review-2026-07/13-baseline-sharding-per-ratchet.md`):
  the semantic min-merge driver landed (`e8b9f7db`, hardened `6a0106df`) and
  covers both collision classes, including the same-rule/different-file case
  sharding cannot fix. This review's survey missed that closed design gate.
  The rest of A4 stands — see `12-baseline-framework-and-max-lines.md`.
- **A4's knip piece overlaps an existing drafted design.**
  `../lint-deep-dive-2026-07/61-knip-identity-baseline.md` already holds the
  identity-ledger design (deferred pending owner review); leaf 12 coordinates
  with it instead of duplicating.
- **B3's reconciliation caveat is resolved.** The lint-deep-dive integration
  branch is in `main` as of 2026-07-07 (`854bd87d` verified an ancestor), so
  leaf 15 targets `main` and reconciles scope against lint-deep-dive leaves
  41/42 outcomes rather than waiting on a merge.
- **The headline's "only router without a sibling test" claim is wrong in
  substance.** `homebrew.ts` has five aspect test files
  (`homebrew-{collection,entry,export,import,campaign}.test.ts`); a
  describe-block sweep on 2026-07-07 confirmed all 12 of the router's
  procedures are covered, including the inline collection CRUD. Only the
  literal `homebrew.test.ts` filename is absent. The surviving optional item
  is the delegation-style point alone (inline Prisma CRUD instead of a
  service), which remains not promoted.
