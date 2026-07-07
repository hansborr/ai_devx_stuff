# 50. agent-run.sh: TERM during backend-pid capture emits a "killed" trailer without signaling the backend

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: agent-cli · Area: skills-agent-cli · Severity: med-high · Size: M · Confidence: high
Theme: orphan-process-safety · Source: harness review 2026-07-06 (Sonnet deep-read + Codex CONFIRMED)

## Problem
`on_fatal_signal` decides whether to propagate TERM/INT/HUP via
`backend_alive()`, which is false whenever `BACKEND_PID` is empty. The
codex path polls a pid file for up to ~2s to capture the pid, and if the
poll times out `BACKEND_PID` stays unset for the run's remainder. A
signal landing in that window (or after a failed capture) emits the same
`agent-run: backend-exit: killed (SIG…)` trailer used for a
successfully-propagated kill, without ever signaling the backend — which
survives as a lock-holding orphan while the waiter believes the run is
cleanly dead. SKILL.md's "Killing a stalled run with TERM is safe" claim
is therefore stronger than what the code guarantees; the existing TERM
regression tests all wait for `backend-pid:` before signaling, so the
window is untested.

## Evidence
- `.claude/skills/agent-cli/scripts/agent-run.sh:955-962`
  (`backend_alive` false on empty pid), `:1016-1056` (`on_fatal_signal`),
  `:1031` (ambiguous trailer), `:1155-1174` (pid-file poll; capture-fail
  fallback tracks only `TEE_PID`).
- Tests: `scripts/tests/test-skill-dispatch-wrappers.sh:1564-1618` — all
  TERM cases post-`backend-pid:`.
- Codex verification: CONFIRMED.

## Proposed direction
(a) Close the window: make the codex launch path write the pid file
synchronously before backgrounding (or capture via `$!` under the
existing setsid shape) so `BACKEND_PID` is set before the traps can see
an empty value. (b) Disambiguate the trailer regardless: distinct texts
for "backend confirmed exited", "no backend dispatched yet", and "pid
capture failed — propagation impossible, backend may be orphaned". Add a
regression test that races TERM into the capture window. Then tighten
SKILL.md:64's claim (propagation guaranteed once `backend-pid:` has
appeared) and the CLAUDE.md dead-run note if wording changes.

## Scope / caveats
Two sibling nits can ride along or be a second commit: `cleanup()`
hardcodes `"$OUT.transcript.md"` instead of `$SIDECAR`, missing a custom
`--share=` path (`agent-run.sh:216-224` vs `:606-626`); and the copilot
`-C` flag parsing is duplicated between `guard_copilot` (`:386-486`) and
the drift scan (`:787-810`) with no sync test.
