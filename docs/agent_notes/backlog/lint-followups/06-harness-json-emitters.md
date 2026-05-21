# Leaf 6: Harness JSON Emitters

Status: Resolved (2026-05-19) — PR 3b emitters + `lint:agent:changed` wrapper
landed on `feature/lint-hardening-review-followup` via final merge commit
`b0876f0c`; `9431308f` is the ancestor/prep-branch merge that gathered PR 3b +
`lint:agent:changed` before the final merge-back.
Source: `docs/agent_notes/in_progress/lint-hardening-review-followup-pr-3-machine-readable-diagnostics.md`

## Resolution

PR 3b emitters (`doctor.sh`, `verify-logs.sh`, `migration-safety-scan.sh`,
`generate-module-index.sh`) plus the stretch `lint:agent:changed` wrapper
were merged in from `feature/lint-harness-pr-3b-with-fixes` (final merge
commit `b0876f0c`, containing prep-branch merge `9431308f`) after a
two-reviewer pre-merge audit (codex exec + general-purpose subagent). Five
must-fix items landed as separate commits on the prep branch before merge-back:

- `3ac072ac` — doctor `--json` emits a blocking finding when `harness:check`
  fails (previously: silent envelope with failing exit code).
- `32db425b` — `lint:agent:changed` validates args fully before forking
  empty-vs-non-empty paths; `--output` value checks now match
  `lint-agent.ts`'s rejections.
- `c6a6682d` — `test-lint-agent-changed` lists `package.json` as a subject;
  `test-test-scripts.sh` expects the smoke on `package.json` changes.
- `2910d51f` — `test-generate-module-index.sh` covers the `--json` envelope
  for fresh, out-of-date, and shape paths.
- `fcad6c68` — `migration-safety-scan --json` emits warn-severity findings
  for missing explicit targets and the missing default migrations directory
  (previously only stderr WARN).

Post-fix codex review of the five fix commits found no regressions.


## Problem

PR 3a landed the shared `harness-diagnostics` envelope and `lint:agent`.
Other harness surfaces still require prose parsing.

## Scope

Add opt-in `--json` modes to:

- `doctor`
- `verify:logs`
- `module:index:check`
- `migration-safety-scan`

Default human-readable output must remain unchanged.

Likely files:

- `scripts/doctor.sh`
- `scripts/verify-logs.sh`
- `scripts/generate-module-index.sh`
- `scripts/migration-safety-scan.sh`
- new or updated smoke tests under `scripts/test-*.sh`

## Candidate Work

- Reuse the existing `packages/shared/src/schemas/harness-diagnostics.ts`
  envelope.
- Emit one finding per actionable diagnostic with a manifest control id.
- Preserve source severity where possible.
- Add fixture/smoke coverage for success and failure JSON output.
- Decide whether to add the originally suggested `lint:agent:changed` variant
  or explicitly leave it out of this PR 3b slice.

## Exit Criteria

- Each target command supports `--json` and emits schema-valid JSON to stdout.
- Default output and exit semantics are unchanged.
- Every emitted finding resolves to `harness.controls.json`.

## Verification

- `bun run lint:agent`
- `bun run lint:agent --json | jq .summary`
- `bun run doctor --json | jq '.findings | length'`
- `bun run verify:logs --json`
- `bun run module:index:check --json`
- `bun run migration-safety-scan --json`
- `bash scripts/test-lint-agent.sh`
- new focused JSON smoke tests
- `bun run test:scripts:changed`
- `bun run verify:changed`

## Progress (branch `feature/lint-hardening-leaf-06-json-emitters`)

Speculative branch off `feature/lint-hardening-review-followup`. Each
commit gets paired with a codex review and an independent
general-purpose subagent review before the next commit starts.

Landed so far:

- `d84e2be4` — shared `harness-diagnostics` envelope emitter
  (`scripts/harness-emit-envelope.ts`).
- `module:index:check --json` — emitted via the shared envelope.
- `d61f5fe9` + `fcb4aa44` + `8d06cb06` — `migration-safety-scan --json`.
  Three commits because the contract surfaced subtle bash + delimiter
  hazards under review:
  - jq-based finding construction (no TSV bridge).
  - Empty-scan branch emits an empty envelope (so consumers don't see
    bare `INFO:` text on a clean repo).
  - `--` end-of-options parser.
  - Brace-group + pipe → mktemp NDJSON refactor (mid-loop `exit` now
    actually terminates the script).
  - Tab/newline in path rejected up front (TSV would corrupt fields).
  - `dirname --` / `basename --` for leading-dash sandbox paths.
  - `SCRIPT_DIR`-resolved emitter path so the script works from any cwd.
  - jq preflight + numeric-only lineno regex guard before `--argjson`.
- `8cc540ea` — `verify:logs --json`. Same contract pattern:
  - `<task>-failure` (warn) per non-zero bun-logs LAST_EXIT.
  - `wrapper-marker-corrupt-<name>` (warn) per corrupt wrapper marker.
  - `<task>-state-unknown` (info) per log with no derivable state.
  - OK / OK* / no-log → no finding (clean = empty `findings`).

Remaining:

- (none — `lint:agent:changed` is now landed; see the section below.)

`doctor --json` (aggregator) landed as `bbf55e5c` on the speculative
branch `feature/lint-hardening-leaf-06-doctor-json`. Reads each per-sensor
output, emits one finding per WARN/BLOCK/FAIL line, and special-cases
`migration-safety-scan --json` by merging its findings into doctor's
envelope (preserves path/line precision). General-purpose subagent review
verdict: SAFE TO MERGE with five P2 items, four of which were addressed
in follow-up commit on the same branch.

### Review follow-ups acted on (in this branch, not the parent leaf)

The general-purpose subagent dual-review pass on `bbf55e5c` flagged five
P2 items. Four are resolved on this branch; the fifth is deferred with a
named follow-up plan.

Fixed:

- **Migration-safety block findings now route to FAIL_COUNT.** Under
  `bbf55e5c`, `run_migration_safety` added `blocks + warns + infos` to
  `WARN_COUNT`, so a `block`-severity destructive migration would not
  flip doctor's exit code. The follow-up routes blocks → FAIL_COUNT,
  warns → WARN_COUNT, infos → nothing (matches default-mode behavior;
  `run_subcommand` never tallied `INFO:` lines either).
- **`emit_finding` jq failures emit a stderr breadcrumb.** Previously a
  jq malformation would silently drop a finding; the schema-validating
  emitter only sees what was successfully appended. The follow-up
  captures `jq` exit code and prints
  `doctor: emit_finding jq failed (rc=N) for control=… severity=…
  messageId=…` to stderr.
- **`emit_findings_from_capture` messageId scheme is documented.** The
  inline comment explains the per-section local counter vs the global
  `$WARN_COUNT`/`$FAIL_COUNT` counter used by `note_warn`/`note_fail`,
  and why both are safe (slug uniqueness + severity in key).
- **Empty-findings envelope contract is now tested.** Doctor never emits
  an empty envelope in the working dev env, but a clean-state consumer
  will. The smoke pipes an empty NDJSON through
  `harness-emit-envelope.ts --tool doctor` and asserts
  `findings == []`, `summary.{blocking,warning,info} == 0`,
  `summary.byControl: object`. Smoke now has 14 assertions.

Resolved during final merge prep:

- **`doctor --json` now represents `harness:check` failure.** The final branch
  emits a block-severity doctor finding when `bun run harness:check` fails
  during `doctor --json`; `scripts/test-doctor-json.sh` covers the path. No
  separate `doctor-check/harness-manifest-parity` manifest row was needed
  because the finding reports the existing doctor aggregation boundary.

Deferred (not blocking merge — recorded so a future agent doesn't reopen these
blindly):

- **Fixture-based coverage gaps remain.** The final smoke covers the
  `harness:check` failure envelope path, but still does not exercise:
  (a) a block-severity migration finding flowing through
  `run_migration_safety`, or (b) the `emit_finding` jq-failure breadcrumb.
  (a) requires a staged destructive migration without an allowlist entry; (b)
  requires a way to coerce jq into failing inside the emitter. Neither is
  trivial; defer until a separate fixture harness exists.

### Codex `review --commit bbf55e5c` finding (separate from the subagent pass)

The codex review of `bbf55e5c` produced one P2:

- **[P2] `doctor --json` is not dependency-free.** When the very state
  doctor diagnoses is "you need to run `bun install`", the script can
  detect the missing `node_modules` via `check_dependency_freshness` but
  cannot emit the JSON envelope at the end — `harness-emit-envelope.ts`
  itself imports `zod` from `node_modules`, so the final `bun run`
  invocation fails and the consumer sees stderr instead of the
  promised machine-readable envelope. Codex's suggestion was a
  dependency-free/fallback emission path.

  **Decision: defer, document.** Writing a pure-bash + jq envelope
  emitter doubles the surface we have to maintain in lockstep with the
  Zod schema, and the use cases for `--json` (AI agent harness, CI
  glue, dev container) all run inside an environment where
  `bun install` has already executed. The realistic mitigation is a
  README/help-text note: `doctor --json` requires `bun install` to
  have run at least once. If a consumer needs to detect the
  pre-install state from machine-readable output, they should rely on
  the doctor exit code and the stderr breadcrumb. Filed here so a
  future agent can revisit if the use case shifts.

### Latent block-routing inconsistency in `run_subcommand` (not fixed)

This branch fixed block-routing inside `run_migration_safety` (block →
FAIL_COUNT) but `run_subcommand` (which all the other sub-checks use)
still rolls `BLOCK:` lines into `WARN_COUNT` rather than `FAIL_COUNT`.
Today the bug is masked because every BLOCK-emitting sensor also exits
non-zero, and the `rc != 0 && fa == 0 → note_fail` rescue path then
increments `FAIL_COUNT` via the synthetic-fail message. If a future
sensor emits `BLOCK:` while exiting 0 (a "report-only block"), the
exit code will not flip and the divergence between
`run_migration_safety` (block → FAIL) and `run_subcommand`
(block → WARN + rc-rescue) will become visible.

A unified fix is small (split `wa` into `wa`/`ba` in `run_subcommand`,
route `ba` to `FAIL_COUNT`) but changes the default-mode summary line
for any check that has BLOCK lines and a non-zero exit — those would
move from `WARN=N` to `FAIL=N`. Out of scope for this PR; tracked here
so a future leaf can pair the cleanup with deliberate review of the
default-mode summary changes.

## Follow-ups identified during review (deferred — not blocking merge)

The dual-review pass on `8d06cb06` (general-purpose review verdict: SAFE
TO MERGE) flagged three P2 items that I am intentionally NOT fixing in
this PR. Reasons recorded so a future agent doesn't reopen them blindly:

- **`SCRIPT_DIR` does not resolve symlinks.** `BASH_SOURCE[0]` + `dirname`
  + `cd && pwd` returns the symlink directory. If the scanner is invoked
  through a symlink outside `scripts/` (e.g. installed under
  `/usr/local/bin/`), the `$SCRIPT_DIR/harness-emit-envelope.ts` lookup
  fails. We do not install these scripts that way and tests do not
  exercise symlinks; a `readlink -f` upgrade is a defensible follow-up
  but would muddy the diff that already covers four review findings.
- **`EXIT` trap is rebound three times in the script.** The current
  sequence is correct (each later trap includes all earlier tempfile
  vars), but a future edit could leak a tempfile if it adds an
  early-exit between rebindings. A single cleanup function that
  `rm -f`'s all known tempfile vars would be cleaner; not a bug today.
- **`lineno` regex guard lives only in the `--json` branch.** The
  upstream awk producer uses `%d` so non-numeric lineno is currently
  impossible. Promoting the regex check into `scan_file` (or the sort
  step) would mean both human-readable and JSON modes share one defence
  if a future producer regresses. Defensive only; current code is
  correct.

If any of these become real (symlinked invocation, multiple cleanup
paths, a future awk replacement that doesn't use `%d`), reopen this leaf
and address all three together.

The dual-review pass on `8cc540ea` (general-purpose review verdict: SAFE
TO MERGE) flagged two more P2 items in `verify-logs.sh --json`:

- **`RETURN` trap vs `EXIT` trap precedent divergence.** The migration
  scanner uses script-scoped `EXIT` traps because it has multiple
  tempfiles in different scopes; `verify-logs.sh` uses a function-scoped
  `RETURN` trap on `emit_summary_json` because the tempfile lives inside
  one function. Both are correct under bash semantics — the divergence
  is deliberate. A short comment naming the precedent would help a
  future reader who wonders why the two scripts diverge; not adding it
  here because the existing comment already says "Writing to a temp
  file keeps each jq invocation in the parent shell where its exit
  code matters" which implies function scope.
- **No `set -o pipefail`.** Script is `set -u` only. Today the emitter
  is invoked via `<` redirection (not a pipe) so pipefail wouldn't
  apply anyway. Brittle to a future refactor that pipes the emitter
  through `tee` for debugging. Worth flagging in a comment if/when
  doctor --json ends up doing exactly that.

### `lint:agent:changed` (stretch item — landed on this branch)

The PR 3a stretch suggestion was to add a changed-file scoped variant of
`lint:agent` analogous to `lint:changed`. The reason it stayed deferred
through 3b: `lint:changed` and `lint:agent` diverge in two ways the
naive `--changed` shim doesn't reconcile.

1. `lint:changed` gates on unstaged work (refuses to run with a dirty
   tree by default) because a human is expected to either stash or
   commit. `lint:agent` is the opposite — the agent is producing the
   diff and needs feedback *while* the tree is dirty. So
   `lint:agent:changed` must NOT inherit `lint:changed`'s dirty-tree
   guard.
2. `lint:agent` emits a machine-readable envelope. When no lintable
   files changed, returning exit 0 with no JSON breaks consumers that
   `jq` the stdout. The empty case must route through the same
   `harness-emit-envelope.ts --tool lint:agent` path used by the doctor
   aggregator, so the consumer always sees a schema-valid envelope.

Design:

- `scripts/lint-agent-changed.sh` is a thin bash wrapper. It does file
  selection only and then `exec`s `bun lint-agent.ts ...`; no changes to
  `lint-agent.ts` itself. File selection follows the same rule as
  `lint-changed.sh` (committed `base..HEAD` + staged + unstaged,
  deduplicated, filtered to lintable extensions that exist on disk),
  except it does not refuse to run on a dirty tree.
- If a lint-affecting config file appears in the diff (eslint.config.*,
  tsconfig*.json, package.json, bun.lock, eslint-rules/*,
  packages/*/{package,tsconfig*}.json), the wrapper escalates to a
  full-repo lint:agent run. Narrow paths cannot detect regressions
  caused by config drift.
- If zero lintable files changed, the wrapper emits an empty envelope
  via `harness-emit-envelope.ts --tool lint:agent </dev/null` rather
  than exiting silently.
- A `--print-files` debug flag prints the selection outcome
  (`FULL_SCAN` / `EMPTY` / one path per line) without invoking
  lint-agent.ts, so the smoke can verify selection on synthetic git
  repos without standing up an ESLint fixture.

Smoke coverage in `scripts/test-lint-agent-changed.sh` (11 assertions):
no-change → EMPTY; unstaged .ts → selected; staged + unstaged dedup
with non-lintable filtered out; deleted file → EMPTY; each FULL_SCAN
trigger (eslint.config.*, package.json, tsconfig*.json, eslint-rules/*);
committed `base..HEAD` diff is selected on a branch; missing base ref
escalates to FULL_SCAN.

Manifest parity: `lint:agent:changed` is registered in
`scripts/harness-check.ts` EXEMPT_SCRIPTS (alongside `lint:changed` and
`lint:fix`) because the per-rule manifest entries already enumerate the
gate — the `:changed` variant is a file-selection wrapper around the
same control surface. `scripts/test-scripts.sh` declares the new smoke
with subjects `{lint-agent-changed.sh, lint-agent.ts,
harness-emit-envelope.ts, test-lint-agent-changed.sh}`, and
`scripts/test-test-scripts.sh` asserts both the new positive case
(wrapper change → only its smoke) and that a `lint-agent.ts` change
selects both `test-lint-agent` and `test-lint-agent-changed`.

### Review follow-ups for `bb0b6ba6` (`lint:agent:changed` wrapper)

Dual-review pass (codex `review --commit bb0b6ba6` + general-purpose
subagent) both verdicted SAFE TO MERGE with overlapping P1/P2 findings.
All resolved in the follow-up commit on this branch.

Fixed:

- **Untracked files were silently dropped from the changed set** (codex
  P2 / subagent P1). The wrapper used only `git diff` variants, but
  `git diff` doesn't report untracked files — and the agent workflow
  routinely creates new lintable files without staging them yet.
  Follow-up adds `git ls-files -z --others --exclude-standard` to the
  selection feed so a brand-new `.ts` shows up alongside the diffed
  set.
- **Missing-base-ref fallback leaked the bad ref to `lint-agent.ts`**
  (codex + subagent P2). `shift` ran only after the resolve branch, so
  when neither `$BASE` nor `origin/$BASE` existed, the fallback
  `exec bun lint-agent.ts "$@"` still carried the bogus base name in
  `$@`. ESLint then treated it as an unmatched pattern (via
  `--no-error-on-unmatched-pattern`) instead of doing a full scan.
  Follow-up moves `shift || true` ahead of the resolve block so the
  positional is consumed in every code path.
- **Empty-envelope path now forwards `--output`** (codex P3). The empty
  case execed `harness-emit-envelope.ts --tool lint:agent </dev/null`
  with no other args, so a machine-readable consumer who passed
  `--output env.json` got the envelope on stdout instead of in the
  file. Follow-up parses `--output <path>` and `--output=path` out of
  `$@` (both forms) and forwards them to the emitter only on the empty
  path. Other forwarded args are intentionally dropped because they
  would be unknown positional patterns to the emitter.
- **FULL_SCAN smoke coverage was incomplete** (subagent P2). The
  commit's smoke covered four of seven FULL_SCAN trigger globs
  (`eslint.config.*`, `package.json`, `tsconfig*.json`, `eslint-rules/*`)
  but not `bun.lock`, `packages/*/package.json`, or
  `packages/*/tsconfig*.json`. Follow-up adds one assertion per
  missing trigger (cases 8b, 8c, 8d). Two additional cases (11, 12)
  cover the new untracked-files path, and cases 13–15 exercise the
  real (non-`--print-files`) empty-envelope mode end-to-end through
  `bun harness-emit-envelope.ts`, including both `--output` forms.
- **Pre-existing subject-table gap for `harness-emit-envelope.ts`**
  (subagent P2). `verify-logs.sh`, `migration-safety-scan.sh`, and
  `generate-module-index.sh` all shell out to
  `scripts/harness-emit-envelope.ts`, but their smokes did not list
  the emitter as a subject. The new commit's test assertion at
  `test-test-scripts.sh:313` reflected current behavior and would
  have cemented the gap. Follow-up adds
  `scripts/harness-emit-envelope.ts` and
  `packages/shared/src/schemas/harness-diagnostics.ts` to the
  `test-verify-logs`, `test-migration-safety-scan`, and
  `test-generate-module-index` subject lists (also adds harness-
  diagnostics to `test-lint-agent-changed` because the empty-envelope
  path validates through the schema). Test-test-scripts expectations
  updated so a `harness-emit-envelope.ts` change selects all five
  envelope-emitting smokes, and a harness-diagnostics schema change
  selects all seven envelope-emitting smokes.

Deferred (low-priority defensive items recorded for a future leaf):

- **`scripts/lint-rule-docs.ts` is not a FULL_SCAN trigger** (subagent
  P3). The lint-agent.ts pipeline imports `loadLintRuleDocs`, which
  shapes every finding's `why`/`howToFix`/`repairKind`. A change to
  the loader that affects metadata interpretation but doesn't touch
  any other lintable file would surface as a partial-scope envelope.
  Today the file itself is `.ts` and would be included in `FILES`
  whenever changed, but no full re-validation runs. Not in this
  leaf's scope; flag for a future leaf if a metadata-only regression
  is observed.
- **Smoke `--print-files` cases suppress stderr** (subagent P3). The
  `2>/dev/null` redirect in `run_print` would swallow real bash
  errors in `--print-files` mode. Today there are none and the
  expected/got diff already prints the actual stdout on failure;
  rerouting stderr to a per-case log is cleanup, not correctness.
- **`shift || true` on a guaranteed-shiftable arg list** (subagent
  P3). Cosmetic; `set -u` doesn't make `shift` of empty `$@` fail in
  bash 4+.
- **Smoke doesn't exercise non-empty `bun lint-agent.ts` arg-passthrough**
  (subagent P3). Cases 13–15 cover the empty path end-to-end through
  `bun`, which closes most of the plumbing gap; the non-empty path
  is exercised by `scripts/test-lint-agent.sh` against pre-staged
  fixtures, just not through the wrapper. A full end-to-end fixture
  through the wrapper would require standing up an ESLint
  configuration inside the smoke's temp repo (currently sidestepped
  via `--print-files`). Tracked here so a future leaf can decide
  whether the additional fixture cost is worth the coverage.

### Review follow-ups for `e9fd4902` (second pass)

Dual-review pass on `e9fd4902` (the first batch of fixes for
`bb0b6ba6`) verdicted SAFE TO MERGE with two NEW P2s that the first
fix-up introduced or surfaced.

Fixed in the third pass:

- **Leading flag was eaten as the base ref** (codex P2 introduced by
  `e9fd4902`). My pre-emptive `shift` in `e9fd4902` consumed `$1`
  unconditionally — but `bun run lint:agent:changed --output env.json`
  has `$1 == "--output"`, which got swallowed as the base ref. The
  resolve then failed (`--output` is not a ref) and the missing-base
  fallback ran `bun lint-agent.ts env.json`, treating `env.json` as
  an ESLint pattern. Original `bb0b6ba6` accidentally got this right
  (shift was AFTER resolve), but couldn't shift cleanly on the
  missing-base path. Fix: only consume `$1` as the base when it's
  non-empty AND doesn't start with `--`. Both the leading-flag case
  and the missing-base-ref-with-trailing-flags case now work.
- **`--output=path` failed for non-empty changed sets** (codex P2).
  `lint-agent.ts` only accepted the space form (`--output <path>`);
  the wrapper extracted both forms for the empty-envelope path but
  forwarded `$@` unchanged on the non-empty path. Result: `bun run
  lint:agent:changed --output=env.json` worked when no files changed
  and crashed with `Unknown argument: --output=env.json` when any did.
  Fix: add `--output=path` parsing to `lint-agent.ts` so both forms
  are accepted consistently. `harness-emit-envelope.ts` already
  supported both; now lint-agent.ts matches.
- **Stderr suppression in case14/15 made wrapper crashes opaque**
  (subagent P2). The end-to-end empty-envelope tests used
  `>/dev/null 2>&1` and only checked file existence; a `set -u`
  violation or missing `bun` would fail with "expected out.json" and
  no actionable trace. Fix: capture stderr and print it on assertion
  failure.

New regression coverage (test-lint-agent-changed.sh case 16,
test-lint-agent.sh "Run 1b"):

- Case 16: `bash lint-agent-changed.sh --output env.json` against a
  repo with no changes must default base to `main` and write
  `env.json` (not crash, not pass `--output` as a base ref).
- test-lint-agent.sh "Run 1b": `bun lint-agent.ts --output=env.json
  empty-src/` must produce the same envelope as `--output env.json`.

Deferred (codex didn't flag; subagent rated P3, all adversarial-input):

- `--output --output foo` (multiple `--output` flags): both forms now
  apply last-wins independently across the case-form and while-loop
  passes. Mixed adversarial input produces a defensible result but
  isn't documented.
- `--output=` with empty path: case-glob `--output=*` matches, the
  value is forwarded to the emitter, which would fail on an empty
  resolve. `lint-agent.ts` now rejects empty paths explicitly with
  a clear error, so the equals-form-empty case is handled there;
  harness-emit-envelope's empty case would still produce an opaque
  fs error but is unreachable from the wrapper in normal usage.
- Bare `--output` at end of `$@`: silently dropped (no value to
  consume). Defensible but undocumented.
- bash 3.2 portability for `"${OUTPUT_FLAGS[@]}"` with empty array
  under `set -u`: not in this project's environment.
- Untracked-file selection in repos without proper `.gitignore`:
  theoretical for this repo (node_modules/, dist/, etc. are all
  ignored).

### Review follow-ups for `b3d636fe` (third pass — polish)

Dual-review pass on `b3d636fe` (codex `review --commit` + general-purpose
subagent) both verdicted SAFE TO MERGE. Codex found no regressions.
Subagent flagged one P2 polish item that this branch resolves:

- **Asymmetric `--`-prefix rejection between `--output <path>` and
  `--output=path`** (subagent P2). The space-form branch in
  `scripts/lint-agent.ts:78` rejects `--output --foo` up front because
  the next arg starts with `--`; the equals-form branch silently
  accepted `--output=--foo` and would have written to a file literally
  named `--foo`. Fix: mirror the `--`-prefix guard into the equals
  branch so both forms emit `--output= requires a path argument, got:
  --foo` rather than producing a surprising file. Smoke coverage in
  `scripts/test-lint-agent.sh` "Run 1c" asserts both rejection paths.
  This closes the only remaining P2 from the third pass; the asymmetry
  was the lone defensible-but-undocumented behaviour after the first
  two fix passes.

### codex `review` output divergence (not a code finding)

`codex review --commit <SHA>` for `8d06cb06` produced no diagnostic
output. Instead it noticed the uncommitted `06-harness-json-emitters.md`
in my worktree and committed it as `fb7babd9`. The codex skill claims
`review` is read-only with `[P0]/[P1]/[P2]` findings; the observed
behaviour is a stray write. For this leaf I am relying on the
general-purpose subagent reviews (both verdicted SAFE TO MERGE) and
noting the codex behaviour here so a future agent doesn't assume codex
review was silent because the diff was clean.

### Post-merge cleanups (2026-05-19)

A further reviewer pass on the merged work flagged four findings (two
P2, two P3) that this branch addressed as four discrete commits, each
delegated to a separate `codex exec` run per the
`feedback-codex-prompt-size` rule. A post-fix
`codex review --base 5650a548` came back with "No actionable correctness
issues were found in the reviewed diff." All four added smoke coverage:

- `f0bef95e fix(harness): preflight merge-base in lint:agent:changed`
  (P2). `$BASE...HEAD` requires a common ancestor; orphan or
  partial-clone histories made `git diff` fatal inside `<(...)`, where
  `set -e` is swallowed. Added a `git merge-base` preflight that routes
  the no-history case through the same full-scan fallback the missing-
  ref branch already used. Smoke: REPO22/REPO23 in
  `scripts/test-lint-agent-changed.sh`.
- `2f3068ab fix(harness): map doctor BLOCK to severity warn` (P2). The
  bash counter at `scripts/doctor.sh:200` treats `BLOCK:` as a warning
  and exit only gates on `FAIL_COUNT`, but JSON emitted
  `severity:"block"` for BLOCK lines. CI gates keyed off exit code
  would have let `severity:"block"` slip through. Aligned the JSON
  label with the bash semantics: `BLOCK:` → severity:"warn"; `FAIL:`
  remains the only severity:"block" source. Smoke covers BLOCK-only
  doctor exits 0 with one warn-severity finding.
- `8391976a fix(harness): chdir to repo root in lint:agent:changed`
  (P3). Git emits repo-root-relative paths, so `[ -f "$f" ]` could drop
  changed files when invoked from a subdirectory. Captured caller cwd
  before `cd "$(git rev-parse --show-toplevel)"`, and resolve relative
  `--output` values against the caller cwd so existing CLI usage
  keeps writing outputs next to where the operator ran the command.
  Smoke: REPO24/REPO25 in `scripts/test-lint-agent-changed.sh`.
- `517879e7 fix(harness): reject bare --output in harness-emit-envelope`
  (P3). Shared emitter silently fell back to stdout when `--output`
  was bare/empty/flag-shaped. With several emitters now depending on
  it, a typo would silently lose intended output. Rejected all five
  shapes with `UsageError` and added a dedicated
  `scripts/test-harness-emit-envelope.sh` smoke. Wired the new smoke
  into the `--changed` discovery map in `scripts/test-scripts.sh` so
  emitter or schema edits select it.
