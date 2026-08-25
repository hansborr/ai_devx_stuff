# codex backend notes

Verified against codex-cli 0.142.5.

## Model and effort

- `-m` maps to codex's own model flag; omitting it runs the user-configured default model.
- `-e` maps to `-c model_reasoning_effort=<level>`.
- Model slugs retire server-side without a client error you would recognize: a retired default in `~/.codex/config.toml` (`gpt-5.6-sol`, retired 2026-08) presents as `401 token_expired` on every run — not a login problem, so `codex login` does not fix it. Point the config default (or `-m`) at a live slug; `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.5` were live at the time of writing.
- When codex cannot serve (quota or outage), the GPT fallback is `consult cursor -m gpt-5.6-sol-high` (see [cursor.md](cursor.md)); a quota bounce is account state, not a wrapper error.

## Native review harness (`review codex`)

- Diff modes via passthrough: `-- --commit <SHA>`, `-- --base <branch>`, `-- --uncommitted`. Prefer committed/base diffs.
- An optional wrapper `-p` adds custom review instructions and composes with the mode flags.
- No `-o` support: read the `[P0]`/`[P1]`/`[P2]` findings from the log. For orchestrated reviews prefer `consult codex`, which collects the result in `-o`.
- Review runs are read-only by intent and drift-checked like consults: a review that mutates the worktree exits 4 with a `DIRTY` trailer.

## Sandbox and locking

- codex sandboxing (bwrap/landlock) does not work in this devcontainer (`bwrap: Unexpected capabilities`), so the wrapper always runs `danger-full-access` with `-a never` and rejects passthrough sandbox overrides. Consult and review read-only-ness therefore rests on the injected preamble (or the native review harness) plus the post-run drift check — detection, not prevention.
- Dirty starts are risky for `work codex`: a delegate finishing over a dirty tree tends to absorb stray WIP — even files it did not create — as its own work. This failure mode is why the wrapper rejects dirty `work` starts unless `--dirty-ok` says the diff is the mission.

## Sessions

- `exec` prints its session id in the log header; the wrapper surfaces it as the `agent-run: session-id:` trailer **as soon as that header streams — before it waits on the run** — so a crash before finalization (a container OOM or any SIGKILL, neither of which runs the fatal-signal trap) still leaves a resumable id in the log rather than forcing a cold-discovery recovery run. Resume by explicit id only: codex's own `--last` picks the most recently *active* session, so any interleaved run retargets it — the wrapper does not expose it and rejects passthrough `resume`/`--last`.
- `exec resume` silently ignores stdin (verified on 0.139.0 and 0.142.5); the wrapper therefore rejects oversized `-f` material on resume — have the prompt reference an absolute file path for codex to read instead.
