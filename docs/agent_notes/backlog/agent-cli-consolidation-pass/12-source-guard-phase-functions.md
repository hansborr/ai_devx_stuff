# 12. Source-guard `main()` split + per-phase test suites

Status: Implemented 2026-07-07
Size: M · Depends on: 10 (invariant tests are the refactor safety net)
Source: consolidation items 1 + 4, merged — the tests are meaningless without
the seams, and the seams unverifiable without the tests

## Problem

Lifecycle phases are not independently testable, and the single-file wrapper
must survive the fix: single-file is a deliberate portability feature, not a
smell — the skill travels by file copy, and a sourced-lib split invites silent
partial copies.

## Scope

- Keep `agent-run.sh` one file; move the run flow into `main()` behind a
  source guard (`[[ "${BASH_SOURCE[0]}" == "$0" ]] && main "$@"`), so tests
  can `source` the script and unit-test phase functions directly: arg/usage
  validation, per-backend command assembly, lock acquire/release, signal
  handling + finalization, trailer emission, consult drift-check. The section
  seams already exist at `agent-run.sh:226/546/590/830/926` (re-verify against
  HEAD — leaf 11 may have moved them).
- Fall back to a lib split only if that proves insufficient; then pin libs
  inside `.claude/skills/agent-cli/scripts/lib/`, resolve via
  `BASH_SOURCE[0]`, and add a manifest check so a partial copy fails loudly
  instead of half-working.
- Grow `test-skill-dispatch-wrappers.sh` along the same seams: sourced unit
  suites for the phase functions plus the existing end-to-end smokes. Keep the
  covered kill-window edges (TERM in the codex pid-capture window,
  SIGKILL orphan + inherited-lock-fd, stubborn-child escalation) and the
  `.claude` → `.codex` mirror invariant checks.

## Self-edit gotcha (closed by this leaf)

Bash reads a running script from disk by byte offset, so a `work` run whose
mission edits the wrapper itself misreads its own tail and dies with a
spurious exit 127 (never a real wrapper code — those are 0/1/2/3/4) even when
the delegated work committed fine. With everything inside functions, only the
final `main "$@"` line is read late; the copy-self-to-tmp `exec` pattern
eliminates the window entirely if the residue ever bites.

## Done criteria

- Wrapper behavior unchanged (leaf 10's invariant tests prove it); still one
  file, still ShellCheck-clean in the existing lint lane.
- Each phase function has a focused sourced unit suite.
- Self-edit window closed or documented as negligible.

## Verification

- `bash scripts/tests/test-skill-dispatch-wrappers.sh` green end to end.
