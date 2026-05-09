# Plan: `code:intel` Follow-ups

Status: implemented in working tree
Date: 2026-05-08

This is the single active handoff for `code:intel`. The implemented v1 plan was
folded into this note so agents do not need to cross-read a retired plan.

## Current Baseline

`bun run code:intel --` is a read-only ts-morph CLI with these commands:

```bash
bun run code:intel -- def        <file>:<line>:<col>
bun run code:intel -- exports    <file>
bun run code:intel -- dependents <file> [--depth <N>]
bun run code:intel -- tests      <file>
```

The CLI is feedforward context for agents, not a gate. It intentionally does
not provide `refs`, JSON output, caching, or a daemon yet.

Implementation and coverage:

- Main CLI: `scripts/code-intel.ts`
- Unit coverage: `scripts/code-intel.test.ts`
- Shell smoke coverage: `scripts/test-code-intel.sh`
- Runner/config integration: `scripts/vitest.config.ts`,
  `tsconfig.scripts.json`, `scripts/test-changed.sh`,
  `scripts/test-scripts.sh`, `scripts/test-test-scripts.sh`
- Hook wrapping: root `package.json`, `scripts/ai-hooks/policy.sh`,
  `scripts/ai-hooks/test.sh`

Resolver behavior to preserve:

- Workspace package `exports` are mapped from dist/type targets back to source.
- Covered paths include `@musi/shared/*`, `@musi/server/router-type`, client
  `@/*`, relative imports, `.js`/`.jsx`/`.d.ts` source equivalents,
  extensionless imports, `index.ts`, and `.tsx` probes.
- `dependents` scans static imports, re-exports, and literal dynamic imports.
- `tests` reports co-located tests, slow-tier tests, and tests reached through
  runtime import edges. It must ignore bare `vi.mock("module")` targets,
  though imports inside mock factories still count.

Useful manual checks:

```bash
bun run code:intel -- exports packages/shared/src/schemas/character.ts
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 2
bun run code:intel -- def packages/server/src/routers/character.ts:12:3
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct
```

## Review Findings

Two post-commit reviews agreed the CLI is useful and mostly ship-shaped. The
actionable concerns are concentrated in test discovery:

- `queryTests` walks only runtime import edges, but `collectImportEdges`
  currently marks an entire static import as runtime when
  `importDeclaration.isTypeOnly()` is false. TypeScript also allows
  `import { type Foo } from "./foo.js"`, where the declaration is not
  type-only but every named specifier is. Those imports can become false
  "covering test" edges.
- The same issue applies to type-only export specifiers such as
  `export { type Foo } from "./foo.js"`.
- Broad shared modules can produce too much `tests` output. On 2026-05-08,
  `bun scripts/code-intel.ts tests packages/shared/src/schemas/character.ts`
  returned 145 test candidates, mostly deep transitive matches.

This note is a follow-up queue, not a request to redesign v1 or daemonize it.

## Decision

Implemented in this pass:

- Runtime edge classification now looks at per-specifier type-only imports and
  re-exports. `import { type Foo }` and `export { type Foo }` no longer create
  runtime coverage edges; mixed value/type specifiers still do.
- `tests` now accepts `--depth <N>`, `--direct`, and
  `--project <shared|server|client>`. The default depth remains unbounded, and
  co-located tests stay visible regardless of depth.
- Global `--help` and `usage()` now include command examples and the note that
  `tests` is a candidate finder, not an exact coverage oracle.

Defer for now:

- Cycle warnings/debug output. `reverseBfs` already handles cycles, and no
  reviewed workflow showed a confusing cycle case.
- Caching or a daemon. Keep monitoring latency; the daemon options are parked
  in `docs/agent_notes/backlog/code-intel-daemon-options.md`.
- Definition ambiguity. `queryDefinition` already formats every returned
  definition row; only the header is based on the first result. Revisit only
  with a concrete confusing case.
- JSON output or a larger result model. There is no consumer yet.

## Slice 1: Runtime Import Correctness

Files:

- `scripts/code-intel.ts`
- `scripts/code-intel.test.ts`

Implement helpers near `collectImportEdges`:

- `importDeclarationHasRuntimeEdge(importDeclaration)`
  - false when `importDeclaration.isTypeOnly()`
  - true for default imports, namespace imports, side-effect imports, and
    empty named imports
  - true when any named import specifier has `!specifier.isTypeOnly()`
  - false for `import { type Foo } from "./foo.js"` when all named specifiers
    are type-only
- `exportDeclarationHasRuntimeEdge(exportDeclaration)`
  - false when `exportDeclaration.isTypeOnly()`
  - true for `export * from`, namespace exports, and any named export
    specifier with `!specifier.isTypeOnly()`
  - false for `export { type Foo } from "./foo.js"` when all named specifiers
    are type-only

Then replace the current declaration-level runtime checks in
`collectImportEdges`.

Fixture coverage to add:

- A test file with `import { type Live } from "./live.js"` must not appear in
  `queryTests` results for `live.ts`.
- A test file with `import { live, type Live } from "./live.js"` must still
  appear.
- A type-only re-export barrel, `export { type Live } from "./live.js"`, must
  not create runtime coverage through the barrel.
- A mixed/value re-export barrel must still create runtime coverage.

## Slice 2: Bounded `tests`

Files:

- `scripts/code-intel.ts`
- `scripts/code-intel.test.ts`
- `scripts/test-code-intel.sh` only if smoke coverage needs a CLI assertion

Suggested shape:

```
bun run code:intel -- tests <file> [--depth <N>] [--direct] [--project <shared|server|client>]
```

Implementation notes:

- Replace `parseSingleFileArgs("tests", ...)` with a `parseTestsArgs` helper.
- Extend the `CliCommand` `tests` variant with a depth limit and optional
  project filter.
- Keep the default depth as infinity so existing behavior does not change.
- Treat `--direct` as `--depth 1`; reject `--direct` together with `--depth` to
  avoid hidden precedence.
- Pass the depth limit to `reverseBfs(graph, target, depth, true)`.
- Keep co-located tests visible regardless of depth.
- If adding `--project`, filter final test results by path prefix:
  `packages/shared/`, `packages/server/`, or `packages/client/`.

Tests to add:

- `queryTests(..., { depth: 1 })` includes direct and co-located tests but not
  transitive tests.
- `runCodeIntel(["tests", file, "--depth", "2"], fixtureContext)` returns a
  depth-2 transitive test.
- `runCodeIntel(["tests", file, "--direct"], fixtureContext)` behaves like
  depth 1.
- If implemented, `--project server` removes client/shared test files while
  keeping server matches.
- Invalid depth and unknown flags still produce `CodeIntelError`.

## Slice 3: Usage Polish

Only do this when already touching parser/output code.

- Add a global `--help` and command examples to `usage()`.
- Mention that `tests` is a candidate finder, not an exact coverage oracle.
- Consider a result count in the header, for example `tests <file> (145
  results)`, but update existing formatter tests/smoke tests if the header
  changes.

## Out of Scope

- Do not add `refs` until workspace resolution has more real-world mileage.
- Do not daemonize this CLI as part of these slices; use
  `docs/agent_notes/backlog/code-intel-daemon-options.md` only when
  re-triaging the larger code-intel workstream.
- Do not add JSON output until a concrete consumer exists.

## Verification

Focused verification for these slices:

```bash
bun run test:changed
bun run test:scripts:changed
bun run typecheck
```

Use `bun run verify:changed` before calling the implementation landed. If only
the note changes, no verification beyond checking the edited markdown is needed.

Last verified on 2026-05-08:

```bash
bun run test -- --project=scripts scripts/code-intel.test.ts
bunx tsc -p tsconfig.scripts.json
bun run test:scripts:changed
bun run verify:changed
```
