@AGENTS.md

# Claude-Specific Notes

Claude Code uses hooks under `.claude/hooks/` and registers them in `.claude/settings.json`.

- `git-commit-quiet.sh` rewrites foreground `git commit` commands to keep pre-commit output bounded, then reports a short commit or failure summary.
- `bun-run-quiet.sh` wraps whitelisted `bun run` verification commands, enforces foreground execution, serializes runs with `flock`, caches unchanged-worktree results, and rewrites successful output to a concise log pointer.
- `no-direct-db.sh` blocks shared command-policy violations through `scripts/ai-hooks/policy.sh`.
- `protected-files.sh`, `prisma-generate.sh`, and `doc-length.sh` are
  Claude-only Edit/Write hook adapters; their shared logic lives under
  `scripts/ai-hooks/`.

Run manual verification commands in the foreground, one at a time. Do not background `bun run lint:changed`, `bun run typecheck`, `bun run test:changed`, or related verification commands; the Claude hook already bounds output and caches unchanged results.

Claude-only plugins and secondary worktrees live under `.claude/`. Treat `.claude/worktrees/` as generated working copies unless a task explicitly targets them.
