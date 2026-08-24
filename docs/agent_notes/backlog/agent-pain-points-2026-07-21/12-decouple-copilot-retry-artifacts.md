# Decouple Copilot Retry Artifacts

Status: Implemented — 2026-07-25
Date: 2026-07-21
Priority: P2
Size: M
Risk: medium

## Problem

The wrapper explicitly permits retrying an empty `-o` left by a failed run,
but Copilot couples that answer path to `<out>.transcript.md` and rejects the
retry whenever the transcript is nonempty. A Copilot run that emits only
pre-tool intent and no final answer therefore leaves the expected empty answer
plus a valuable transcript, yet rerunning the same command with the same `-o`
exits 2 until the caller deletes both artifacts. This makes the advertised
empty-answer retry path false for the Copilot failure that most needs its
transcript retained for diagnosis and session recovery.

Live evidence is split across
`.claude/skills/agent-cli/scripts/agent-run.sh`: `validate_launch_paths` accepts
an empty answer, while `validate_launch_paths_copilot` derives the fixed
sidecar name and rejects any nonempty sidecar. The wrapper tests independently
pin empty `-o` reuse and stale-sidecar rejection, but do not exercise their
composition after an intent-only/no-final failure. The source pain point is
`/home/node/persist/musi/pain_points/agent-cli-and-external-reviews.md`
(2026-07-21, external consult reliability), derived from the Claude memory
`cross-model-boundary-review-dispatch.md`.

## Scope

- Add exclusive per-`OUT` attempt ownership independent of the worktree lock,
  including lock-free `consult` runs. Before launch, atomically claim the answer
  path and inspect its attempt record. A live or concurrently starting owner,
  an incomplete prior record, or an owner whose liveness/finalization cannot be
  proved must fail closed before backend launch.
- Allocate a collision-safe wrapper-owned Copilot transcript path for every
  claimed attempt. Publish an immutable attempt identity and transcript path in
  an early record/trailer before the backend starts, so even a wrapper killed
  before normal trailers leaves an attributable recovery breadcrumb. A new
  attempt must never truncate, append to, or relabel an earlier attempt's
  transcript.
- Finalize each attempt exactly once with its backend disposition and answer
  outcome. The only retryable predecessor is a conclusively finalized
  **no-answer** attempt whose public `OUT` is absent or empty. A successful
  answer, live attempt, cleanup-in-progress attempt, crashed/unfinalized
  attempt, malformed record, or ambiguous ownership remains non-retryable and
  requires explicit recovery rather than heuristic takeover.
- Write the backend's candidate answer to an attempt-private temporary path.
  After parsing and final status are known, publish a successful answer to
  `OUT` atomically without clobbering existing content; finalize no-answer only
  after the empty/absent public-answer state is durably established. Remove
  attempt-private answer temporaries on every settled path while retaining
  diagnostic transcripts and attempt records.
- Preserve the failed transcript and make its session ID discoverable through
  the early and final attempt trailers or a small, explicit bundle/index
  contract. The solution must not trade retry convenience for loss of
  diagnostic or resume evidence, and later finalization must refer to the same
  attempt/transcript identity published before launch.
- Keep caller-owned `--share=<path>` caller-owned and fresh-path-only. Do not
  silently rotate, rename, or overwrite a path the caller selected; its
  existing collision, worktree-boundary, and duplicate-share guards remain. A
  caller-owned share must not be adopted into or rewritten by the
  wrapper-owned transcript-attempt scheme.
- Update the agent-cli lifecycle/reference documentation so callers can locate
  each attempt's transcript and understand which finalized paths are reusable.
- Add focused wrapper regressions for an intent-only/no-final Copilot run
  followed by a same-`-o` retry, preservation of the first transcript/session
  ID, simultaneous same-`-o` launches, live and unfinalized predecessor
  rejection, exact-once finalization, atomic answer publication,
  successful-answer reuse rejection, and unchanged caller-owned `--share`
  freshness.

## Acceptance

- An intent-only/no-final Copilot run exits 1, atomically finalizes its attempt
  as no-answer, and leaves the public answer absent or empty; repeating it with
  the same explicit `-o` claims a new attempt and reaches the backend without
  the caller deleting the failed transcript.
- After that retry, the first attempt's complete transcript and session ID are
  still recoverable, and the second attempt writes to a distinct transcript.
  Each attempt's identity/path is recorded before its backend starts and is
  stable through finalization; neither can be mistaken for the other in
  trailers or documentation.
- Two simultaneous launches with the same `-o` cannot both reach a backend. A
  live, cleanup-in-progress, crashed/unfinalized, or malformed prior attempt
  fails closed and preserves every artifact unchanged.
- Reusing an `-o` that contains a successful answer still exits 2 before
  launch and leaves the answer and every associated transcript unchanged.
- An existing caller-supplied `--share=<path>` exits 2 whether the file is
  empty or nonempty. A fresh, nonempty path value replaces the wrapper-owned
  transcript, is canonicalized and exclusively locked for the run, and remains
  caller-owned afterward.
- Leading-dash paths, auto-generated answers, signal/failure cleanup, and
  per-attempt session-ID extraction remain covered. Tests also pin atomic
  answer publication, exact-once finalization, and rejection of concurrent and
  unfinalized predecessors.

## Boundaries

This leaf does not address Copilot or Cursor provider capacity, rate limits,
model quality, or backoff scheduling. It also does not reopen the
intro-only-success bug: commit `fd51b55a` already changed Copilot answer parsing
to require a root final assistant response. The task is only to make the
resulting explicit, finalized no-final failure safely retryable without
destroying its artifacts. It does not make arbitrary empty files or abandoned
attempts retryable. Caller-owned `--share` artifacts are never rotated,
adopted, or removed after backend use; the shipped hardening does require a
fresh absent path, canonicalize it once, and hold its path lock through
finalization.

## Verification

- `bun run test:scripts:file -- scripts/tests/test-skill-dispatch-wrappers.sh`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
