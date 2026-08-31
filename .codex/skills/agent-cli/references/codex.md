# codex backend notes

Verified against codex-cli 0.142.5.

## Model and effort

- `-m` maps to codex's own model flag; omitting it runs the user-configured default model.
- `-e` maps to `-c model_reasoning_effort=<level>`.
- Model slugs retire server-side without a client error you would recognize: a retired default in `~/.codex/config.toml` (`gpt-5.6-sol`, retired 2026-08) presents as `401 token_expired` on every run — not a login problem, so `codex login` does not fix it. Point the config default (or `-m`) at a live slug; `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.5` were live at the time of writing.
- When codex cannot serve (quota or outage), the GPT fallback is `consult cursor -m gpt-5.6-sol-high` (see [cursor.md](cursor.md)); a quota bounce is account state, not a wrapper error.

## Native review harness (`review codex`)

- Diff modes via passthrough: `-- --commit <SHA>`, `-- --base <branch>`, `-- --uncommitted`. Prefer committed/base diffs.
- `-p` (custom review instructions) does **not** compose with the diff-mode flags: the native CLI declares the prompt and each of `--base`/`--commit`/`--uncommitted` mutually exclusive (a clap `conflicts_with` in codex itself — `error: the argument '--base <BRANCH>' cannot be used with '[PROMPT]'`, verified on 0.151.0 — not a wrapper restriction). A bare `review codex -p '<instruction>'` with no mode flag is accepted. When you need both a diff mode and a custom instruction — including "do not dispatch other agents/CLIs" — use `consult codex` instead (already the preferred shape for orchestrated reviews).
- Given only a diff-mode flag and no instruction, the native review seat has repeatedly sub-dispatched other agent-cli backends (`consult claude -m fable`, `consult copilot`, `consult cursor`) and quoted the nested result back as its own untagged summary; treat an untagged summary from this seat as a cue to grep its log for a nested `consult` dispatch before trusting it as an independent read, and budget the seat at roughly ten minutes regardless of diff size.
- No `-o` support: read the `[P0]`/`[P1]`/`[P2]` findings from the log. For orchestrated reviews prefer `consult codex`, which collects the result in `-o`.
- Review runs are read-only by intent and drift-checked like consults: a review that mutates the worktree exits 4 with a `DIRTY` trailer.

## Sandbox and locking

- codex sandboxing (bwrap/landlock) does not work in this devcontainer (`bwrap: Unexpected capabilities`), so the wrapper always runs `danger-full-access` with `-a never` and rejects passthrough sandbox overrides. Consult and review read-only-ness therefore rests on the injected preamble (or the native review harness) plus the post-run drift check — detection, not prevention.
- Dirty starts are risky for `work codex`: a delegate finishing over a dirty tree tends to absorb stray WIP — even files it did not create — as its own work. This failure mode is why the wrapper rejects dirty `work` starts unless `--dirty-ok` says the diff is the mission.

## Sessions

- `exec` prints its session id in the log header; the wrapper surfaces it as the `agent-run: session-id:` trailer **as soon as that header streams — before it waits on the run** — so a crash before finalization (a container OOM or any SIGKILL, neither of which runs the fatal-signal trap) still leaves a resumable id in the log rather than forcing a cold-discovery recovery run. Resume by explicit id only: codex's own `--last` picks the most recently *active* session, so any interleaved run retargets it — the wrapper does not expose it and rejects passthrough `resume`/`--last`.
- `exec resume` silently ignores stdin (verified on 0.139.0 and 0.142.5); the wrapper therefore rejects oversized `-f` material on resume — have the prompt reference an absolute file path for codex to read instead.
