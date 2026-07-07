# 11. Close the residual pid-capture gap

Status: Implemented 2026-07-07
Size: S-M · Depends on: 10 (contract tests in place first)
Source: consolidation item 3 (unchanged scope)

## Problem

Mostly shipped already: backends launch via `setsid` where available
(`agent-run.sh:945`), a TERM inside the codex pid-capture window recovers the
pipeline-recorded pid (`:973`), and that race is test-covered
(`test-skill-dispatch-wrappers.sh:1697`). The residual is the genuine
capture-failure path — `backend-pid: unknown` (`agent-run.sh:1238`) means TERM
cannot reach the backend and it may orphan holding the worktree lock.

## Scope

Make that state impossible by construction or give it a tested recovery path;
do **not** re-litigate the setsid design. If a recovery path is the answer,
its trailer wording is part of the leaf-10 contract artifact — update both
together.

## Done criteria

- `backend-pid: unknown` is either unreachable by construction or has a
  test-covered recovery path that releases (or documents how to release) the
  worktree lock.
- Trailer contract artifact updated if any trailer wording changes.

## Verification

- Focused kill-window tests in `test-skill-dispatch-wrappers.sh` green,
  including the existing TERM-in-capture-window and SIGKILL-orphan cases.
