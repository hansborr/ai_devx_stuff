# ai-hooks suite is not safe to run concurrently with itself

Status: Implemented 2026-07-25 on `fix/ai-hooks-repo-root-consistency` (`1fe5b424`)
— owner ruling picked option 2 (private/overridable marker root), scoped as a
`REPO_ROOT` consistency fix rather than the bespoke marker-path env var this
note originally proposed. Merged into the 2026-07-25 wave-1 integration
(`fec03ab7`) and archived as `F7` in
`../finished_work/ready-2026-07-drain.md`; the ready-queue row is closed.
Date: 2026-07-19
Source: parallel-instance determinism runs while draining the
commit-queue-test-load-flake note (landed via fix/commit-queue-test-flake;
note removed 2026-07-19 — git history).
Size: S (document) to M (isolate).

## Evidence

Running three full instances of `bash scripts/ai-hooks/test.sh`
concurrently in the same checkout (2026-07-19): one instance passed,
two failed in the protected-files tests long before the later
commit-queue tests ran —

- `FAIL: expected [reason=protected-files: Protected file: do not
  hand-edit lint-ratchet.baseline.json. …] to contain
  [advisory=protected-files: Repo-wide]`
- `FAIL: expected [] to contain [.allow-protected-edits]`

Mechanism: `policy_only_probe` rm'd, conditionally touched, then rm'd
`$REPO_ROOT/.allow-protected-edits` — a REPO-ROOT path shared by every
instance, unlike the per-suite mktemp `$TMP_ROOT` everything else uses —
and a second block touched/rm'd the same path directly. The
marker-DEPENDENT assertions raced bidirectionally: a peer rm'ing the
marker between the probe's touch and its policy evaluation turned the
expected downgrade-to-advisory back into a block, and the marker-absent
probe raced the other way. The marker-touching-command advisories did
NOT race: `ai_policy_advisory_context` returns the static
`AI_POLICY_ALLOW_PROTECTED_EDITS_ADVISORY` string regardless of marker
state. Each suite instance was internally correct; only cross-instance
interleaving broke. A second, quieter bug: the fixtures deleted a
maintainer's real `.allow-protected-edits` whenever the suite ran.

## What landed

- `scripts/ai-hooks/protected-files.sh` now defaults rather than
  overwrites: `REPO_ROOT="${REPO_ROOT:-$(…)}"`. `REPO_ROOT` was already
  an honored override one layer up in `policy.sh`
  (`ai_policy_resolve_bash_path`); the unconditional assignment was the
  only thing clobbering it for the sourced chain.
- `scripts/ai-hooks/test-protected-files-marker.sh` — the marker-dependent
  coverage, extracted from `test.sh` and re-pointed at a private probe
  root under `$TMP_ROOT`. The deny table matches by suffix glob, so a
  probe-root path still exercises the real policy entries. The aggregate
  runner invokes it as one step.
- Parallel-run regression, in that same file: four concurrent fixtures
  must all pass; a static tripwire rejects any ai-hooks fixture that
  builds the marker path from the checkout root; a watcher fails if the
  repo-wide marker appears at all during the run; and the checkout's own
  marker must be in the same state at the end as at the start.

Production semantics are unchanged, and the note's own objection ("adds
a test-only knob to a production policy surface") is discharged
structurally: every shipped entrypoint — the `.claude`/`.codex`/`.copilot`
adapters and the `bash-{pre,post}-tool-use` aggregates — assigns
`REPO_ROOT` from git unconditionally before the body is sourced or
exec'd, so an inherited value cannot retarget a real hook invocation.
Two assertions in the new suite pin that: the adapters must still deny a
real protected path while a decoy `REPO_ROOT` with an active marker is
exported, and each entrypoint must keep the unconditional
`REPO_ROOT=$(git …)` form. A one-off differential over all wired
entrypoints (deny, advisory, generated, husky, relative-path and
Bash-write cases) was byte-identical against the previous body both with
`REPO_ROOT` unset and with a decoy exported.

## Non-goals (held)

Production protected-files semantics — where the marker lives, what it
allows, its advisory text — are untouched; the override defaults to
today's behavior.
