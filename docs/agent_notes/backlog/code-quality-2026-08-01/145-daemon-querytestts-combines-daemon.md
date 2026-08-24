# 145. `daemon-query.test.ts` hides daemon-client and graph-cache authority behind an integration-suite name

Status: Landed on fix/cq-145
Theme: subject-owned test suites · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/code-intel/daemon-query.test.ts` is named for the daemon query route,
but its single describe also owns daemon-client readiness and wire-protocol
behavior, `GraphCache.ensure` invalidation, and workspace-manifest hashing.

This makes focused verification misleading. A contributor changing
`graph-cache.ts` can run the subject-named `graph-cache.test.ts` and miss the
cache's rebuild and content-fingerprint contracts. A contributor changing
`daemon-client.ts` must discover an unrelatedly named suite and load its large
resident-daemon workspace fixture even though the client cases use fake
transports and no running daemon.

The shared fixture rail also obscures each test's true dependencies. The
integration cases genuinely need resident projects and daemon lifecycle
management; the protocol and cache cases do not.

## Evidence

- `scripts/code-intel/daemon-query.test.ts:39-312` — one
  `"code:intel daemon query route"` describe owns temporary repository/state
  setup, a 120-line disk workspace, daemon lifecycle helpers, an in-memory graph
  fixture, and project/cache construction before any test begins.
- Re-derived from `scripts/code-intel/daemon-query.test.ts`: at the audit pin
  the 827-line file contained 18 cases — eight route/resident-daemon
  integration cases, eight directly exercising `requestDaemonQuery`, and two
  directly exercising graph-cache or manifest behavior. Leaf 133 landed
  before this unit was worked and added one route case
  (`"maps every undecodable request to one-shot fallback semantics"`, which
  starts a daemon through `startDiskDaemon`), so the live file this unit
  reorganized was 882 lines with **19** cases: 9 route, 8 client, 2 cache.
- `scripts/code-intel/daemon-query.test.ts:472-722` — eight consecutive cases
  cover no-daemon fallback, protocol-version and metadata rejection,
  response-arm validation, missing definition hints, empty-result formatting,
  and refs-versus-graph timeout policy. They call the client with state helpers
  or injected transports rather than starting a daemon.
- `scripts/code-intel/daemon-query.test.ts:775-804` — two cases instantiate
  `GraphCache` or call `computeWorkspaceManifest` directly; neither starts nor
  queries a daemon.
- `scripts/code-intel/daemon-query.test.ts:314-470,724-773,806-826` — the other
  eight cases start a daemon through `runDaemon`, `startFixtureDaemon`, or
  `startDiskDaemon` and are correctly owned by the route integration suite.
- `scripts/code-intel/graph-cache.test.ts:7-71` — the existing subject-named
  suite tests only `resolveGitDir` and `readGitHead`; it does not cover
  `GraphCache.ensure` or source-content invalidation.
- `scripts/code-intel/graph-cache.ts:27-45` — `GraphCache.ensure` owns the
  manifest comparison and rebuild contract currently tested only in
  `daemon-query.test.ts:775-792`.

## Proposed direction

Split the suite by production subject while preserving every existing case.

1. **Keep route integration in `daemon-query.test.ts`.** Retain the eight cases
   at `:314-470`, `:724-773`, and `:806-826` under the existing describe.
   `createSymbolWorkspace`, `startDiskDaemon`, `startFixtureDaemon`,
   `expectDaemonMatchesOneShot`, and the resident `GraphCache`/`ProjectCache`
   construction stay here because these cases exercise the running daemon and
   resident projects.

2. **Create `scripts/code-intel/daemon-client.test.ts`.** Move the eight
   `requestDaemonQuery` cases at `:472-722`. Give the new suite self-contained
   temporary repository and state directories, the daemon-state helpers
   `resolveDaemonStatePaths`, `ensureStateDir`, and `writeDaemonMetadata`, and
   `prepareReadyDaemonClient`. Retain the injected fake transports and the
   `formatCodeIntelQueryResult` dependency used by the empty-result case.

   These cases need no `createSymbolWorkspace` copy and no running daemon. Keep
   any result-unwrapping helper local unless it remains genuinely shared with
   route integration; do not import one test file from another.

3. **Move the two cache cases to `graph-cache.test.ts`.** Add subject-named
   describes for `GraphCache.ensure` and `computeWorkspaceManifest`. Build the
   `GraphCache.ensure` entry from the in-memory project/resolver primitives in
   `test-fixtures.test-helper.ts`. For the same-size-edit case, create only the
   smallest on-disk workspace and source file that
   `computeWorkspaceManifest` actually discovers.

   Preserve the `statSync`/`utimesSync` restoration of the original mtime
   verbatim: proving that content, rather than size or timestamp alone, changes
   the fingerprint is the contract. Ensure the pared source path is genuinely
   in the manifest walk so the assertion cannot pass vacuously.

4. **Prune after relocation.** Remove imports and helpers from
   `daemon-query.test.ts` only after their final consumer moves, including
   `prepareReadyDaemonClient`, `DaemonRequestTimeoutError`,
   `computeWorkspaceManifest`, and direct cache imports when no longer used.

The acceptance inventory is every case in the live file accounted for by
subject: as landed after 133, **19** cases as 9 route, 8 client, and 2 cache
(the audit-pin arithmetic was 18 as 8/8/2 — see Evidence); the six
pre-existing `graph-cache.test.ts` cases are additional. The focused command
exists as `bun run test:scripts:file -- <file>` and should be used for each of
the three subject suites.

## Scope / caveats

- `daemon-client.test.ts` is a new file. Scripts Vitest suites are
  auto-discovered; no harness manifest, generated coverage-map entry, or
  smoke-subject registration should be added.
- Keep each suite's temporary state paths self-contained. Moving the client
  cases out of the shared `beforeEach` must not introduce cross-file collisions
  when scripts tests run in parallel.
- Do not change case behavior, assertions, timeout policy, daemon protocol, or
  production code in `daemon-client.ts`, `daemon-query.ts`, or
  `graph-cache.ts`. Coverage expansion beyond relocating these ten cases is
  out of scope.
- Avoid replacing the large fixture with another shared test mini-framework.
  Reuse `test-fixtures.test-helper.ts` for its existing in-memory primitives;
  keep the cache disk fixture minimal and subject-local.
- CQ25-66/H21 in
  [HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md)
  is an optional production extraction of shared manifest-gated cache
  plumbing. It neither blocks nor is blocked by this test-only move. If it
  lands first, the relocated `GraphCache.ensure` cases become its natural
  focused regression net.
