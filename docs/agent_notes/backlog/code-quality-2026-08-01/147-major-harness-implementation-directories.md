# 147. Two major harness implementation directories lack local ownership maps

Status: Landed on fix/cq-147
Theme: local harness orientation · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/harness/` and `scripts/code-intel/` are two of the repository's
largest and most contract-heavy script families, but neither has a local
`MODULE.md`. Their only common orientation is a one-line table entry in the
remote `scripts/README.md`.

A contributor entering `scripts/harness/` must reconstruct which manifest is
authoritative, which artifacts are generated, how validation and registration
checks compose, and which top-level facade owns each flow. A contributor
entering `scripts/code-intel/` must infer the boundary between CLI parsing,
one-shot query execution, graph/project construction, caching, and the daemon
transport from filenames and imports.

That is precisely the class of surface for which the repository's module-doc
charter requires a local orientation contract. The gap is especially costly
for an outside reader using Musi as a harness-engineering reference: the
implementation directories that demonstrate the harness provide less local
guidance than several application features.

## Evidence

- `docs/module-docs.md:3-5,24-30` — `MODULE.md` files are required for surfaces
  too large, stateful, or subtle to understand from filenames, including large
  directories, state owners, cross-module contracts, and future refactor
  targets.
- `docs/module-docs.md:36-53` — the charter defines the expected sections:
  Purpose, Data Flow, External Entry Points, State Ownership, Test Seams, and
  Gotchas.
- Re-derived from tracked direct children at the pin:
  `scripts/harness/` has 41 production TypeScript files, plus the generated
  `generated-surface-freshness.generated.sh`, for 42 direct non-test
  implementation files. It has no local `MODULE.md`.
- Re-derived from tracked direct children at the pin:
  `scripts/code-intel/` has 36 direct `.ts` files not named `*.test.ts`; one is
  `test-fixtures.test-helper.ts`, leaving 35 production TypeScript files plus
  that test helper. It has no local `MODULE.md`.
- `scripts/README.md:50-64` — the only shared orientation is one row saying
  code-intel implements the CLI/daemon entrypoints and one row saying harness
  owns validation, generators, diagnostics, and tests.
- `scripts/harness-check.ts:27-43,119-163` — the top-level gate composes fixture
  closure, manifest tripwires, registration, preflight wiring, generated
  freshness, porting parity, pre-push scope, and CI parity from modules under
  `scripts/harness/`.
- `scripts/harness-audit.ts:2-18,25-43` — the diagnostics facade has a distinct
  report-only role and delegates report assembly/rendering to
  `scripts/harness/harness-audit-report.ts`.
- `scripts/code-intel/cli-main.ts:27-44` — the CLI parses arguments, attempts
  the daemon route, and lazily falls back to the one-shot runner.
- `scripts/code-intel/query-executor.ts:41-66` — the one-shot executor
  dispatches into the per-query modules; graph construction and source-project
  selection enter through imports at `:3-22`.
- `scripts/code-intel/graph-cache.ts:27-45`,
  `scripts/code-intel/project-cache.ts:39-70`, and
  `scripts/code-intel/daemon-state.ts:13-70` — the family owns two
  manifest-gated in-memory caches plus per-repository daemon metadata, pid, and
  socket paths.

## Proposed direction

Split this combined M proposal into two independent S leaves, one local module
document per directory. Follow `docs/module-docs.md` and
`docs/guides/add-module-doc.md`, using
`scripts/path-policy/MODULE.md` as the in-repository template for tone,
altitude, link style, and optional `Concepts:` breadcrumb.

1. **Add `scripts/harness/MODULE.md`.** Use the charter's Purpose, Data Flow,
   External Entry Points, State Ownership, Test Seams, and Gotchas sections.
   Map durable clusters rather than inventorying every file:

   - manifest schema, loading, field validation, and contract checks;
   - generated-surface projection and freshness;
   - hook wiring, shims, and timeout constants;
   - registration and preflight checks;
   - skill inventory and artifact projection; and
   - diagnostics emission and audit reporting.

   Relate those clusters to the top-level facades
   `scripts/harness-check.ts`, `scripts/harness-audit.ts`,
   `scripts/harness-registration-check.ts`, and
   `scripts/harness-emit-envelope.ts`. State that `harness.controls.json` is
   the control inventory authority, and distinguish hand-edited sources from
   generated artifacts rather than implying that generated outputs are safe to
   edit directly.

   Document `bun run harness:check` as the validation/freshness gate and
   `bun run harness:audit` as the report-only diagnostics consumer, preserving
   the latter's non-gating contract.

2. **Add `scripts/code-intel/MODULE.md`.** Describe the current layering:

   - CLI argument/value parsing and `cli-main`;
   - one-shot runner and query executor;
   - per-query modules;
   - import graph and graph queries;
   - source-project, workspace resolution, and project construction; and
   - the parallel daemon transport stack of protocol, client, server, process,
     query routing, and state.

   Name `GraphCache`, `ProjectCache`, and daemon-state files as the owners of
   cached graph/project entries and filesystem state. Identify
   `scripts/code-intel.ts` and `scripts/code-intel-server.ts` as the two
   external executable entrypoints, with `bun run code:intel` and
   `docs/guides/code-intel.md` as the user-facing query surface. Point Test
   Seams at subject-named suites and `test-fixtures.test-helper.ts` without
   turning the document into a file listing.

For each new document, run the existing `bun run module:index`, include the
regenerated root `MODULE-INDEX.md`, and confirm it with
`bun run module:index:check`. The corresponding row in
`scripts/README.md:53,59` may be upgraded to link its new local document,
matching the discoverability style already used for path-policy.

## Scope / caveats

- These are two separate documentation leaves, each size S; the stated M size
  is their combined audit scope. The harness document is independent of the
  code-intel document.
- Keep both documents at the path-policy module doc's altitude: durable
  clusters, ownership, flow, and invariants. A per-file catalog would be stale
  immediately and is explicitly not the goal.
- No code restructuring, renaming, entrypoint change, cache extraction, or
  harness wiring change belongs here. Describe current quirks under Gotchas
  rather than resolving them.
- The code-intel document should land after, or be explicitly updated by, the
  topology work in
  [109-musi-repository-policy-embedded-throughout.md](./109-musi-repository-policy-embedded-throughout.md)
  and the entrypoint-boundary work in
  [142-code-intelts-maintains-unused-pseudo-library.md](./142-code-intelts-maintains-unused-pseudo-library.md).
  The latter covers both the code-intel and drift-ai analyzer roots; if this
  module doc lands first, that leaf must carry its refresh.
- CQ25-66/H21's optional request to record cache-routing rationale is satisfied
  and superseded by the broader code-intel module document; do not create a
  second cache-only orientation note.
- This is residual scope after CQ25-119, not a reopening of landed work.
  [HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md)
  added the path-policy module doc and reorganized adjacent harness/code-intel
  internals, but left both owner directories without local orientation.
- MODULE documents for other `scripts/` directories are out of scope; their
  `scripts/README.md` rows remain the current orientation.
- These leaves change only documentation and the generated module index.
  `bun run harness:check` is not an extra acceptance command unless
  harness-surface wiring is also touched, which this scope forbids.
