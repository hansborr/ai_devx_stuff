# Code Intel

`bun run code:intel -- ...` is a read-only TypeScript graph CLI that resolves
through package `exports`, re-exports, and the client `@/*` alias. Use it for
cross-file TypeScript symbol work that `rg` / `grep` cannot answer reliably.
Output is deterministic and pipeable.

This guide is harness-neutral. Codex reaches it through the repo-owned skill
source at `.codex/skills/code-intel/SKILL.md` when that folder is installed or
linked into `${CODEX_HOME:-$HOME/.codex}/skills/code-intel`. Claude reaches it
through `.claude/skills/code-intel/SKILL.md`. Other agents reach it through
`AGENTS.md`. Keep the canonical examples here.

## When to use

- "Where is symbol X defined?" → `def`
- "I only know symbol X's name" → `def --name`
- "What does file F export?" → `exports`
- "Which files import F (transitively)?" → `dependents`
- "Where is symbol X used?" → `refs`
- "Which tests likely cover F?" → `tests`
- Use `refs` for symbol call sites/usages; use `dependents` for file-level
  importers.

## When NOT to use

- Free-text searches ("find every TODO", "find all callers of `console.log`").
  Use the agent search tool when available (for example, Claude `Grep` or
  Codex `Search`); otherwise use `rg` / `git grep`.
- Lookups inside a single file. Read the file directly.
- As a verification gate. It is a guide, not a sensor.

## Subcommands

### `def <file>:<line>:<col>`

Resolve the identifier at a 1-based `line:col` to its definition. Works at
either a usage site or the definition itself. If the column lands on nearby
punctuation or whitespace, `def` snaps to the nearest identifier on that line.

```bash
bun run code:intel -- def packages/server/src/test/enum-sync.test.ts:83:14
# → packages/shared/src/schemas/character.ts:52:14 value export
```

If you only know the symbol name, use exact name lookup:

```bash
bun run code:intel -- def --name characterDetailSchema
```

Name lookup searches exported declarations first, then top-level local
declarations across `packages/*/src` and `scripts/`. Use positional `def` when
you need alias-aware TypeScript resolution at a specific usage site. If exact
name lookup finds no results, it prints capped prefix matches such as
`useCharacter*`; JSON output includes `nearMatches` and `nearMatchTotal`.

### `exports <file>`

List every export from a file with its kind (`type` / `value`).

```bash
bun run code:intel -- exports packages/shared/src/schemas/character.ts
# → 51 results, alphabetised, type vs. value labelled
```

### `dependents <file> [--depth <N>] [--project <shared|server|client>] [--exclude-tests] [--limit <N>]`

Reverse import graph. `--depth` defaults to a small bounded walk; raise it for
deep schema files. Each row reports `direct`, `re-export`, or `dynamic`, and
the text header shows the active depth. When an unfiltered result spans
multiple projects, the text header adds a compact package summary.

```bash
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1
bun run code:intel -- dependents packages/server/src/services/level-up/level-up.ts --depth 2
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 2 --project server --exclude-tests
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 2 --limit 20
```

Tip: start at `--depth 1` to see immediate consumers. Increase only if you
need the wider blast radius. Add `--project` or `--exclude-tests` for noisy hub
files. Add `--limit N` to trim long output while keeping the full result count
in the header; `--limit 0` means no limit.

### `refs <file>:<line>:<col> [--limit <N>]`

Symbol-level reverse search. Resolves the identifier at a 1-based `line:col`
and lists every reference to that symbol across packages and `scripts/`. Snaps
to the nearest identifier on the line if the column is on punctuation. Each
row is `<file>:<line>:<col> <import|value|type>` — `import` for import or
re-export specifiers, `type` for type-position uses (including `typeof X`),
`value` otherwise. The declaration itself is excluded from default output.

```bash
bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14
bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14 --format json
bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14 --limit 20
```

Use `refs` when you need symbol-level usages (call sites, property reads,
type-only references). Use `dependents` for file-level reverse imports.

### `tests <file> [--depth <N>] [--direct] [--project <shared|server|client>] [--limit <N>]`

Candidate covering tests, found by walking the runtime import graph. Not an
exact coverage oracle: a test that imports the file is a candidate, not a
proof of coverage.

```bash
# Co-located + tests that import the file directly:
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct

# Wider transitive search, scoped to the server package:
bun run code:intel -- tests packages/shared/src/schemas/character.ts --depth 2 --project server
```

Default behavior tends to over-report on hub files (a shared schema with 80+
dependents will surface every transitive test). Reach for `--direct` first,
add `--project` to narrow by package, then raise `--depth` if needed. Non
co-located rows are labelled as candidates because runtime imports are only a
coverage hint, not proof.

## Flags

- `--format text` (default) — human-readable, count header, alphabetised.
- `--format json` — `{ header, count, results[] }`. Use when piping into
  another tool or when you want stable parsing. Commands with extra context,
  such as `dependents`, include a `meta` object. `dependents` JSON also
  includes `byProject`, counted after filters and before any limit.
- `--limit N` — available on `dependents`, `refs`, and `tests`; trims displayed
  rows while preserving the total count. With JSON output, limited responses
  include `total`, `limit`, and `truncated`. Use `--limit 0` or omit the flag
  for the full list.

## Scope

`code:intel` reads files under `packages/shared`, `packages/server`,
`packages/client`, and `scripts/`. Other paths return a clear error.

## Daemon Mode

Use the daemon when you are doing repeated lookups in one checkout. It keeps
the import graph and TypeScript project state resident, so warm `def`,
`exports`, `dependents`, `refs`, and `tests` queries avoid rebuilding that
state every invocation.

```bash
bun run code:intel:server -- status
bun run code:intel:server -- restart
bun run code:intel:server -- stop
```

Normal `bun run code:intel -- ...` calls do not auto-start the daemon. They
use it when it is already running and fall back to one-shot execution when it
is absent, stale, or on an incompatible protocol version. To force one-shot
execution, stop the daemon first:

```bash
bun run code:intel:server -- stop
bun run code:intel -- def --name characterDetailSchema
```

The Unix-socket JSON protocol is internal to the repo; use the CLI commands
above instead of scripting against the socket. For advisory latency checks,
run:

```bash
bun run code:intel:perf
```

`code:intel:perf` runs a small fixed query mix cold and warm, prints p50/p95
timings, and does not enforce thresholds or run in `verify`.

## Common patterns

```bash
# Trace a schema change end-to-end
bun run code:intel -- def --name characterDetailSchema
bun run code:intel -- exports packages/shared/src/schemas/character.ts
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1
bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14
bun run code:intel -- tests packages/shared/src/schemas/character.ts --direct

# Find the right test file before editing a service
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct

# Resolve a re-exported symbol back to its source
bun run code:intel -- def packages/client/src/components/sheet/level-up-state.ts:12:10
```

## Caveats

- `tests` is heuristic; treat results as candidates.
- `def --name` is exact-name declaration search, not full symbol reference
  analysis. Zero-result name lookups include prefix hints only. Use positional
  `def` when TypeScript alias resolution matters.
- Large `dependents` queries can take a few seconds in one-shot mode. Start
  the daemon for repeated lookups so cache hits are shared across invocations.

## Related

- `docs/ai-harness.md` lists `code:intel` alongside other guides and sensors.
- `.codex/skills/code-intel/SKILL.md` is the Codex skill adapter.
- `.claude/skills/code-intel/SKILL.md` is the Claude skill adapter.
- `docs/agent_notes/backlog/code-intel-followups.md` tracks parked
  enhancements (JSON consumers, etc.).
