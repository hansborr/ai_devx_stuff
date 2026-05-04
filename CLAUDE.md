@AGENTS.md

# Claude-Specific Notes

Claude Code uses hooks under `.claude/hooks/` and registers them in `.claude/settings.json`.

- `git-commit-quiet.sh` rewrites foreground `git commit` commands to keep pre-commit output bounded, then reports a short commit or failure summary.
- `bun-run-quiet.sh` wraps whitelisted `bun run` verification commands, enforces foreground execution, serializes runs with a short `flock` wait, caches unchanged-worktree results, and rewrites successful output to a concise log pointer. Its internal timeout is deliberately below the interactive cache budget; use `verify:async*` for longer confidence checks.
- `no-direct-db.sh` blocks shared command-policy violations through `scripts/ai-hooks/policy.sh`.
- `protected-files.sh`, `prisma-generate.sh`, and `doc-length.sh` are
  Claude-only Edit/Write hook adapters; their shared logic lives under
  `scripts/ai-hooks/`.
- `stop-reminder.sh` is a cheap, read-only Stop hook. It reminds about
  uncommitted changes, cached failing e2e results, and running/failing async
  verification state, but it does not start e2e or verification.

Run manual verification commands in the foreground, one at a time. Do not background `bun run lint:changed`, `bun run typecheck`, `bun run test:changed`, or related verification commands; the Claude hook already bounds output and caches unchanged results.

Use `bun run verify:async`, `bun run verify:async:changed`, or
`bun run verify:async:slow` when a check is expected to exceed the interactive
budget. Inspect with `verify:async:status` / `verify:async:tail` and stop with
`verify:async:stop`.

Claude-only plugins and secondary worktrees live under `.claude/`. Treat `.claude/worktrees/` as generated working copies unless a task explicitly targets them.
