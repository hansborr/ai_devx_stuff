# Green-output backpressure audit — 2026-07 inventory

Source leaf: `../backlog/harness-review-tasks/54-green-output-backpressure-carveout.md`
(Track G). Audited 2026-07-19 on `auto/ready-b-hooks`. Policy now stated in
`docs/ai-harness.md` (Green-Output Policy). No output behavior changed in this
pass; the classification and the deferred removals are recorded here.

Channel legend: **agent** = reaches the model (additionalContext, block
reason, or the `ai_claude_result_command` command rewrite); **stdout** =
command output of gates the agent runs directly (also agent-visible);
**stderr/log** = transcript or log file only.

## Classification

### (a) Required command output — keep

| Line | Source | Channel | Pinned by |
| --- | --- | --- | --- |
| `<script> OK (Ns) - full log: <log>` | `bash-post-tool-use.sh:141`, `bun-run-quiet.sh:360` | agent | `test-cache.sh` (`test:shared OK`) |
| `Commit succeeded: <hash> <subject> \| <diffstat>` | `commit-output.sh:45` (via block reason and command rewrite) | agent | `test.sh` (`Commit succeeded`) |
| `<label>: OK (Ns) — <passed slots>` | `lib/verify-engine.sh:143` | stdout | `test-test-scripts.sh` banner shape |
| `verify:logs` legend + per-task status rows | `verify-logs.sh:307-361` | stdout | verify-log smokes |
| `Generated AI hook wiring OK.` | `check-wiring.sh:233` | stdout | not string-pinned (generator check; low risk) |

These are the summaries that replace deliberately suppressed verbose output,
or the load-bearing rows of a diagnostics command. Removing any of them would
recreate the "did it run?" ambiguity the quiet wrappers exist to prevent.

### (b) Useful backpressure — keep, stays pinned

| Line | Source | Prevents | Pinned by |
| --- | --- | --- | --- |
| `<script> cached OK (…s ago, unchanged worktree) - … FORCE_VERIFY=1 …` | `bun-run-quiet.sh:246` | redundant re-runs | `test-cache.sh` (`cached OK`) |
| `already verified …s ago … skipping (set FORCE_VERIFY=1 …)` | `verify.sh:196` | redundant verify | `test-dependency-freshness.sh:1049` |
| `(fast-commit: test+scripts slots skipped; land via bash scripts/land.sh)` | `commit-output.sh:25` | assuming a full gate ran | `test.sh` (`fast-commit:`) |
| `async verify: running (PID …)` (green case is silent) | `session-state.sh:146` | double-launching verify | `test-session-state.sh` |
| `- fast-commit: active` (only when session state is interesting) | `session-state.sh:47` | same as suffix | `test-session-state.sh` |
| forwarded `post-commit:` truth-up lines | `git-commit-quiet.sh:261` | losing baseline advisories | commit-quiet tests |
| `tidy-edited-file: <path> skipped (<reason>)` | `tidy-edited-file.sh:306` | retrying a deliberate skip | `test-tidy.sh` |
| `tidy-edited-file: <path> tidied` (only when the hook changed the file) | `tidy-edited-file.sh:250` | editing from a stale in-memory copy after the hook reformatted the file | `test-tidy.sh` |
| `nothing to verify` + staging guidance | `verify.sh:130-132` | re-running a no-op | repair actions pinned; literal prose intentionally not treated as contract |

### (c) Chatter — removable, deferred to a behavior leaf

1. `<label>: running <slot>...` per-slot progress lines (`verify.sh:256`,
   stdout). No decision value on green; on red the failing slot is named by
   the failure output anyway. Removal touches verify UX and several test
   expectations, so it needs its own small leaf, not an audit side-effect.
2. `prisma-generate: OK after schema edit (log: …)` (`prisma-generate.sh:94`,
   stderr only). Never reaches the agent; harmless but valueless — trivial
   one-line removal whenever the file is next touched.
3. `tidy-edited-file: skipped because SKIP_TIDY_HOOK=1`
   (`tidy-edited-file.sh:278`, agent). Marginal: the agent set the flag
   itself. Borderline (b); leave unless advisory budget gets tight.

### Silent-on-green (already carved — nothing to do)

`backlog-note-lint.sh`, `doc-length.sh`, `lint-coverage-check.sh`,
`protected-files.sh`, `ratchet-regression-check.sh`, `bash-pre-tool-use.sh`,
`no-direct-db.sh`, `stop-policy.sh` (passed case), both stop reminders — all
end green paths in `ai_emit_continue` with no message. verify.sh emits no
per-slot success lines (only the final aggregate banner).

## Outcome and follow-ups

The carve-out already exists in practice; this pass named it as policy in
`docs/ai-harness.md` and pinned the inventory. Worth filing:

1. Adversarial review rejected the broad verify heartbeat design. Keep useful
   serial current-slot progress; optionally suppress only the rapid parallel
   launch burst. See the decision record in
   [`../backlog/ai-harness-audit-2026-07-21/20-verify-output-signal.md`](../backlog/ai-harness-audit-2026-07-21/20-verify-output-signal.md).
2. Adversarial review rejected a custom Codex post-edit aggregator but retained
   the underlying noise as an active P3/S configuration cleanup: make status
   strings optional/truthful in generated wiring and delete the stderr-only
   Prisma OK line in the same leaf. See
   [`../backlog/ai-harness-audit-2026-07-21/14-codex-edit-status-aggregation.md`](../backlog/ai-harness-audit-2026-07-21/14-codex-edit-status-aggregation.md).
