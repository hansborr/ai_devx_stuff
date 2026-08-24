# 117. `verify-metadata.sh` is a 1,406-line kitchen-sink shell library conflating six gate-metadata concerns behind one ambient namespace

Status: Landed on fix/cq-117
Theme: gate shell library decomposition · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/lib/verify-metadata.sh` introduces itself as "Helpers for verification
timing metadata shared by pre-commit, verify, and verify:logs". What it actually
holds is six distinct gate subsystems — repository/worktree identity and
standard state paths, commit-queue waiter tickets, fast-commit provenance and
its marker tripwire, path policy plus staged-change classification and
fingerprints, success-marker codecs plus the verify-marker bridge, and the
run-meta reporting shims — 1,406 lines and 74 functions sharing one ambient
shell API. The name and header understate the responsibilities, and only four
`# ---` section banners exist for the whole file, so most of the concern
boundaries are invisible: a reader has to reconstruct them from function-name
prefixes, and a few staged-classification helpers sit lexically stranded in the
middle of the marker section.

The cost is concentrated on the highest-churn harness surfaces. Fast-commit
behavior, marker freshness, and path policy are exactly the places gate work
keeps touching, and every such change currently loads a 1,406-line file into
the reasoning window: which of the 74 functions share state conventions, which
of the 22 sourcers (including all three Husky hooks — the most gate-critical
path in the repo) observe the change, and whether an edit in one concern leaks
into another. For a repo meant to be read as a public harness-engineering
reference, the individual mechanisms in here (fast-commit provenance, the
verify-marker bridge, commit-queue waiters) are among the most copyable ideas
in the tree, and none of them can be lifted without hand-extraction from the
monolith.

The file is, however, structurally well-behaved: apart from three `MUSI_GATE_*`
constants, it is function definitions only, with no source-time side effects
and an acyclic internal call graph. That property is what makes a low-risk,
move-only decomposition possible.

## Evidence

- `scripts/lib/verify-metadata.sh` — 1,406 lines, 74 top-level function
  definitions (72 brace-bodied plus two subshell-bodied at `:568`, `:594`),
  re-measured at the pin.
- The header at `:2-3` claims only "verification timing metadata"; the concern
  roster is far wider: fingerprint/identity/marker-age primitives (`:36-119`),
  repo/worktree identity and the `musi_standard_*` state/lock/marker path
  family (`:121-272`), commit-queue waiter tickets (`:274-340`), fast-commit
  provenance log, pending marker, and marker tripwire (`:342-475`), path-policy
  query bridge plus staged classification and staged/pre-commit fingerprints
  (`:477-781`), success-marker read/match/write and the verify-marker bridge
  (`:783-1049`), and run-meta codec shims (`:1051-1406`).
- Only four section banners exist in the whole file (`:19`, `:342`, `:418`,
  `:1051`); the identity, queue, path-policy, and marker sections have none.
- Concerns interleave: `musi_staged_has_script_relevant_deletion` (`:928`),
  `musi_nul_paths_are_line_safe` (`:940`), and
  `musi_classify_staged_script_input` (`:951`) are staged-classification
  helpers (consumed by `scripts/verify/steps-lib.sh`) sitting between the
  success-marker codecs and the marker bridge.
- Top-level executable code is exactly three constants —
  `MUSI_GATE_MARKER_FRESHNESS_SECONDS` (`:30`),
  `MUSI_GATE_INTERACTIVE_TIMEOUT_DEFAULT` (`:32`),
  `MUSI_GATE_PRE_PUSH_FRESHNESS_SECONDS` (`:34`); everything else is function
  definitions, so sourcing is side-effect-free.
- 21 shell files source it by literal path — `.husky/pre-commit`,
  `.husky/pre-push`, `.husky/post-commit`, `scripts/verify.sh`,
  `scripts/land.sh`, `scripts/lint-shell.sh:9`, `scripts/ai-hooks/cache.sh`,
  `scripts/ai-hooks/commit-output.sh`, five `scripts/tests/*` suites, and eight more
  lint/register/verify scripts — plus the pinned smoke via a variable
  (`scripts/tests/test-verify-metadata.sh:36`); ~41 files reference the
  filename repo-wide.
- The dedicated smoke, `scripts/tests/test-verify-metadata.sh`, is 1,323 lines
  and sources the entire file, so any reorganization is pinned end to end.
- `scripts/lib/` already demonstrates the intended shape: twelve other
  single-concern libs (`gate-env.sh`, `changed-base.sh`, `parallel-runner.sh`,
  `test-worker-count.sh`, …) sit beside this file and the sibling 991-line
  `verify-engine.sh`.
- The analytical half already moved out once:
  `scripts/lib/verify-metadata-core.ts` owns run-meta JSON parsing per the file
  header (`:15-18`), and the prior pack's
  [`29-bash-to-ts-cores.md`](../code-quality-2026-07-25/29-bash-to-ts-cores.md)
  (`:43`, `:173-175`) noted the shell file was "still 1,334 lines" after that
  extraction and explicitly scoped it out. It has since grown to 1,406.

## Proposed direction

Bash-only, move-only decomposition into six flat single-concern engine libs in
`scripts/lib/`, with `scripts/lib/verify-metadata.sh` retained **permanently**
as the source-all aggregator and sole public entry point. The aggregator is the
public API, not a transition aid: all sourcers (Husky hooks, `verify.sh`,
`land.sh`, `lint-shell.sh`, ai-hooks, tests) stay byte-identical and no
consumer is ever repointed at a leaf lib. Every function keeps its name and
body — function names are the ABI. Although sized L at triage, the agreed
move-only shape lands as three modest slices (effectively M).

1. **Extract along the verified dependency DAG into six leaf libs** (sizes
   approximate; exact membership follows each function's callers, not its
   lexical position):
   - `verify-state-paths.sh` (~270 ln): git-readonly + fingerprint/identity
     primitives, the `musi_standard_*` state/lock/marker paths, and the three
     `MUSI_GATE_*` budget constants.
   - `verify-commit-queue.sh` (~70 ln): waiter tickets (`:274-340`).
   - `verify-fast-commit.sh` (~135 ln): provenance log + pending marker +
     tripwire (`:342-475`).
   - `verify-path-policy.sh` (~300 ln): path-policy query bridge, staged
     classification (including the stranded helpers at `:928-989`), and
     staged/pre-commit fingerprints.
   - `verify-markers.sh` (~270 ln): success markers + verify-marker bridge.
   - `verify-run-meta.sh` (~350 ln): the shims over
     `verify-metadata-core.ts` (`:1051-1406`).
2. **Give each leaf lib a contract.** A `__MUSI_*_SOURCED` re-source guard; a
   header comment stating what it owns, what must be sourced first (leaves
   never source each other — the aggregator owns ordering), and the standing
   invariant "function definitions only, no source-time side effects".
   `verify-metadata.sh` becomes the constants plus six `source` lines in
   dependency order.
3. **Land in three layer-grouped slices, ordered by blast radius, each behind
   a full gate:** (1) `verify-run-meta.sh` + `verify-commit-queue.sh` — both
   fully self-contained, proving the aggregator pattern; (2)
   `verify-fast-commit.sh` + `verify-path-policy.sh`; (3)
   `verify-state-paths.sh` + `verify-markers.sh`. If slice 1 surfaces a hidden
   cross-section dependency, drop to one-seam-per-slice for the remainder.
4. **Per slice, verify with the existing suites:**
   `bash scripts/tests/test-verify-metadata.sh` (the pinned 1,323-line smoke),
   `bash scripts/tests/test-pre-push.sh`, `bash scripts/tests/test-verify.sh`,
   ShellCheck via `bash scripts/lint-shell.sh`, and `bun run harness:check`.
   Also work a registration checklist per new lib: does it need
   `# smoke-subjects:` coverage (regenerate with
   `bun run test:scripts:subjects`), fixture-closure annotations, or
   `harness.controls.json` generated-surface rows before landing?
5. **Final slice: make the map honest.** Shrink the `verify-metadata.sh` top
   comment to the aggregator contract with a concern map naming the six libs,
   and cross-link the relevant
   [`docs/guides/verify-gate-lifecycle.md`](../../../guides/verify-gate-lifecycle.md)
   sections to the per-concern files. The public harness-reference goal is part
   of the payoff: fast-commit provenance, the verify-marker bridge, and
   commit-queue waiters each become one self-describing, copyable file.
6. **Any hand-rolled parsing discovered during the move extends the existing
   `scripts/lib/verify-metadata-core.ts`** — never a new codec or parallel
   typed module.

## Scope / caveats

- **Binding: no new typed modules, TS facade, or new codec for these
  concerns.** The Substrate Ruling
  ([`docs/ai-harness.md`](../../../ai-harness.md), `:280-299`) keeps gate glue
  in bash sharing extracted engine libs, and the landed analytical-core plan
  ([`05-verify-metadata-ts-analytical-core.md`](../arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md))
  carries the measured cost record that closed further TS migration (bare codec
  spawn ~21 ms vs jq ~16 ms; `musi_persist_run_meta_history` 18 ms → 130 ms per
  call). This leaf is the bash-module split that ruling's "share extracted
  engine libs" clause calls for; do not re-litigate the substrate.
- **Binding: no consumer repointing and no file rename.** The `.husky` hook
  consumer surface is fenced by a standing do-not-reopen decision from the
  prior pack; `verify-metadata.sh` stays the sole entry point, leaf libs are
  internal layering, and renaming the aggregator would churn ~40 referencing
  files for zero isolation value.
- **Binding: move-only.** No function renames, no behavior changes, no
  "improvements" in flight — the pinned smoke and the hook suites must pass
  unmodified per slice, with a full gate on each land.
- **Binding: three slices is deliberate, not a precedent violation.** The
  prior pack's one-seam ruling for `worktree-db.sh` calibrated pacing for a
  2,526-line CLI with command dispatch, top-level effects, and live-infra blast
  radius; this file is a verified side-effect-free acyclic function library
  behind an unchanged aggregator. The fallback to one-seam-per-slice (step 3)
  is the escape hatch if that assessment proves wrong.
- **Out of scope: `scripts/lib/verify-engine.sh`** (991 lines, the sibling
  kitchen sink). Same smell, separate finding with its own scheduling
  decision; do not fold it in.
- **Sequencing:**
  [`141-latest-log-discovery-mirrors-verify-state.md`](./141-latest-log-discovery-mirrors-verify-state.md)
  duplicates the state-path protocol on the consumer side and would resolve
  against the same surface `verify-state-paths.sh` extracts in slice 3 — land
  that leaf before or after slice 3, not concurrently with it.
- **Prior pack:** the live 2026-07-25 pack's leaf 29 extracted
  `verify-metadata-core.ts` and explicitly scoped `verify-metadata.sh` itself
  out (`29-bash-to-ts-cores.md:173-175`), so this decomposition is open work,
  not a reopen; its S2 cost record is the reason step 6 extends the existing
  codec rather than adding one.
- The `~270/~70/~135/~300/~270/~350`-line lib sizes are estimates from the
  section spans; slice work should let the internal call graph, not the line
  ranges, decide each function's home (the `:928-989` helpers are the known
  case where lexical position and concern disagree).
