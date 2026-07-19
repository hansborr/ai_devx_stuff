# 05 — Verify-Metadata Run-Meta JSON Core: Port the Codec, Keep the Shell

Status: Implemented — S0+S1 landed as `ebe99dd0` on
`feat/verify-metadata-ts-core`; S2 measured and the jq boundary ruled
2026-07-19 (see "S2 record" below). S3 dropped as planned.
Previously: Proposed — cross-reviewed 2026-07-19 (both reviewers
adopt-with-changes and both independently narrowed it; this note is
the narrowed scope, see `00-index.md`)
Date: 2026-07-19
Source: 2026-07-17 harness architecture review, run in the sibling
checkout (candidate 6, "worth exploring"). Re-verified 2026-07-19
against HEAD `7e4bd5df`: the file is 1,323 lines / 70 functions;
several of the original premises were corrected at review — the
dash-compat constraint is dead, the sourcer count was low, and the
trust-path framing overstated — see Problem.
Priority: P3 · Size: M · Risk: medium

## Problem

`scripts/lib/verify-metadata.sh` mixes two kinds of code. Orchestration
(locks, markers, mktemp plumbing, git invocations) belongs in bash per
the substrate ruling. But hand-rolled JSON handling lives beside it:

- `musi_run_meta_json_string_field` (:993) extracts JSON fields with
  `sed -n "s/^.*\"$key\":\"\([^\"]*\)\".*$/\1/p"` — greedy `^.*` binds
  to the *last* occurrence of the key, and any escaped quote inside a
  value silently truncates the match.
- `musi_run_meta_wrapper_fragment` (:987) extracts the wrapper object
  with `\({[^}]*}\)` — it breaks the moment the wrapper JSON gains a
  nested object; `musi_record_precommit_shortcircuit` (:1129) already
  contorts its output flat to keep that extractor working.
- `musi_combine_run_meta`, `musi_restamp_verify_wrapper`, and the
  `musi_write_*_meta` builders assemble JSON by `printf` + a
  hand-written `awk` escaper (`musi_meta_json_escape`, :959).

Corrected blast radius (2026-07-19): `.husky/pre-push`'s
verify-evidence fallback does **not** use the sed extractors — it
reads `wrapper.json` with its own jq helpers (`.husky/pre-push:47-59`)
and fails closed on malformed output. `scripts/verify-logs.sh` also
reads run metadata with jq (:460). The sed extractors' production
readers are `verify-history.sh` (display) and `land.sh`'s restamp via
`musi_restamp_verify_wrapper` (:1268-1278), which **refuses** on a
mis-extracted `mode`/`exit_code` rather than stamping garbage. So the
honest value claim is: delete a latent fail-closed bug class (spurious
refusals, corrupt history/display) and consolidate what are currently
**three parsers of one format** (bash sed/awk, hook jq, and the
fixtures that mimic them) — not close a live fail-open gate hole.

Constraint corrections that shape the design:

- **There is no dash/POSIX-sh sourceability constraint.** The library
  already uses bash process substitution (:407) and every sourcer is
  bash (`test-dependency-freshness.sh` is `#!/usr/bin/env bash`; the
  `sh .husky/pre-commit` probe re-execs bash). The lib's header
  comment claiming a dash-invoked smoke (:7-9) is stale — fix it in
  passing. The real constraint: stay bash-sourceable under
  `set -euo pipefail` with stable function names and out-variables.
- **16 production sourcers, not 15**: 13 scripts plus three hooks —
  `.husky/pre-commit:70`, `.husky/pre-push:18`, and
  `.husky/post-commit:15`. Distinguish sourcers from actual callers of
  the ported functions when assessing each shim.
- The cluster-1 functions are not collectively pure:
  `musi_persist_run_meta_history`, `musi_record_precommit_shortcircuit`,
  and the `musi_write_*` builders read/copy/prune/write files and call
  `date`. Only their parse/validate/serialize/transform halves port;
  path resolution, `date`, mkdir/copy/prune, and atomic marker writes
  stay bash.

## Approach

Governing constraint — the substrate ruling (`docs/ai-harness.md`
§"Substrate Ruling (Bash Vs TS)", signed off `b7c2ce73`): orchestration
stays bash, "anything analytical lives in TS … reachable from bash via
`bun` entrypoints", duplicates across the boundary are defects. Escape
hatch carried over verbatim: if a clean line can't be drawn for a
cluster, drop the cluster rather than bend the ruling.

**Scope: the run-meta JSON codec only.** One entrypoint,
`scripts/lib/verify-metadata-core.ts`, following the existing
`musi_path_policy_query_nul` shim precedent (`bun --config=/dev/null`
+ env-override seam, warm spawn ~10ms measured). Subcommands parse
complete documents from stdin and emit **whole JSON documents on
stdout, or act as exit-code-only verdict commands** — never
`KEY=VALUE` lines fed to `eval` (run-meta values contain arbitrary
command strings; verify.sh's no-eval stance applies). Malformed-input
and CLI-failure behavior is specified per subcommand (fail closed,
distinct exit codes), not left to whatever `JSON.parse` throws.

Ruled out of scope at review (recorded now, no experiment branches):

- **Success-marker / TTL cluster — not ported.**
  `ai_marker_age_within_ttl` has three independent hot-path hook
  callers (`ai-hooks/bash-pre-tool-use.sh:89`,
  `ai-hooks/bun-run-quiet.sh:244`, `ai-hooks/stop-policy.sh:263`);
  spawning bun for two integer comparisons is unjustified, and the
  three-field marker parser (:697) is strict and well covered.
  Revisit only with new evidence of defects there.
- **Fingerprint assembly — stays bash** (one hex-regex and a sha256
  pipe around git plumbing on the hot path).
- **Waiter/ticket accounting (`musi_count_commit_queue_waiters`,
  :300) — ruled non-port now.** The analytical policy is inseparable
  from `kill -0` probes and `rm` pruning at useful granularity; a
  split widens the interface beyond the ~15 lines it isolates. This
  is the escape hatch applied at planning time instead of after a
  throwaway branch.
- **Timing constants stay bash** (hooks read them by sourcing).

The jq boundary needs an explicit ruling, not silence: after S1 the
repo would still hold TS + two jq parsers of the wrapper format.
Either S2 adds one batched `verify-wrapper-check` subcommand and
retires the pre-push/verify-logs jq policy readers, or their jq use is
recorded here as an allowed hook-local exception — decide at S2 with
the latency numbers in hand; leaving it unmentioned violates the
no-duplicates clause.

TDD shape: characterization first, as a **committed static corpus** —
fixtures capturing current bash outputs (including escaped quotes,
missing fields, future timestamps, malformed epochs), with
legacy-parity cases separated from defect-fix expectations. Expected
values are not generated by driving the bash implementation during
normal test runs. Where TS intentionally diverges (correctly parsing
an escaped quote the sed version mangles), the fixture records the
divergence as a fixed defect.

## Slice plan (one commit per slice)

- **S0+S1** — seam, corpus, and codec together (a skeleton with
  failing tests is not a landable slice):
  `scripts/lib/verify-metadata-core.ts` with subcommand dispatch and
  `MUSI_VERIFY_META_BUN`/`MUSI_VERIFY_META_CORE` override seam;
  committed fixture corpus; subcommands for parse/combine/restamp/
  shortcircuit-transform green against it; bash functions flip to thin
  shims with the sed/awk extractors and printf builders deleted in the
  same commit (no cross-boundary duplicates). Consumers keep the same
  function names: `verify-history.sh`, `land.sh`, `verify.sh`,
  parallel-step wiring. Registration in the same slice: a
  `# smoke-subjects:` entry so core-only edits still select the shell
  wiring smoke, and the fixture-copy blast radius — every test that
  copies `verify-metadata.sh` into a sandbox repo
  (`test-dependency-freshness.sh` ×6, `test-land.sh:39`,
  `test-pre-push.sh:49`, `test-verify.sh:64`,
  `ai-hooks/test-lint-coverage.sh:69`,
  `ai-hooks/test-ratchet-regression.sh:45`) must copy the TS
  entrypoint or point the env seam at the source tree, per the
  `MUSI_PATH_POLICY_QUERY` precedent.
- **S2** — latency + jq ruling: measure wall-time deltas on the paths
  that actually spawn the shims — per-step `musi_write_step_meta`
  (`scripts/lib/parallel-step.sh:49`; full verify currently runs 14
  slots), changed/parallel verify, marker-hit pre-commit, pre-push,
  and `land.sh`. Revert threshold: a shim that adds >100ms to an
  otherwise-cached commit reverts. Then take the jq-boundary decision
  above and implement or record it.
- **S3 (was "shrink the shell suite") — dropped.** TS unit tests are
  additive; the shell suite keeps its end-to-end and concurrency
  sections untouched (shim spawn, bun-failure, out-var mapping, and
  land/pre-push integration are exactly what it still covers).

## Execution notes

- Branch `feat/verify-metadata-ts-core` off `main`; fast-commit mode
  appropriate; land via `bash scripts/land.sh`.
- Prior rulings: this is an application of the substrate ruling, not
  an amendment. The agent-run.sh rewrite rejection is unaffected.
- Verification per slice: `bun run test:scripts:file -- <core test>`
  plus `bun run test:scripts`; full `verify` at land.
- Re-verify before implementing: the function inventory above was
  taken 2026-07-19 at 1,323 lines; line numbers drift.

## S2 record — latency numbers and the jq ruling (2026-07-19)

Measured on the lane machine, warm caches, 30 iterations per operation,
shims (`ebe99dd0`) vs the pre-port bash (`HEAD~1`) sourced side by side.
A bare codec spawn (`bun --config=/dev/null verify-metadata-core.ts`)
costs ~21 ms; a single `jq` spawn ~16 ms.

| operation (per call)             | legacy | ported | delta   |
| -------------------------------- | ------ | ------ | ------- |
| `musi_write_step_meta`           | 12 ms  | 22 ms  | +10 ms  |
| `musi_write_wrapper_meta`        | 15 ms  | 23 ms  | +8 ms   |
| `musi_combine_run_meta`          | 4 ms   | 24 ms  | +20 ms  |
| `musi_persist_run_meta_history`  | 18 ms  | 130 ms | +112 ms |
| `musi_record_precommit_shortcircuit` | 23 ms | 28 ms | +5 ms  |
| `musi_restamp_verify_wrapper`    | 28 ms  | 30 ms  | +2 ms   |

Path-level deltas that follow: a changed/parallel verify or full
pre-commit run pays +10 ms per step (parallel, off the critical path
until the last step) plus ~+140 ms of end-of-run bookkeeping
(wrapper+combine+persist, after the verdict) on runs measured in
minutes — <0.3% wall. A marker-hit (or bridged) pre-commit runs only
the short-circuit shim: **+5 ms**, far under the 100 ms revert
threshold, so nothing reverts. `land.sh` restamp +2 ms. Pre-push is
byte-unchanged (its readers were already jq). Persist is the fattest
shim (5 codec spawns); if it ever matters, batch it into a single
`history-name` subcommand — recorded as optional follow-up, not done.

Measured post-review (the original S2 pass skipped the display path):
`verify-history.sh` spawns the codec 6× per row (fragment + 3 string
+ 2 int gets), so a full 20-row listing is **~2.8 s wall** (measured
twice against 20 synthesized history files; legacy sed was
near-instant). It is a manual, occasional display command on no
gate's critical path, and the fix — one batched row/fields subcommand
— does not fit the 300-effective-line codec cap (the file sits at
297). Folded into the same batching follow-up as persist above: if a
batched subcommand is ever added, serve both the display row and the
persist `history-name` from it rather than growing the codec twice.

**jq ruling: recorded as an allowed hook- and CLI-local exception**
(the second of the two S2 options), covering `.husky/pre-push`'s
verify-evidence fallback readers (`musi_pre_push_json_string`/`_int`,
:47-59) and
`scripts/verify-logs.sh`'s display queries. Reasons, with the numbers
in hand:

- Latency is immaterial in both directions: the pre-push fallback is
  5 jq spawns (mode, exit_code, head, fingerprint, end_time) ≈ 80 ms
  once per push (marker-miss path only); a batched
  `verify-wrapper-check` verdict would save ~60 ms there. Nothing
  user-facing rides on that.
- The no-duplicates concern the leaf targeted was hand-rolled parsers
  whose defects diverge. Post-port there is exactly one writer (the
  TS codec), and the only hand-rolled readers left are stop-policy's
  two awk field getters recorded below; jq is a real JSON parser used
  fail-closed, not a defect-class duplicate.
- A `verify-wrapper-check` subcommand cannot retire `verify-logs`' jq
  anyway — that tool does steps-array math and display far beyond a
  wrapper verdict and already hard-requires jq — so option (a) would
  leave jq in-tree while growing the codec past the max-lines cap
  (the file sits at the 300-line ceiling by design: it is a single
  self-contained entrypoint that six sandbox suites copy next to
  `verify-metadata.sh`). Splitting or excepting it for a ~60 ms
  once-per-push win is disproportionate.

Also recorded under the same exception, found during implementation:
`scripts/ai-hooks/stop-policy.sh` keeps two hook-local awk readers
(`ai_stop_verify_meta_string` and `ai_stop_verify_meta_int`). They are
applied both to wrapper fields (`mode`, `head`, `fingerprint`,
`exit_code`) and to per-step metadata (`name`, `exit_code`) when
naming failing gates. The string reader documents inline that it is
only safe for builder-produced fields whose values cannot contain
quote/backslash escapes. Revisit all three exception sites together
only if a defect is ever traced to one of them.
