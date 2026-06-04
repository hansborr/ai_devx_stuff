# drift:ai next-items shared context

Read this before implementing any task in this folder.

## Current state

The first drift:ai improvement wave has landed. The live check registry currently
includes:

- default or diff-oriented checks: `duplicates`, `ghost-files`, `comments`,
  `suppressions`;
- whole-project opt-in checks/adapters: `orphan-files`, `import-cycles`,
  `near-duplicates`, `unused-exports`;
- opt-in structural duplicate checks: `duplicate-types`, `duplicate-schemas`,
  `duplicate-literals`, `duplicate-constants`.

The live subcommands include:

- `harness-freshness`;
- `hotspots --lens churn|coupling|fragmentation|suppression-churn|thrash|all`;
- `coldspots --lens coldspot|stale-markers|all`.

## Contracts to preserve

1. **Report-only by default.** Findings must not change exit code unless the user
   passes an existing opt-in gate such as `--fail-on-findings`.
2. **Evidence, not verdicts.** Rows must name provenance, source artifact,
   engine/config, raw scores or thresholds where relevant, and caveats.
3. **Target repo stays clean.** `drift:ai` may run from a tools checkout against a
   foreign repo. Do not write cache or artifacts into the target unless the user
   explicitly asks for an output path there.
4. **Adapters delegate verdicts.** When surfacing ecosystem-tool findings, honor
   target config first. If drift:ai supplies an opinion, stamp it as
   `drift-baseline` and keep it opt-in.
5. **Advisory rows stay brand-firewalled.** Hotspots/coldspots/prototype rows
   must not use `WARN`/`FIX` finding language unless promoted into a real check.
6. **Prototype output uses advisory shape first.** Build prototype/heavy rows
   behind task 39's advisory-subcommand contract by default. Do not add a
   `severity`, `lane`, or `experimental` field to `DriftFinding` just to carry
   noisy candidate rows; reserve the main finding stream for promoted checks.
7. **Prototype lane is allowed to be noisy.** It still needs caps, timeouts, and
   provenance so a capped or partial run cannot be mistaken for a complete one.
8. **Core stays portable and `packages/shared`-free.** The `drift:ai` core report
   path (`DriftReport`/`DriftFinding` and the default text/JSON output) currently
   imports nothing from `packages/shared`, which keeps it runnable from a tools
   checkout against any target and keeps a future standalone extraction cheap. The
   `HarnessDiagnostics` projection (task 11) is the only seam allowed to depend on
   the shared schema and Musi `harness.controls.json` control ids, and only on the
   opt-in `HARNESS_DIAGNOSTICS_OUTPUT` sidecar path. The portable foreign-repo
   surface stays `--format json`; the diagnostics sidecar is Musi-harness-facing.
9. **Full-history prototype work must be bounded.** Quick git lenses stay
   windowed. Prototype archaeology that asks old-history questions must share the
   task 38 cap/truncation contract or an equivalent explicit replacement: scanned
   range, caps, stopped reason, and rename/blobless caveats are output evidence.

## Triage decisions

- Keep `similarity-ts` out of this pack as an implementation task. It already
  exists as an optional `near-duplicates` engine.
- Keep Node/npm extraction out of this pack. The tools-checkout workflow is the
  current distribution target; package extraction waits for a real consumer.
- Treat the scheduled lane as dependent on diagnostics/fusion unless the
  maintainer explicitly chooses a direct `drift:ai --scope current` artifact lane.
- Treat `knip duplicates`, `@deprecated` overlay, commented-out code, coverage
  overlays, feature flags, ownership/DOA, test/source orphaning, complexity at
  birth, and commit-message intent as opt-in additions. None belongs in the
  default report without field data.
- Keep the prototype inventory broad when a candidate can be made opt-in,
  capped, and evidence-framed. Dolos, sibling implementation naming, and
  never-instantiated classes are intentionally parked for experimentation even
  though they are too noisy for the default lane.
- Keep clone and dead-code calibration corpora separate. Clone engines use task
  40; dead-code and reachability false-positive traps use task 40b.
- Split parser/evaluator/inventory risk from user-facing advisory rendering when
  a prototype introduces a new evidence source. The current explicit splits are
  coverage artifacts (42a -> 42c -> 42b), env/define branch evaluation
  (43a -> 43), sibling naming (47a -> 47), and class construction evidence
  (48a -> 48).
- Treat portable offline ts-morph unused-exports as intentionally out-of-pack for
  now. It remains valid follow-up work, but only after being split into export
  extraction, imported-symbol reverse index, barrel/re-export transitivity,
  entrypoint/test-only labeling, and knip-calibration leaves.

## Prototype promotion criterion

Prototype-lane lenses (tasks 41-48; task 40 is the clone corpus, task 40b is the
dead-code FP-trap corpus, and task 38 is a history foundation) graduate to a
default or opt-in check only on evidence, the mirror image of the demotion rule in
[`../harness-review-tasks/52-demotion-and-noise-budgets.md`](../harness-review-tasks/52-demotion-and-noise-budgets.md):

- a labeled or field run showing acceptable precision — few enough false positives
  that a reader is not trained to ignore the rows;
- a clear repair path or actionable next step per finding kind;
- bounded, disclosed cost (caps/timeouts that do not blow the run budget).

Until a lens clears that bar it stays opt-in and candidate-framed. Record the
promoting evidence in `finished_work/` or the lens's task note.

## Output guidance

Use existing JSON/text patterns:

- main findings: `DriftReport`, `DriftFinding`, `SkippedDriftCheck`;
- subcommand advisory output: subcommand-specific JSON with `kind: "advisory"`,
  a "not defects" banner, no `findings` key, and no `WARN`/`FIX` text unless it
  is a real findings surface such as `harness-freshness`;
- shared harness aggregation: `HarnessDiagnostics` sidecar output only.

If a task adds a new finding check, update both the lightweight metadata registry
and runtime plugin registry. If it adds a subcommand or diagnostics projection,
keep it outside the check registry unless the output truly follows
`DriftFinding`.

Keep the portable report contract and the Musi diagnostics contract separate:
`drift:ai --format json` remains the foreign-repo JSON surface, while
`HARNESS_DIAGNOSTICS_OUTPUT` is the Musi harness sidecar. Task 53 guards the
portable JSON shape; tasks 10-13 own diagnostics projection and fusion.

Prototype tasks that emit user-facing rows depend on task 39 unless they
explicitly document a better task-specific route. Library/corpus-only split tasks
such as 41a, 41b, 42a, 43a, 47a, and 48a intentionally do not depend on the
advisory output contract until their integration follow-up. Full-history tasks
also depend on task 38 unless they define an equivalent bounded-history
replacement. Candidate labels belong in the
advisory section/row shape with provenance, raw scores, thresholds,
caps/timeouts, and artifact paths; they do not belong in `DriftFinding.details`
as an implicit severity.

## Verification posture

Prefer focused script tests beside `scripts/drift-ai/` or the new script. For
schema changes, run the focused shared schema test. For new check ids, also run a
small smoke command with `--scope current --check <id> --format text` when
feasible. Avoid running slow whole-project knip checks as the only proof; use
fixtures and runner fakes.
