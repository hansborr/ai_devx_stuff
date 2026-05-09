---
name: code-intel
description: Look up Musi TypeScript symbol definitions, file exports, transitive dependents, and candidate covering tests with `bun run code:intel`. Use when the user asks where a symbol is defined, who imports a file, what a file exports, which tests likely cover a file, or when cross-file package-export/client-alias import graph lookup would be more accurate than text search. Skip for in-file lookups and free-text searches.
---

# Code Intel

Use `bun run code:intel -- ...` for read-only TypeScript graph queries across
`packages/shared`, `packages/server`, `packages/client`, and `scripts/`.

Canonical command details live in
[`docs/guides/code-intel.md`](../../../docs/guides/code-intel.md). Read that
guide when you need flags, caveats, or common workflows.

## Quick Start

```bash
bun run code:intel -- def --name characterDetailSchema
bun run code:intel -- def packages/server/src/test/enum-sync.test.ts:83:14
bun run code:intel -- exports packages/shared/src/schemas/character.ts
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1 --exclude-tests --limit 20
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct --limit 20
bun run code:intel -- exports packages/shared/src/schemas/character.ts --format json
```

## Use

- Use `def --name <symbol>` when you only have an exact symbol name.
- Use `def <file>:<line>:<col>` when you have a symbol position.
- Use `exports <file>` to inspect a file's public surface.
- Use `dependents <file>` for reverse import graph questions. Add
  `--depth <N>`, `--project <shared|server|client>`, `--exclude-tests`, and
  `--limit <N>` to narrow output.
- Use `tests <file> [--direct] [--depth <N>] [--project <shared|server|client>]`
  `[--limit <N>]` to find candidate covering tests.

Treat `tests` output as candidate coverage, not proof. For free-text searches,
use `rg`, `rg --files`, or `git grep` instead.
