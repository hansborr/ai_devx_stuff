# code-intel module

Concepts: code intel queries, import graph, ts-morph projects, code-intel daemon, graph cache, workspace resolver

## Purpose

This directory is the implementation behind the two root executables
`scripts/code-intel.ts` and `scripts/code-intel-server.ts`: read-only
TypeScript symbol and import-graph queries (`def`, `exports`, `refs`,
`dependents`, `tests`, `overview`) over the supported source roots, answered
either one-shot or through a per-repository daemon.

It does not own drift detection (`scripts/drift-ai/` owns `drift:ai`),
verification gates, or free-text search; the query contract and supported
scope are documented for users in
[`docs/guides/code-intel.md`](../../docs/guides/code-intel.md). Outside this
directory, the only production importers of its modules are the two root
executables — other script families use the CLI, with one test-only exception:
`scripts/lib/ts-module-refs.parity.test.ts` reuses
[`test-fixtures.test-helper.ts`](./test-fixtures.test-helper.ts) for its
drift-ai/code-intel parity check.

## Data Flow

One-shot path: [`cli-args.ts`](./cli-args.ts) and
[`cli-values.ts`](./cli-values.ts) parse argv into a `ParsedCli`;
[`cli-main.ts`](./cli-main.ts) first tries the daemon route and lazily imports
[`runner.ts`](./runner.ts) only on fallback, so a daemon hit never pays for
ts-morph; [`query-executor.ts`](./query-executor.ts) dispatches the per-query
modules;
[`source-project.ts`](./source-project.ts) and
[`workspace-resolver.ts`](./workspace-resolver.ts) select supported files and
construct ts-morph projects; [`import-graph.ts`](./import-graph.ts) builds the
edge graph; [`format.ts`](./format.ts) renders text or JSON.

Daemon path: [`server-cli.ts`](./server-cli.ts) drives lifecycle — it accepts
`status`, `restart`, and `stop`, with `restart` the way to start a daemon,
since queries never auto-start one — through
[`daemon-process.ts`](./daemon-process.ts) and
[`lifecycle-probe.ts`](./lifecycle-probe.ts);
[`daemon-server.ts`](./daemon-server.ts) owns the unix-socket server and
answers requests via [`daemon-query.ts`](./daemon-query.ts) against the shared
caches; [`daemon-protocol.ts`](./daemon-protocol.ts) pins the wire contract
and protocol version, decodes the six routable query request arms plus the
lifecycle ping arm, and declares the matching query/pong responses. On version
mismatch, a dead daemon, or a request that does not decode as one of those
arms, [`daemon-client.ts`](./daemon-client.ts) falls back to the one-shot path
instead of erroring.

Overview call-target classification reads Musi's repository spellings from
[`overview-conventions.ts`](./overview-conventions.ts), a plain-data object an
adopter swaps wholesale, consumed by
[`overview-call-targets.ts`](./overview-call-targets.ts).

## External Entry Points

- `scripts/code-intel.ts` (`bun run code:intel`) and
  `scripts/code-intel-server.ts` (`bun run code:intel:server`) are the two
  external executables — export-free front doors into `runCodeIntelCli` and
  `runServerCli`.
- [`docs/guides/code-intel.md`](../../docs/guides/code-intel.md) is the
  user-facing query surface: command inventory, supported scope, and the
  scope decision record.
- [`perf-check.ts`](./perf-check.ts) is a third, in-directory executable
  backing `bun run code:intel:perf`, the daemon-vs-one-shot latency sampler.

## State Ownership

- [`GraphCache`](./graph-cache.ts) and [`ProjectCache`](./project-cache.ts)
  are manifest-keyed in-memory caches: `computeWorkspaceManifest` hashes the
  workspace inputs and any change rebuilds the entry on the next `ensure()`.
  They live inside the daemon process; one-shot runs construct projects fresh
  and hold no cross-run state.
- [`daemon-state.ts`](./daemon-state.ts) owns the on-disk daemon footprint:
  per-repository metadata, pid, and socket files under
  `/tmp/musi-code-intel`, keyed by a hash of the repo realpath.

## Test Seams

- Subject-named `*.test.ts` suites sit beside each module; run one with
  `bun run test:scripts:file -- <file>`.
  [`test-fixtures.test-helper.ts`](./test-fixtures.test-helper.ts) builds the
  shared fixture trees.
- [`cli-main.test.ts`](./cli-main.test.ts) pins the front-door shape of
  `scripts/code-intel.ts` (no eager runner import, no exports) as a
  regression contract.
- [`daemon-client.test.ts`](./daemon-client.test.ts) owns readiness,
  wire-response validation, fallback, and timeout-policy coverage through
  injected transports without starting a daemon.
- [`graph-cache.test.ts`](./graph-cache.test.ts) owns `GraphCache.ensure`
  invalidation and workspace-manifest content fingerprinting.
- `scripts/tests/test-code-intel.sh` is the registered shell smoke over the
  real CLI.
- [`daemon-query.test.ts`](./daemon-query.test.ts) and
  [`server-cli.test.ts`](./server-cli.test.ts) cover the daemon route by
  starting a real in-process Unix-socket server through `runDaemon`, without
  spawning a separate daemon process.

## Gotchas

- Daemon and one-shot answers must not diverge. A semantic change to query
  behavior needs a `CODE_INTEL_DAEMON_PROTOCOL_VERSION` bump so stale daemons
  retire through the existing fallback checks (see the
  [`daemon-protocol.ts`](./daemon-protocol.ts) header).
- Daemon requests are strict-decoded because they arrive from the socket;
  `overview` remains intentionally one-shot. Query responses keep only shallow
  envelope and discriminator checks: both endpoints are compiler-owned in this
  repository, the protocol version forces lockstep, and deeper result schemas
  would add duplicate validation to the latency path.
- The supported scope (application package `src/` trees plus `scripts/`)
  bounds discovery seeds and single-file arguments, not where results may
  point: `def` and `refs` follow imports beyond the seeded roots. The
  decision record lives in
  [`docs/guides/code-intel.md`](../../docs/guides/code-intel.md); the
  coverage-extension follow-up is registered at
  [`docs/agent_notes/backlog/code-intel-followups.md`](../../docs/agent_notes/backlog/code-intel-followups.md).
- The scope guard in [`source-project.ts`](./source-project.ts) deliberately
  runs before the resolver's dist-to-src mapping so `dist/` and
  `node_modules/` artifacts keep the supported-scope error instead of being
  rewritten into apparent sources.
- Overview classification is heuristic: a call following none of the
  conventions silently disappears rather than being reported as unmatched, so
  an empty overview result is not authoritative
  ([`overview-conventions.ts`](./overview-conventions.ts) header).
