# codex backend notes

Verified against codex-cli 0.142.5.

## Model and effort

- `-m` maps to codex's own model flag; omitting it runs the user-configured default model.
- `-e` maps to `-c model_reasoning_effort=<level>`.

## Native review harness (`review codex`)

- Diff modes via passthrough: `-- --commit <SHA>`, `-- --base <branch>`, `-- --uncommitted`. Prefer committed/base diffs.
- An optional wrapper `-p` adds custom review instructions and composes with the mode flags.
- No `-o` support: read the `[P0]`/`[P1]`/`[P2]` findings from the log. For orchestrated reviews prefer `consult codex`, which collects the result in `-o`.
- Review runs are read-only by intent and drift-checked like consults: a review that mutates the worktree exits 4 with a `DIRTY` trailer.

## Sandbox and locking

- codex sandboxing (bwrap/landlock) does not work in this devcontainer (`bwrap: Unexpected capabilities`), so the wrapper always runs `danger-full-access` with `-a never` and rejects passthrough sandbox overrides. This is why every codex run — consults included — holds the worktree lock, and why consult read-only-ness rests on the injected preamble plus the post-run drift check.
- Dirty starts are risky for `work codex`: a Stop hook nudges Codex about a dirty finish, and it tends to react by committing stray WIP — even files it did not create — as its own work. This failure mode is why the wrapper rejects dirty `work` starts unless `--dirty-ok` says the diff is the mission.

## Sessions

- `exec` prints its session id in the log header; the wrapper surfaces it as the `agent-run: session-id:` trailer. Resume by explicit id only: codex's own `--last` picks the most recently *active* session, so any interleaved run retargets it — the wrapper does not expose it and rejects passthrough `resume`/`--last`.
- `exec resume` silently ignores stdin (verified on 0.139.0 and 0.142.5); the wrapper therefore rejects oversized `-f` material on resume — have the prompt reference an absolute file path for codex to read instead.
