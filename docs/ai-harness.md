# AI Harness

Musi's AI harness is the repo-owned support system around coding agents. Keep
this file as an inventory and gap map, not a design essay.

## Terms

- **Guide**: feedforward context before an edit: docs, module notes, skills,
  templates, codemods, and language-intelligence tools.
- **Sensor**: feedback after or during an edit: lint, typecheck, tests,
  structural checks, logs, browser runs, review agents, and drift monitors.
- **Computational**: deterministic or mostly deterministic output from code,
  scripts, compilers, tests, or static analysis.
- **Inferential**: LLM-mediated interpretation, review, or guidance.
- **Maintainability**: style, size, typing, local consistency, and test
  placement.
- **Architecture fitness**: package direction, module seams, persistence,
  authorization, realtime, schema, and concurrency contracts.
- **Behavior**: whether user-facing and rules-domain behavior is correct.

## Timing

Fast checks belong in the edit loop, `verify:changed`, or pre-commit. Slow or
judgment-heavy checks start as `doctor`, CI, scheduled, or manual signals.
Only promote a sensor to a gate after it has low noise and clear repair text.

## Guides

| Guide | Category | Mode | Prevents | Timing | Paired sensor |
|---|---|---|---|---|---|
| `AGENTS.md` | Maintainability, architecture fitness, behavior | Inferential | Agents missing global repo rules, workflow, and domain constraints | Session start | `verify:changed`, pre-commit, `doctor` |
| `docs/agent_notes/STATUS.md` and `NEXT.md` | Maintainability | Inferential | Agents picking stale work or reopening parked workstreams | Session start | Stop-hook dirty-work reminder |
| `docs/architecture-plan.md` | Architecture fitness | Inferential | Cross-package and stack-level changes drifting from planned architecture | Manual, area-specific | Typecheck, tests, future graph checks |
| `docs/authorization.md` | Architecture fitness, behavior | Inferential | Auth mismatch semantics, especially intentional `NOT_FOUND`, being reimplemented incorrectly | Area-specific | Auth/router tests |
| `docs/socket-architecture.md` | Architecture fitness, behavior | Inferential | Socket.io being used for writes, unregistered broadcast behavior, or broadcasts before commit | Area-specific | Broadcast registry tests, `local/socket-registry-broadcasts`, `local/no-broadcast-in-transaction` |
| `docs/CONCURRENCY.md` | Architecture fitness, behavior | Inferential | Race-sensitive writes bypassing locked mutation helpers | Area-specific | Restricted Prisma types, `local/concurrency-guard`, RawTxClient lint |
| `MODULE.md` / `*-MODULE.md` files | Maintainability, architecture fitness | Inferential | Agents editing a module without its local interface, flows, and invariants | Area-specific | `module:index:check`, future doc-freshness sensor |
| `docs/module-docs.md` | Maintainability | Inferential | Module notes drifting into inconsistent shape | When adding or refreshing module docs | `bun run module:index:check` |
| `.claude/skills/playwright-cli/SKILL.md` | Behavior | Inferential | Browser verification being run with the wrong workflow | Manual | Playwright/e2e logs |
| `docs/guides/add-socket-broadcast.md` | Architecture fitness, behavior | Inferential | Agents adding registry-owned broadcasts without the schema, helper, post-commit timing, or logger recipe | Area-specific | `local/socket-registry-broadcasts`, `local/no-broadcast-in-transaction`, broadcast registry tests |
| `docs/guides/add-trpc-procedure.md` | Architecture fitness, behavior | Inferential | Agents adding router procedures without the shared input, output, auth, service, and test recipe | Area-specific | `local/strict-trpc-input`, `local/trpc-require-output-schema`, app-router output coverage test |
| `docs/guides/add-prisma-migration.md` | Architecture fitness, behavior | Inferential | Agents changing Prisma schema without generating, inspecting, applying, and safety-scanning the migration | Area-specific | `db:migration-safety`, `db:status`, `doctor` |
| `docs/guides/add-race-sensitive-mutation.md` | Architecture fitness, behavior | Inferential | Agents adding or changing race-sensitive mutations without the gate, locked helper, conflict semantics, restricted imports, and concurrency test recipe | Area-specific | `local/concurrency-guard`, `RawTxClient` restricted import, Restricted Prisma delegate types |
| `docs/guides/add-client-feature-module-cache-socket.md` | Architecture fitness, behavior | Inferential | Agents adding client feature modules with hand-built query keys, component-local socket listeners, or untested optimistic cache writes | Area-specific | Client hook/component tests, `local/test-file-location` |
| Future narrow guides | Architecture fitness, behavior | Inferential | Repeated edits requiring the same local recipe | Manual, area-specific | Matching lint/test/doctor sensor |
| `bun run codemod:trpc-shared-input -- --check` / `-- [--target <schema.js>] <router-file>` | Architecture fitness | Computational | Agents hand-editing simple router-local tRPC input schema moves | Manual, before edit | `local/trpc-shared-input-schema` |
| `bun run codemod:trpc-shared-output -- --check` / `-- [--target <schema.js>] <router-file>` / `-- --all` | Architecture fitness | Computational | Agents hand-editing simple router-local tRPC output schema moves | Manual, before edit | `local/trpc-shared-output-schema` |
| `bun run codemod:structured-logging-fix -- --check` / `-- [--dry-run] <file>` / `-- --all` | Maintainability, architecture fitness | Computational | Agents guessing safe structured log rewrites or leaving seed scripts on direct console output | Manual, before edit | `local/structured-logging` |
| `bun run codemod:concurrency-guard -- --check` / `--all` / `<file>` | Architecture fitness, behavior | Computational | Agents bypassing existing race-sensitive helper boundaries or drifting helper internals; name-based only, so aliases/destructuring still need review | Manual, after concurrency-sensitive edits | Restricted Prisma delegate types, `RawTxClient` lint |
| Future codemods in `scripts/codemods/` | Maintainability, architecture fitness | Computational | Agents hand-editing known migration shapes | Manual, before edit | Matching lint with repair command |
| `bun run code:intel -- ...` (`docs/guides/code-intel.md`, Codex `.codex/skills/code-intel`, Claude `.claude/skills/code-intel`) | Maintainability, architecture fitness | Computational | Noisy `rg` archaeology for definitions, dependents, exports, references, and nearby tests | Manual, during exploration | Future graph/drift sensors |

## Sensors

| Sensor | Category | Mode | Catches | Timing / command | Paired guide |
|---|---|---|---|---|---|
| TypeScript build | Maintainability, architecture fitness | Computational | Type, project-reference, and restricted-delegate violations | `bun run typecheck`, `bun run verify:changed` | `AGENTS.md`, `docs/CONCURRENCY.md` |
| ESLint core rules | Maintainability | Computational | Complexity, function size, import sorting, unused code, console use | `bun run lint`, `bun run lint:changed` | `AGENTS.md` |
| `local/max-lines` | Maintainability | Computational | Source/helper modules over the 300 effective-line default, with targeted warning caps for accepted larger files | `bun run lint`, `bun run lint:changed` | `AGENTS.md`, override comments in `eslint.config.js` |
| `local/no-explicit-any` | Maintainability | Computational | Explicit `any` usage without a deliberate line-level suppression reason | `bun run lint`, `bun run lint:changed` | `AGENTS.md`, `eslint-disable-register` |
| `local/strict-trpc-input` | Architecture fitness | Computational | Inline router `.input(z.object(...))` schemas that omit `.strict()` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-require-output-schema` | Architecture fitness | Computational | Router queries/mutations missing `.output(schema)` before `.query(...)` or `.mutation(...)` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-shared-input-schema` | Architecture fitness | Computational | Router `.input(...)` schemas not imported from `@musi/shared/schemas/...` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-shared-output-schema` | Architecture fitness | Computational | Router `.output(...)` schemas not imported directly from `@musi/shared/schemas/...` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/strict-shared-schemas` | Architecture fitness | Computational | Input schemas allowing unknown keys at package boundaries | `bun run lint`, `bun run lint:changed` | `AGENTS.md` |
| `local/structured-logging` | Maintainability, architecture fitness | Computational | Server code bypassing structured logging or direct `console.*` in server/seed code | `bun run lint`, `bun run lint:changed` | `codemod:structured-logging-fix` |
| `local/test-file-location` | Maintainability | Computational | Tests landing away from the code they cover | `bun run lint`, `bun run lint:changed` | `AGENTS.md` |
| Shared schema barrel import ban | Architecture fitness | Computational | Imports from removed `@musi/shared/schemas` barrel | `bun run lint`, `bun run lint:changed` | Future schema-import codemod |
| Shared/client socket import restrictions | Architecture fitness | Computational | `packages/shared` depending on app/runtime adapters, or client code constructing a second Socket.io client outside `SocketProvider` | `bun run lint`, `bun run lint:changed` | `AGENTS.md`, `docs/socket-architecture.md` |
| `local/concurrency-guard` | Architecture fitness, behavior | Computational | Direct `.update`, `.updateMany`, `.updateManyAndReturn`, or `.upsert` calls on concurrency-gated Prisma delegates outside mutation helpers | `bun run lint`, `bun run lint:changed` | `docs/guides/add-race-sensitive-mutation.md` |
| `RawTxClient` restricted import | Architecture fitness, behavior | Computational | Race-sensitive Prisma write escape outside `utils/*-mutations.ts` | `bun run lint`, `bun run lint:changed` | `docs/CONCURRENCY.md` |
| Restricted Prisma delegate types | Architecture fitness, behavior | Computational | Direct `.update`, `.updateMany`, `.updateManyAndReturn`, or `.upsert` on gated tables | `bun run typecheck` | `docs/CONCURRENCY.md` |
| App-router output coverage test | Architecture fitness | Computational | tRPC queries/mutations missing non-permissive `.output(schema)` | `bun run test:server`, `bun run verify:changed` when selected | `docs/guides/add-trpc-procedure.md` |
| Vitest unit/integration tests | Behavior | Computational | Regressions covered by server, client, shared, and script tests | `bun run test`, `bun run test:changed`, `bun run verify:changed` | Area docs and test helpers |
| Playwright e2e | Behavior | Computational | Browser workflow regressions | `bun run e2e`, Stop hook when cached/failing | `playwright-cli` skill |
| `verify` / `verify:changed` wrapper | Maintainability, architecture fitness, behavior | Computational | Lint, typecheck, and test failures with shared cache/lock/logs | `bun run verify:changed` | `AGENTS.md` |
| `verify:logs` | Maintainability | Computational | Hidden or stale verification failures in cached logs | `bun run verify:logs` | Stop-policy prompts |
| `doctor` | Architecture fitness, maintainability | Computational | Worktree, DB, env, port, dependency, lint-suppression, and migration-safety drift | `bun run doctor` | `AGENTS.md`, worktree docs |
| `db:status` | Architecture fitness | Computational | Migration, Prisma client, and DB connectivity drift | `bun run db:status`, via `doctor` | `docs/guides/add-prisma-migration.md` |
| `db:migration-safety` | Architecture fitness, behavior | Computational | Destructive or risky Prisma migrations lacking acknowledgement | `bun run db:migration-safety`, via `doctor` | `docs/guides/add-prisma-migration.md` |
| `module:index:check` | Maintainability | Computational | Module doc index drift | `bun run module:index:check` | `docs/module-docs.md` |
| `eslint-disable-register` | Maintainability | Computational | New suppressions without `-- reason` text | Via `doctor`, script smoke tests | `AGENTS.md` |
| AI hook adapters | Maintainability, architecture fitness | Computational | Protected-file edits, doc bloat, stale Prisma client risk, noisy command output, uncommitted stop state | Claude/Codex hooks | `AGENTS.md` |
| Stop-hook cached-verify replay | Maintainability, architecture fitness, behavior | Computational | Agents stopping with the most recent `verify:changed` / pre-commit run still red, when its wrapper meta still matches the worktree | Stop hook (reads `$LOG_DIR/meta/wrapper.json`) | `AGENTS.md` checking-your-work guidance |
| Script smoke tests | Maintainability | Computational | Hook, verify, worktree, module-index, migration-safety, and script wrapper regressions | `bun run test:scripts`, `bun run verify` | `scripts/` comments and shell tests |
| Worktree drift/status checks | Architecture fitness | Computational | Secondary worktree DB, port, Redis, and SRD seed drift | `bun run worktree:status`, `doctor` | `AGENTS.md` worktree guidance |
| `local/socket-registry-broadcasts` | Architecture fitness, behavior | Computational | Registry-owned events emitted directly outside `broadcast-registry.ts` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-socket-broadcast.md` |
| `local/no-broadcast-in-transaction` | Architecture fitness, behavior | Computational | Socket broadcast helpers called inside Prisma `$transaction` callbacks instead of after commit | `bun run lint`, `bun run lint:changed` | `docs/guides/add-socket-broadcast.md` |
| Mutation testing | Behavior | Computational | Tests that execute rules code without proving meaningful behavior | Manual: `bun run test:mutation` | `docs/agent_notes/backlog/mutation-testing-stryker.md` |
| Future approved behavior fixtures | Behavior | Computational | Generated tests proving the wrong shape or missing reviewed scenario data | Targeted Vitest suites | Domain docs, SRD reference |
| Future slow drift reports | Maintainability, architecture fitness | Computational | Dead exports, cycles, stale module docs, flake trends, layer drift | `doctor`, CI, scheduled, or manual | This map |
| Future project-specific reviewer | Architecture fitness, behavior | Inferential | Semantic drift not expressible as deterministic checks | Manual after deterministic checks pass | This map and area docs |

## Mutation Testing

Run `bun run test:mutation` manually when changing shared rules logic or when
auditing assertion strength. It is intentionally outside `verify`,
`verify:changed`, and pre-commit because Stryker is a slower quality audit, not
an edit-loop gate.

Reports (gitignored, regenerated per run):

- `reports/mutation/index.html` — interactive triage UI; open this first.
- `reports/mutation/mutation.json` — machine-readable report.
- `reports/mutation/stryker-incremental.json` — incremental cache; safe to
  delete to force a clean run.

Report statuses:

- `Killed`: a test caught the mutation.
- `Survived`: a test ran but missed the behavior change.
- `NoCoverage`: no relevant test covered the mutant.
- `CompileError`: TypeScript rejected the mutant.
- Timeout or runtime error: review manually; it may be an infinite loop or a
  harness problem.

Triage rules:

- Fix useful survivors with behavior-focused tests, especially missed domain
  boundaries.
- Mark or exclude reviewed equivalent mutants only when the mutation does not
  change behavior.
- Prefer scenario tables and domain examples over assertions that mirror
  implementation details.
- Avoid broad mutator exclusions until repeated triage justifies them.
- Keep survivor fixes out of the mutation setup PR so setup and test-quality
  remediation stay reviewable separately.

## Current Gaps

- Several recurring edit paths lack narrow guides: refreshing module docs and
  touching 5e rules logic.
- Behavior confidence is still weaker than maintainability and architecture
  fitness. Prefer reviewed scenario fixtures for Character Live-State,
  encounter transitions, authorization `NOT_FOUND` cases, and SRD/homebrew
  mapper provenance.
- Diagnostics are mostly human text. JSON output for `verify:logs`, `doctor`,
  `module:index:check`, migration safety, and script smoke tests would let
  future hooks or dashboards combine signals without parsing prose.
- Slow drift sensors are not yet collected into a regular report: dead
  exports, import cycles, stale module docs, changed behavior without nearby
  tests, mutation testing for `packages/shared/rules/`, and flake/timing
  trends.

## Promotion Rule

When adding a new harness control, add or update all three pieces where they
apply:

1. A guide that explains the intended path.
2. A sensor that detects drift from that path.
3. Repair text or a codemod that tells an agent exactly how to recover.

Do not add more global instructions to `AGENTS.md` unless every agent needs
them on every session start.
