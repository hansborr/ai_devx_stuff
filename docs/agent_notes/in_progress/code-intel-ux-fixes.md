# `code:intel` UX Fixes

Status: Slices A-D landed (CLI polish, filtered dependents, --limit, name-based
def, near-match hints, project summaries, full extraction into linted
`scripts/code-intel/` modules). `scripts/code-intel.ts` is now a 17-line facade
of re-exports plus the executable guard. Slice F (daemon mode) is decomposed
into six leaves below; Slice E (`refs`) is promoted but queued behind Slice F.
No leaf is ready to start without explicit promotion.

`scripts/code-intel/**/*.ts` is included in `tsconfig.scripts.json`, linted
through a narrow ESLint parser override, and selected by `test:scripts:changed`
via the `test-code-intel` smoke. Future code-intel work must preserve the
`./code-intel.js` test-facing import surface unless deliberately migrated.

## Slice E: `refs <file>:<line>:<col>` symbol-level reverse search

Status: promoted, queued behind Slice F. Daemon-resident language-service state
makes a workspace-wide reference project significantly cheaper, so building
`refs` after Slice F is preferred unless priorities flip.

Problem: `dependents` is file-level reverse imports. It cannot answer "who
calls this hook?" or "who reads this schema property?" without falling back to
text search.

CLI shape:

```bash
bun run code:intel -- refs packages/shared/src/schemas/character.ts:82:14
bun run code:intel -- refs packages/shared/src/schemas/character.ts:82:14 --format json
```

Output: `references <symbol> (<N> results)` with rows
`<file>:<line>:<col> <import|value|type>`. JSON rows use a new `reference`
result kind with `{ name, file, line, col, referenceKind }`.

Implementation notes:

- Add `refs` to `HelpTopic`, parsing, usage, formatting, docs, and skills.
- Reuse `parseLocation`, `identifierAtPosition`, and snap-to-nearest behavior
  from positional `def`.
- Use symbol identity (`findReferences`), not text matching.
- Treat ambient declarations and namespace re-exports as edge cases — classify
  before committing fixture expectations.
- Do not implement with `createProjectForFile` alone — a per-package project
  misses cross-package references. Build a workspace-wide reference project
  (or reuse the daemon's resident state once Slice F lands).
- Exclude the queried declaration from default output. Add
  `--include-definitions` only if a real workflow needs it.
- Sort deterministically by file, line, column.

Acceptance:

- Resolves through `@musi/shared/*`, client `@/*`, re-exports, and
  `import { X as Y }` renames.
- Fixture coverage for renamed imports and at least one cross-package shared
  symbol referenced from server or client code.
- Returns `import`, `value`, and `type` reference kinds; honors `--format json`.

## Slice F: Daemon mode for repeated lookup latency

Problem: repeated `code:intel` lookups pay the one-shot Bun, ts-morph, source
discovery, and import-graph costs every time. The daemon work preserves
`bun run code:intel -- ...` as the public command but moves repeated work into
a repo-owned process — TypeScript language-service state for symbol queries and
Musi-owned graph state for `dependents`/`tests`. Direction is Option 2 from
`../backlog/code-intel-daemon-options.md`.

### Pre-implementation decisions

- **Transport**: Unix socket under `/tmp/musi-code-intel/<repo-key>/`. Tradeoff:
  no port allocation; native Windows/named-pipe support deferred.
- **Protocol**: tiny versioned JSON envelope `{ protocolVersion, id, command }`,
  one request per connection. Tradeoff: simpler than JSON-RPC; less standard
  for future generic adapters.
- **Daemon identity**: one daemon per `realpath(repoRoot)`, hashed for
  `<repo-key>`. Secondary worktree isolation is automatic; cross-worktree cache
  sharing is intentionally deferred.
- **Lifecycle**: ship explicit `code:intel:server status|stop|restart` before
  auto-start. Initial CLI behavior: route to running daemon if present, fall
  back to one-shot otherwise. Auto-start gated on Slice F leaf 6.
- **Cache invalidation**: request-time manifest (mtimes + `tsconfig*.json` +
  `package.json` + `bun.lock` + branch + head), not file watchers. Tradeoff:
  small per-request stat cost; deterministic and avoids watcher failure modes.
- **Bypass knob**: drop `CODE_INTEL_ONESHOT=1` from the plan. Add a
  discoverable `--no-daemon` flag only if auto-start later creates real need.
- **Process shape**: one daemon per repo owning shared/server/client/scripts
  language-service state plus one Musi import graph. Tradeoff: larger resident
  memory for coherent cross-package queries.

### Plan

1. **Structured one-shot query executor** — Split runner into parse → execute
   structured command → format. Keep `runCodeIntel()` and the test-facing
   exports stable, output byte-for-byte unchanged. Files: `runner.ts`,
   `types.ts`, new `query-executor.ts`, `format.ts`, `code-intel.ts`,
   `code-intel.test.ts`. **Risk: low, reversible.** Acceptance: targeted tests
   pass; representative `def`/`exports`/`dependents`/`tests`/`--format json`
   outputs unchanged; fixture tests can call the structured executor without
   process argv.

2. **Thin CLI front door + protocol types** — Make `scripts/code-intel.ts`
   lightweight on the daemon-capable path; dynamic-import the one-shot runner
   only on fallback. Add typed daemon request/response envelope; do not start
   a daemon. Files: `code-intel.ts`, `cli-args.ts`, `cli-help.ts`, new
   `cli-main.ts`, new `daemon-protocol.ts`, `code-intel.test.ts`. **Risk:
   low/medium.** Acceptance: CLI behavior unchanged; help and parse errors work
   without importing the runner; thin-client import time near the measured
   parser/formatter baseline (~14ms p95) instead of the runner-import baseline
   (~205ms p95).

3. **Repo-scoped daemon lifecycle** — Add
   `code:intel:server -- status|stop|restart` plus state-dir, pid, socket, and
   metadata under `/tmp/musi-code-intel/<repo-key>/`. Does not yet route
   normal queries. Files: `package.json`, new `server-cli.ts`,
   `daemon-state.ts`, `daemon-process.ts`, `daemon-server.ts`,
   `code-intel.test.ts`, `test-code-intel.sh`. **Risk: medium, design-locking
   (socket location, metadata, lifecycle become user-visible).** Acceptance:
   `status` distinguishes absent/running/stale; `restart` starts; `stop`
   removes live or stale state; different repo roots produce different state
   dirs.

4. **Graph-query daemon path (`dependents`/`tests`)** — Route graph commands
   to a running daemon with one-shot fallback. Daemon owns resolver, source
   discovery, cached graph, request-time invalidation. Symbol commands stay
   one-shot. Files: new `daemon-client.ts`, `daemon-server.ts`, new
   `graph-cache.ts`, `runner.ts`, `source-project.ts`, `import-graph.ts`,
   `graph-queries.ts`, `code-intel.test.ts`, `test-code-intel.sh`. **Risk:
   medium — first real protocol + invalidation, but reversible via fallback.**
   Acceptance: daemon-backed and one-shot text/JSON match; warm graph queries
   hit the perf target; first query after source/config/git-state change
   rebuilds; daemon absence or protocol mismatch falls back.

5. **Language-service daemon path (`def`/`exports`)** — Add resident
   TypeScript language-service state for shared/server/client/scripts. Route
   `def`, `def --name`, `exports` through the daemon while preserving
   resolver, identifier snapping, near-match hints, source-vs-dist mapping,
   and JSON output. Files: new `language-service-cache.ts` (or
   `project-cache.ts`), `definition-query.ts`, `export-query.ts`,
   `source-project.ts`, `daemon-server.ts`, `daemon-client.ts`,
   `code-intel.test.ts`. **Risk: high, design-locking — commits to the
   daemon's TS project model; most regression surface lives here.**
   Acceptance: daemon and one-shot symbol outputs match for all `def` modes
   and `exports`; package exports, `@/*`, re-exports, renamed imports, and
   source-vs-dist mapping pass fixture coverage; first query after change is
   correct; warm symbol queries hit the perf target.

6. **Default UX, docs, perf guard** — Decide whether normal `code:intel`
   auto-starts the daemon. Update user docs and agent skills. Add a small
   timing command (advisory, not a verification gate) for future regressions.
   Files: `cli-main.ts`, `daemon-client.ts`, `test-code-intel.sh`,
   `docs/guides/code-intel.md`, both `code-intel/SKILL.md`, this note. **Risk:
   medium — auto-start is a user-facing decision.** Acceptance: documented
   flow matches implementation; one-shot fallback still tested;
   `code:intel:server` documented; timing guard reports cold/warm p50/p95
   without failing unrelated verification.

### Performance target

Measured 2026-05-09 on `feat/harness-improvements-v4` with Bun 1.3.12. Cold
measurements are 20 serial fresh invocations:

| Query | p50 | p95 |
|---|---:|---:|
| `def --name characterDetailSchema` | 3127ms | 3201ms |
| `dependents .../character.ts --depth 2` | 3782ms | 3884ms |
| `tests .../level-up.ts --direct` | 3865ms | 4074ms |

Startup decomposition:

| Path | p50 | p95 |
|---|---:|---:|
| `bun -e ''` | 2ms | 2ms |
| current `--help` (full runner import) | 198-201ms | 205-206ms |
| thin-client imports (`cli-args` + `format` + `errors`) | 12ms | 14ms |

In-process cached query work:

| Cached work | p50 | p95 |
|---|---:|---:|
| `queryDefinitionsByName` | 33.3ms | 49.0ms |
| `queryDependents` | 2.0ms | 2.2ms |
| `queryTests` | 0.05ms | 0.07ms |

**Verdict on the original `<100ms` target**: achievable, but only with the
thin-client path. With the current import shape, `--help` alone is 205ms p95
— so leaf 2 is gating, not optional. Without leaf 2 the daemon cannot meet
the target no matter how fast it answers.

**Revised target**: with daemon running and no invalidation pending, public
warm queries `p50 ≤ 75ms`, `p95 ≤ 100ms`. First-query-after-invalidation may
miss latency but must be correct. Daemon-internal budgets: `≤ 60ms` p95 for
symbol queries, `≤ 10ms` p95 for graph queries, leaving room for IPC + JSON +
formatting.

### Out of scope (Slice F)

- MCP, LSP, raw `tsserver` adapters. See
  `../backlog/code-intel-daemon-options.md` Options 3-5.
- Slice E `refs` (separate slice; daemon makes it cheaper).
- File-watch invalidation (start with manifest; add only if stat overhead
  becomes measurable).
- Windows named-pipe support.
- `CODE_INTEL_ONESHOT=1` as a planned acceptance item.

## Out of scope for this pass

- AGENTS.md already links `docs/guides/code-intel.md` from Gotchas. No change.
- Cycle/debug output and definition-ambiguity formatting remain conditional
  per `../backlog/code-intel-followups.md`.

## Verification ritual (per leaf)

- `bun run verify:changed`
- Targeted `bun run test -- --project=scripts scripts/code-intel.test.ts`
  before the changed verification.
- `bun run test:scripts:changed` (or `scripts/test-code-intel.sh`) if CLI
  examples, smoke expectations, or package script wiring change.
- Manual sanity: rerun examples in the slice being landed and any prior
  behavior the change could regress.

When a slice lands, move durable facts into the Status block, remove the
completed slice section, and refresh `STATUS.md` only if the snapshot changes.
