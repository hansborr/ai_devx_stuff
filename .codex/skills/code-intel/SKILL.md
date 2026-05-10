---
name: code-intel
description: Resolve TypeScript symbols through package exports, re-exports, and the client `@/*` alias via `bun run code:intel`. Use for cross-file definitions, file exports, transitive dependents, symbol-level references, and candidate covering tests across packages/shared, packages/server, packages/client, and scripts/. Triggers include "I only know the symbol name" (`def --name <symbol>`), "resolve the symbol at file:line:col" (`def <file>:<line>:<col>`), "where is X defined", "who imports Y", "where is X used", "what does file F export", and "which tests cover Z". Skip for in-file lookups or free-text searches; use the agent search tool (Claude `Grep` or Codex `Search`), `rg`, or `git grep` there.
---

# code-intel

Read-only TypeScript graph queries that resolve through package exports,
re-exports, and the client `@/*` alias. Use it for cross-file TypeScript symbol
work that text search cannot reliably answer.

This skill is a thin adapter. Canonical content lives in
[`docs/guides/code-intel.md`](../../../docs/guides/code-intel.md). Claude has a
separate adapter at
[`.claude/skills/code-intel/SKILL.md`](../../../.claude/skills/code-intel/SKILL.md);
other harnesses can reach the guide through `AGENTS.md`. Read the guide for
full subcommand reference, flags, and patterns. Quick start below.

Daemon mode is opt-in: `bun run code:intel:server -- restart` starts it, and
normal queries use it only when already running. See the guide for details.

## Quick start

```bash
# Start from an exact symbol name
bun run code:intel -- def --name characterDetailSchema

# Resolve a symbol at file:line:col to its definition (1-based)
bun run code:intel -- def packages/server/src/routers/character.ts:46:11

# List every export from a file
bun run code:intel -- exports packages/shared/src/schemas/character.ts

# Reverse import graph (start narrow, widen if needed)
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1 --exclude-tests --limit 20

# Symbol-level usages (call sites, type uses, imports)
bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14

# Candidate covering tests (co-located + direct importers)
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct --limit 20

# JSON output for piping
bun run code:intel -- exports packages/shared/src/schemas/character.ts --format json
```

## When to reach for this skill

- "Where is X defined?" -> `def`
- "I only know X's name" -> `def --name`
- "What does this file export?" -> `exports`
- "Who imports this file?" -> `dependents`
- "Where is X used?" -> `refs`
- "What tests cover this file?" -> `tests`
- Use `refs` for symbol call sites/usages; use `dependents` for file-level
  importers.

## When NOT to

- In-file lookups: read the file directly.
- Free-text searches ("find every TODO"): use the agent search tool (Claude
  `Grep` or Codex `Search`), `rg`, or `git grep`.
- As a verification gate: it is a guide, not a sensor.

## Gotchas

- `def --name` is exact declaration search. Positional `def` is still better
  when TypeScript alias resolution at a usage site matters.
- `tests` is heuristic; results are candidates, not proof of coverage.
  `--direct` and `--project <shared|server|client>` cut noise on hub files.
- `--limit N` trims noisy `dependents`, `refs`, and `tests` output while
  preserving the total count; `--limit 0` means no limit.
- Scope is `packages/shared`, `packages/server`, `packages/client`, and
  `scripts/`. Other paths error out with a clear message.

See [`docs/guides/code-intel.md`](../../../docs/guides/code-intel.md) for the
full reference.
