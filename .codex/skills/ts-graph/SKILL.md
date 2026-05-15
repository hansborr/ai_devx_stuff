---
name: ts-graph
description: >-
  Use for cross-file TypeScript graph questions: where a symbol is defined,
  what a file exports, who imports a file, where a symbol is referenced, or
  which tests likely cover a file. Runs `bun run code:intel` across
  packages/shared, packages/server, packages/client, and scripts. Do not use
  for in-file lookups, free-text searches, or verification gates.
---

# TS Graph

Use `bun run code:intel -- ...` for read-only TypeScript graph queries that
need symbol/import resolution across `packages/*` and `scripts`.

Use it when you need:

- `def`: find definitions by exact symbol name or file position.
- `refs`: find symbol-level usages from a definition location.
- `dependents`: find reverse file imports.
- `exports`: list a file's exported symbols.
- `tests`: find candidate covering tests.

Do not use it for in-file lookups, free-text search, or verification gates. Use
`rg` first for partial names or unknown text.

Key reminders:

- `def --name` is exact-name search; positional `def` is better at usage sites.
- `tests` returns candidates, not proof.
- Use `--format json` when machine-readable output helps.

Full CLI reference: [`docs/guides/code-intel.md`](../../../docs/guides/code-intel.md).
