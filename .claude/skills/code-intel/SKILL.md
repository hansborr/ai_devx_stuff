---
name: code-intel
description: Look up TypeScript symbol definitions, file exports, transitive dependents, and candidate covering tests via `bun run code:intel`. Use for cross-file lookups across packages/shared, packages/server, packages/client, and scripts/ — it follows package exports and the client `@/*` alias that text search misses. Triggers include "where is X defined", "who imports Y", "what does file F export", "which tests cover Z". Skip for in-file lookups or free-text searches; use Grep / rg there.
allowed-tools: Bash(bun run code:intel:*)
---

# code-intel

Read-only TypeScript graph queries. Faster and more accurate than `rg` for
cross-file lookups because it walks resolved imports, package `exports`, and
the client `@/*` alias.

This skill is a thin adapter. Canonical content lives in
[`docs/guides/code-intel.md`](../../../docs/guides/code-intel.md). Codex has a
separate adapter at
[`.codex/skills/code-intel/SKILL.md`](../../../.codex/skills/code-intel/SKILL.md);
other harnesses can reach the guide through `AGENTS.md`. Read the guide for
full subcommand reference, flags, and patterns. Quick start below.

## Quick start

```bash
# Start from an exact symbol name
bun run code:intel -- def --name characterDetailSchema

# Resolve a symbol at file:line:col to its definition (1-based)
bun run code:intel -- def packages/server/src/routers/character.ts:42:18

# List every export from a file
bun run code:intel -- exports packages/shared/src/schemas/character.ts

# Reverse import graph (start narrow, widen if needed)
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1 --exclude-tests --limit 20

# Candidate covering tests (co-located + direct importers)
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct --limit 20

# JSON output for piping
bun run code:intel -- exports packages/shared/src/schemas/character.ts --format json
```

## When to reach for this skill

- "Where is X defined?" → `def`
- "I only know X's name" → `def --name`
- "What does this file export?" → `exports`
- "Who imports this file?" → `dependents`
- "What tests cover this file?" → `tests`

## When NOT to

- In-file lookups — read the file directly.
- Free-text searches ("find every TODO") — use `Grep` / `rg`.
- As a verification gate — it is a guide, not a sensor.

## Gotchas

- `def --name` is exact declaration search. Positional `def` is still better
  when TypeScript alias resolution at a usage site matters.
- `tests` is heuristic — results are candidates, not proof of coverage.
  `--direct` and `--project <shared|server|client>` cut noise on hub files.
- `--limit N` trims noisy `dependents` and `tests` output while preserving the
  total count; `--limit 0` means no limit.
- Scope is `packages/shared`, `packages/server`, `packages/client`, and
  `scripts/`. Other paths error out with a clear message.

See [`docs/guides/code-intel.md`](../../../docs/guides/code-intel.md) for the
full reference.
