# `code:intel` CLI

Read-only TypeScript graph queries for `packages/shared`, `packages/server`,
`packages/client`, and `scripts/`. Use it when text search cannot reliably
answer cross-file symbol or import questions.

Do not use it for in-file lookups, free-text searches, or verification gates.

## Commands

```bash
# Definition by exact name or 1-based file position.
bun run code:intel -- def --name characterDetailSchema
bun run code:intel -- def packages/server/src/routers/character.ts:46:11

# File exports.
bun run code:intel -- exports packages/shared/src/schemas/character.ts

# tRPC router procedure overview.
bun run code:intel -- overview packages/server/src/routers/cast-spell.ts

# File-level reverse import graph.
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1 --exclude-tests --limit 20

# Symbol-level usages.
bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14 --limit 20

# Candidate covering tests.
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct --limit 20
```

## Options

- `--project <shared|server|client>` narrows `dependents` and `tests`.
- `--depth N` controls graph walk depth for `dependents` and `tests`.
- `--direct` limits `tests` to co-located and direct-import candidates.
- `--exclude-tests` removes test files from `dependents` output.
- `--limit N` trims `dependents`, `refs`, and `tests` output while preserving
  the total count.
- `--format json` returns stable output for piping.

## Rules Of Thumb

- `def --name` is exact-name search; positional `def` is better at usage sites.
- `refs` answers "where is this symbol used?"
- `dependents` answers "what imports this file?"
- `tests` returns candidates, not proof. Start with `--direct` on hub files.
- Position arguments snap to the nearest identifier when the column lands on
  punctuation or whitespace.

## Daemon

Repeated queries are faster with the opt-in daemon:

```bash
bun run code:intel:server -- status
bun run code:intel:server -- restart
bun run code:intel:server -- stop
```

Normal `code:intel` queries use the daemon when it is already running and fall
back to one-shot execution when it is absent.
