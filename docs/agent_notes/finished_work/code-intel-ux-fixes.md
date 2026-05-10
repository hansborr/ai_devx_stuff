# `code:intel` UX Fixes

Status: All planned slices landed. Slices A-D (CLI polish, filtered
dependents, --limit, name-based def, near-match hints, project summaries,
extraction into linted `scripts/code-intel/` modules) and Slice F leaves 1-6
(structured executor, thin CLI front door, daemon lifecycle CLI, graph-query
daemon path, language-service daemon path, default UX/docs/perf pass) landed
on prior commits. Slice E (`refs <file>:<line>:<col>`) landed in this
branch: a workspace-wide ts-morph reference project keyed by
`@musi/{shared,server,client}/*` and `@/*` paths runs `findReferences` on the
identifier at the snapped position, classifies each hit as
`import|value|type` by walking the parent chain, excludes the declaration
from default output, and supports `--limit` and `--format json`. The daemon
routes `refs` through `ProjectCache.referenceProject(...)`, lazily built and
cached alongside the per-package projects. Daemon and one-shot output match
byte-for-byte for cross-package refs, renamed imports, type-only references,
and snap-to-nearest. The thin CLI front door dynamic-imports the one-shot
runner only on the fallback path, with a lazy-binding facade that preserves
the existing `./code-intel.js` test/API import surface.
`code:intel:server -- status|stop|restart` manages a per-repo daemon under
`/tmp/musi-code-intel/<repo-key>/`. Normal `code:intel` calls do not
auto-start the daemon: they route to a running daemon when present and fall
back to one-shot when the daemon is absent, stale, or protocol-mismatched.
This opt-in default keeps the correctness story simple and avoids hidden
process creation from read-only lookup commands; stop the daemon to force
one-shot execution. `dependents` and `tests` route through the daemon (warm
queries ~70ms p50 end-to-end vs. ~3.5s cold one-shot) with one-shot fallback;
the daemon owns a workspace resolver, source discovery, a cached
`ImportGraph`, and request-time manifest invalidation (mtimes +
`tsconfig*.json` + `package.json` + `bun.lock` + branch + head). `def`
(positional and `--name`), `exports`, and `refs` route through the same
daemon transport using a daemon-owned `ProjectCache` keyed by the same
`computeWorkspaceManifest` fingerprint as `GraphCache`; per-package
ts-morph projects feed `executeCodeIntelQuery` through the existing
`project` / `graphProject` / `referenceProject` context overrides. Daemon
and one-shot fixture coverage matches text/JSON output for package exports,
source-vs-dist mapping, client `@/*`, re-exports, renamed imports,
snap-to-nearest, near matches, cross-package refs, protocol/absent fallback,
and first-query-after-source-mutation rebuilds. User docs and the
Codex/Claude skill adapters now document the opt-in daemon flow, the
internal protocol boundary, and the `refs` subcommand. `code:intel:perf` is
an advisory, non-gating timing guard that runs a fixed cold one-shot and
warm daemon query mix and prints p50/p95.

Wire-protocol note: client and server frame requests/responses with a
trailing newline (`{json}\n`) over the Unix socket and read until the
delimiter, then the server half-closes after writing the response. The
earlier client `socket.end(payload)` half-close is incompatible with Bun's
`node:net` server (the writable side closes silently before the handler
runs, so the response bytes are dropped). Newline framing avoids that
without relying on `allowHalfOpen`.

`scripts/code-intel/**/*.ts` is included in `tsconfig.scripts.json`, linted
through a narrow ESLint parser override, and selected by `test:scripts:changed`
via the `test-code-intel` smoke. Future code-intel work must preserve the
`./code-intel.js` test-facing import surface unless deliberately migrated.

### Inputs leaf 5 inherits from leaves 1-4

What is already in place — leaf 5 should reuse, not redo:

- `scripts/code-intel/query-executor.ts` exposes `executeCodeIntelQuery`.
  Daemon-side the executor now reads `context.graph` when the caller
  pre-built one (graph commands path) and falls back to building from
  `sourceFilesForGraph` otherwise. Leaf 5 should plumb a daemon-resident
  TypeScript `Project` (or set of `Project`s) through the same
  `CodeIntelContext` shape — the executor already accepts `project` and
  `graphProject` overrides; reuse them rather than adding parallel knobs.
- `scripts/code-intel/cli-main.ts` is the daemon-capable entrypoint and
  routes graph commands through `daemon-client.requestDaemonQuery` with a
  one-shot fallback. Leaf 5 should extend the same `tryDaemonRoute` helper
  to cover `def`, `def --name`, and `exports` rather than introducing a
  second routing function.
- `scripts/code-intel/daemon-client.ts` and
  `scripts/code-intel/daemon-server.ts` already implement the
  newline-framed JSON envelope, protocol-version + id checks, and the
  `DAEMON_FALLBACK_ERROR_NAME` sentinel. Leaf 5 only needs to whitelist
  more command kinds in `isGraphCommand`/equivalents and add a symbol-side
  cache instead of redoing transport.
- `scripts/code-intel/graph-cache.ts` owns the manifest fingerprint and
  rebuild path for the graph (`computeWorkspaceManifest` + `defaultGraphRebuild`).
  Leaf 5 should mirror the same cache shape for the symbol side: a
  `GraphCache`-style class keyed off the same manifest, owning per-package
  ts-morph `Project`s. Sharing the manifest computation keeps invalidation
  symmetric — one source change invalidates both caches in lockstep.
- `scripts/code-intel/daemon-protocol.ts` defines
  `CODE_INTEL_DAEMON_PROTOCOL_VERSION = 1`, `CodeIntelDaemonRequest`,
  `CodeIntelDaemonResponse`, `CodeIntelDaemonError`. Reuse these; bump the
  version only if leaf 5 strictly needs new envelope fields.
- `scripts/code-intel/daemon-state.ts`, `daemon-process.ts`, and
  `server-cli.ts` are unchanged surfaces; leaf 5 must not change their
  shape.
- Public surface from `scripts/code-intel.ts` (must not regress):
  `CODE_INTEL_DAEMON_PROTOCOL_VERSION`, `CodeIntelError`, `WorkspaceResolver`,
  `buildImportGraph`, `createWorkspaceResolver`, `executeCodeIntelQuery`,
  `formatCodeIntelQueryResult`, `queryDefinition`, `queryDefinitionsByName`,
  `queryDependents`, `queryExports`, `queryTests`, `runCodeIntel`,
  `runCodeIntelCli`.

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
- **Lifecycle**: explicit `code:intel:server status|stop|restart`; normal CLI
  behavior routes to a running daemon if present and falls back to one-shot
  otherwise. Slice F leaf 6 kept daemon startup opt-in only.
- **Cache invalidation**: request-time manifest (mtimes + `tsconfig*.json` +
  `package.json` + `bun.lock` + branch + head), not file watchers. Tradeoff:
  small per-request stat cost; deterministic and avoids watcher failure modes.
- **Bypass knob**: drop `CODE_INTEL_ONESHOT=1` from the plan. No
  `--no-daemon` flag is needed for the opt-in default; stop the daemon to force
  one-shot execution.
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

4. **Graph-query daemon path (`dependents`/`tests`)** — Landed in this
   branch. `cli-main.ts` routes graph commands through
   `daemon-client.requestDaemonQuery`; the daemon parses the envelope,
   validates protocol version, looks up a cached `ImportGraph` via
   `GraphCache`, runs `executeCodeIntelQuery`, and returns the structured
   result over a newline-delimited JSON wire. `GraphCache` rebuilds when
   the manifest (mtimes + `tsconfig*.json` + `package.json` + `bun.lock` +
   branch + head) changes. Daemon-backed and one-shot output match
   byte-for-byte for `dependents` and `tests`; absent or protocol-mismatched
   daemons fall back to one-shot.

5. **Language-service daemon path (`def`/`exports`)** — Landed in this
   branch. `ProjectCache` mirrors `GraphCache`, reuses
   `computeWorkspaceManifest`, owns per-package shared/server/client/scripts
   ts-morph projects plus a graph project for name lookups, and is routed
   through `executeCodeIntelQuery` via `project` / `graphProject`. The
   existing daemon route now covers `def`, `def --name`, and `exports` with
   one-shot fallback. Fixture coverage compares daemon and one-shot text/JSON
   output for positional def, snap-to-nearest, name hits, near-match misses,
   exports, package exports, `@/*`, re-exports, renamed imports, absent /
   protocol fallback, and first-query-after-manifest-change rebuilds.

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
