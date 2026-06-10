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

## Adapter Boundary

Shared hook policy and reusable behavior belong in `scripts/ai-hooks/`.
Keep `.claude/` and `.codex/` files as thin adapters for each harness's
registration, payload parsing, and response shape.

When changing shared behavior, update the shared script first, then adjust both
adapters only as needed. If behavior is intentionally harness-specific, document
why in the adapter or this file.

## Guides

| Guide | Category | Mode | Prevents | Timing | Paired sensor |
|---|---|---|---|---|---|
| `AGENTS.md` | Maintainability, architecture fitness, behavior | Inferential | Agents missing global repo rules, workflow, and domain constraints | Session start | `verify:changed`, pre-commit, `doctor` |
| `docs/agent_notes/README.md`, `docs/agent_notes/LOG.md`, and `docs/agent_notes/backlog/README.md` | Maintainability | Inferential | Agents treating pruned notes as active work or preserving excessive history | On demand | Stop-hook dirty-work reminder |
| `docs/architecture-plan.md` | Architecture fitness | Inferential | Cross-package and stack-level changes drifting from planned architecture | Manual, area-specific | Typecheck, tests, future graph checks |
| `docs/authorization.md` | Architecture fitness, behavior | Inferential | Auth mismatch semantics, especially intentional `NOT_FOUND`, being reimplemented incorrectly | Area-specific | Auth/router tests |
| `docs/socket-architecture.md` | Architecture fitness, behavior | Inferential | Socket.io being used for writes, unregistered broadcast behavior, or broadcasts before commit | Area-specific | Broadcast registry tests, `local/socket-registry-broadcasts`, `local/no-broadcast-in-transaction` |
| `docs/CONCURRENCY.md` | Architecture fitness, behavior | Inferential | Race-sensitive writes bypassing locked mutation helpers | Area-specific | Restricted Prisma types, `local/concurrency-guard`, RawTxClient lint |
| `MODULE.md` / `*-MODULE.md` files | Maintainability, architecture fitness | Inferential | Agents editing a module without its local interface, flows, and invariants | Area-specific | `module:index:check`, future doc-freshness sensor |
| `docs/module-docs.md` | Maintainability | Inferential | Module notes drifting into inconsistent shape | When adding or refreshing module docs | `bun run module:index:check` |
| `docs/guides/add-module-doc.md` | Maintainability | Inferential | Agents adding or refreshing module docs without the charter, `Concepts:` breadcrumb, index refresh, and verification recipe | When adding or refreshing module docs | `bun run module:index:check`, `scripts/test-generate-module-index.sh` |
| `docs/guides/coverage-cadence.md` | Maintainability, behavior | Inferential | Agents turning coverage into an edit-loop gate or missing the manual baseline cadence | Manual, weekly | `bun run test:coverage` |
| `docs/guides/local-eslint-rules.md` | Maintainability | Inferential | Agents adding local ESLint diagnostics outside the repo's message guidance convention | When editing `eslint-rules/` | `eslint-rules/message-guidance.test.js` |
| `docs/guides/lint-ratchet.md` and `docs/guides/lint-ratchet-adoption.md` | Maintainability | Inferential | Agents changing ratchets without preserving baseline lifecycle, registry checks, and adopter-facing assumptions | When editing ratchet config or docs | `bun run lint:ratchet`, `bun run lint:ratchet:zero-baseline` |
| `docs/guides/biome-lint-adoption.md` | Maintainability | Inferential | Agents treating Biome as a drop-in replacement for the authoritative ESLint/ratchet setup | Manual, external-adopter work | `bun run lint` |
| `.claude/skills/playwright-cli/SKILL.md` and `.codex/skills/playwright-cli/SKILL.md` | Behavior | Inferential | Browser verification being run with the wrong workflow | Manual | Playwright e2e logs and Playwright lint rules |
| `docs/guides/add-e2e-test.md` | Behavior | Inferential | Agents adding e2e tests without the page-object, fixture, selector, and route-exploration recipe | Area-specific | `local/e2e-prefer-role-selectors`, Playwright e2e |
| `docs/guides/add-socket-broadcast.md` | Architecture fitness, behavior | Inferential | Agents adding registry-owned broadcasts without the schema, helper, post-commit timing, or logger recipe | Area-specific | `local/socket-registry-broadcasts`, `local/no-broadcast-in-transaction`, broadcast registry tests |
| `docs/guides/add-trpc-procedure.md` | Architecture fitness, behavior | Inferential | Agents adding router procedures without the shared input, output, auth, service, and test recipe | Area-specific | `local/strict-trpc-input`, `local/trpc-require-output-schema`, app-router output coverage test |
| `docs/guides/add-prisma-migration.md` | Architecture fitness, behavior | Inferential | Agents changing Prisma schema without generating, inspecting, applying, and safety-scanning the migration | Area-specific | `db:migration-safety`, `db:status`, `doctor` |
| `docs/guides/add-race-sensitive-mutation.md` | Architecture fitness, behavior | Inferential | Agents adding or changing race-sensitive mutations without the gate, locked helper, conflict semantics, restricted imports, and concurrency test recipe | Area-specific | `local/concurrency-guard`, `RawTxClient` restricted import, Restricted Prisma delegate types |
| `docs/guides/add-client-feature-module-cache-socket.md` | Architecture fitness, behavior | Inferential | Agents adding client feature modules with hand-built query keys, component-local socket listeners, or untested optimistic cache writes | Area-specific | Client hook/component tests, `local/test-file-location` |
| `docs/guides/change-rules-logic.md` | Behavior | Inferential | Agents touching 5e/5.5e rules logic without SRD provenance, shared helper reuse, pure rules boundaries, or required colocated tests | Area-specific | Shared rules Vitest, `test:changed`, `bun run test:mutation` |
| Future narrow guides | Architecture fitness, behavior | Inferential | Repeated edits requiring the same local recipe | Manual, area-specific | Matching lint/test/doctor sensor |
| `bun run codemod:trpc-shared-input -- --check` / `-- [--target <schema.js>] <router-file>` | Architecture fitness | Computational | Agents hand-editing simple router-local tRPC input schema moves | Manual, before edit | `local/trpc-shared-input-schema` |
| `bun run codemod:trpc-shared-output -- --check` / `-- [--target <schema.js>] <router-file>` / `-- --all` | Architecture fitness | Computational | Agents hand-editing simple router-local tRPC output schema moves | Manual, before edit | `local/trpc-shared-output-schema` |
| `bun run codemod:structured-logging-fix -- --check` / `-- [--dry-run] <file>` / `-- --all` | Maintainability, architecture fitness | Computational | Agents guessing safe structured log rewrites or leaving seed scripts on direct console output | Manual, before edit | `local/structured-logging` |
| `bun run codemod:concurrency-guard -- --check` / `--all` / `<file>` | Architecture fitness, behavior | Computational | Agents bypassing existing race-sensitive helper boundaries or drifting helper internals; name-based only, so aliases/destructuring still need review | Manual, after concurrency-sensitive edits | Restricted Prisma delegate types, `RawTxClient` lint |
| Future codemods in `scripts/codemods/` | Maintainability, architecture fitness | Computational | Agents hand-editing known migration shapes | Manual, before edit | Matching lint with repair command |
| `bun run code:intel -- ...` (`docs/guides/code-intel.md`, skill `ts-graph`) | Maintainability, architecture fitness | Computational | Noisy `rg` archaeology for definitions, dependents, exports, references, and nearby tests | Manual, during exploration | Future graph/drift sensors |

## Sensors

- TypeScript ESLint strict opt-ins now enabled at `error`: `consistent-type-exports`, `prefer-readonly`, and `switch-exhaustiveness-check`.
- Local rule principles: see `docs/generated/local-lint-rules.md`
  (generated; refresh with `bun run docs:lint-guidance`).

| Sensor | Category | Mode | Catches | Timing / command | Paired guide |
|---|---|---|---|---|---|
| TypeScript build | Maintainability, architecture fitness | Computational | Type, project-reference, and restricted-delegate violations | `bun run typecheck`, `bun run verify:changed` | `AGENTS.md`, `docs/CONCURRENCY.md` |
| ESLint core rules | Maintainability | Computational | Complexity, function size, import sorting, unused/useless assignments, caught-error preservation, promise executor returns, post-await shared-state writes, console use | `bun run lint`, `bun run lint:changed` | `eslint.config.js`, `docs/CONCURRENCY.md` |
| `eslint-plugin-jsx-a11y` client JSX lint | Behavior, maintainability | Computational | Client TSX accessibility drift: invalid anchors, unlabeled controls, non-keyboard click handlers, invalid ARIA/roles, autofocus regressions, and missing media/heading/link semantics | `bun run lint`, `bun run lint:changed` | `eslint.config.js`, Leaf 5 jsx-a11y inventory |
| `eslint-plugin-react` client JSX correctness subset | Behavior, maintainability | Computational | Client TSX React correctness drift: missing keys, unstable nested components, non-self-closing empty elements, array-index keys, and unused prop surface | `bun run lint`, `bun run lint:changed` | `eslint.config.js`, Leaf 13 react-plugin inventory |
| `@tanstack/eslint-plugin-query` client lint | Behavior, maintainability | Computational | TanStack Query drift: query functions missing key dependencies, unstable query or mutation objects in React dependency arrays, unstable `QueryClient` construction, void query functions, and infinite/mutation option ordering mistakes | `bun run lint`, `bun run lint:changed` | `eslint.config.js`, Leaf 6 TanStack Query inventory |
| `eslint-plugin-react-hooks` recommended-latest client lint | Behavior, maintainability | Computational | React 19 / compiler-era hook drift: invalid hook calls/deps, ref reads or writes during render, dynamic component selection, purity, immutability, memoization, globals, gating, and unsupported syntax; `set-state-in-effect` remains deferred by verdict | `bun run lint`, `bun run lint:changed` | `eslint.config.js`, Leaf 14 react-hooks inventory |
| `eslint-comments/*` suppression hygiene | Maintainability | Computational | Disable/enable comments missing descriptions, duplicate disables, unlimited broad disables, aggregating enables, and plugin-detected stale disables | `bun run lint`, `bun run lint:changed` | Rule diagnostic, `eslint-disable-register` |
| ESLint `reportUnusedDisableDirectives` | Maintainability | Computational | Stale `eslint-disable*` directives that no longer suppress an active diagnostic | `bun run lint`, `bun run lint:changed` | Rule diagnostic, `eslint-disable-register` |
| `local/max-lines` | Maintainability | Computational | Source/helper modules over the 300 effective-line default, with targeted warning caps for accepted larger files | `bun run lint`, `bun run lint:changed` | Rule diagnostic, override comments in `eslint.config.js` |
| `local/no-explicit-any` | Maintainability | Computational | Explicit `any` usage without a deliberate line-level suppression reason | `bun run lint`, `bun run lint:changed` | Rule diagnostic, `eslint-disable-register` |
| `local/no-llm-artifacts` | Maintainability | Computational | Leftover AI editing comments, bare TODO comments without tracking references, and exact incomplete implementation throws | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| `local/no-async-array-callbacks` | Behavior, maintainability | Computational | Async callbacks passed to array methods that drop promises or treat promises as predicates, while preserving Promise-combinator async map shapes | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| `local/no-swallowed-errors` | Behavior, maintainability | Computational | Catch blocks whose executable body only logs to `console.log`, `console.warn`, `console.error`, or `console.debug` and then continues | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| `local/no-barrel` | Architecture fitness, maintainability | Computational | `index.ts(x)` re-export barrels, with a repair command for source-import expansion | `bun run lint`, `bun run lint:changed` | `codemod:expand-barrel`, `docs/agent_notes/finished_work/expand-barrel-codemod.md` |
| `local/strict-trpc-input` | Architecture fitness | Computational | Inline router `.input(z.object(...))` schemas that omit `.strict()` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-require-output-schema` | Architecture fitness | Computational | Router queries/mutations missing `.output(schema)` before `.query(...)` or `.mutation(...)` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-shared-input-schema` | Architecture fitness | Computational | Router `.input(...)` schemas not imported from `@musi/shared/schemas/...` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-shared-output-schema` | Architecture fitness | Computational | Router `.output(...)` schemas not imported directly from `@musi/shared/schemas/...` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/strict-shared-schemas` | Architecture fitness | Computational | Input schemas allowing unknown keys at package boundaries | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/structured-logging` | Maintainability, architecture fitness | Computational | Server code bypassing structured logging or direct `console.*` in server/seed code | `bun run lint`, `bun run lint:changed` | `codemod:structured-logging-fix` |
| `local/test-file-location` | Maintainability | Computational | Tests landing away from the code they cover | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| Shared schema barrel import ban | Architecture fitness | Computational | Imports from removed `@musi/shared/schemas` barrel | `bun run lint`, `bun run lint:changed` | Future schema-import codemod |
| Shared/client socket import restrictions | Architecture fitness | Computational | `packages/shared` depending on app/runtime adapters, or client code constructing a second Socket.io client outside `SocketProvider` | `bun run lint`, `bun run lint:changed` | `AGENTS.md`, `docs/socket-architecture.md` |
| `local/concurrency-guard` | Architecture fitness, behavior | Computational | Direct `.update`, `.updateMany`, `.updateManyAndReturn`, or `.upsert` calls on concurrency-gated Prisma delegates outside mutation helpers | `bun run lint`, `bun run lint:changed` | `docs/guides/add-race-sensitive-mutation.md` |
| `RawTxClient` restricted import | Architecture fitness, behavior | Computational | Race-sensitive Prisma write escape outside `utils/*-mutations.ts` | `bun run lint`, `bun run lint:changed` | `docs/CONCURRENCY.md` |
| Restricted Prisma delegate types | Architecture fitness, behavior | Computational | Direct `.update`, `.updateMany`, `.updateManyAndReturn`, or `.upsert` on gated tables | `bun run typecheck` | `docs/CONCURRENCY.md` |
| App-router output coverage test | Architecture fitness | Computational | tRPC queries/mutations missing non-permissive `.output(schema)` | `bun run test:server`, `bun run verify:changed` when selected | `docs/guides/add-trpc-procedure.md` |
| Vitest test-structure lint (`vitest/no-focused-tests`, `vitest/no-disabled-tests`, `vitest/no-identical-title`, `vitest/no-commented-out-tests`, `vitest/valid-describe-callback`, `vitest/valid-title`) | Maintainability, behavior | Computational | Focused, disabled, duplicate, commented-out, malformed, or ambiguously named Vitest tests in non-e2e unit/integration files | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| Vitest assertion/import lint (`vitest/expect-expect`, `vitest/valid-expect`, `vitest/valid-expect-in-promise`, `vitest/no-standalone-expect`, `vitest/no-unneeded-async-expect-function`, `vitest/no-import-node-test`, `vitest/no-mocks-import`, `vitest/no-interpolation-in-snapshots`, `vitest/require-local-test-context-for-concurrent-snapshots`, `vitest/prefer-called-exactly-once-with`, `vitest/prefer-comparison-matcher`, `vitest/prefer-equality-matcher`, `vitest/prefer-to-contain`) | Behavior, maintainability | Computational | Vitest tests with missing or invalid assertions, unsafe standalone/async expect usage, wrong test imports, mock/snapshot footguns, weak single-call assertions, and zero-baseline matcher drift | `bun run lint`, `bun run lint:changed` | Rule diagnostic and local test helpers |
| Vitest unit/integration tests | Behavior | Computational | Regressions covered by server, client, shared, and script tests | `bun run test`, `bun run test:changed`, `bun run verify:changed` | Area docs and test helpers |
| Playwright e2e | Behavior | Computational | Browser workflow regressions | `bun run e2e`, Stop hook when cached/failing | `playwright-cli` skill |
| `local/e2e-prefer-role-selectors` | Behavior | Computational | New raw CSS locator use in e2e files when a role, label, text, or test-id selector should be used instead | `bun run lint:changed` | `docs/guides/add-e2e-test.md` |
| `eslint-plugin-playwright` rules | Behavior | Computational | Missing Playwright awaits, focused or skipped tests, discouraged waits, and other e2e hygiene drift | `bun run lint:changed` | `docs/guides/add-e2e-test.md` |
| `verify` / `verify:changed` wrapper | Maintainability, architecture fitness, behavior | Computational | Lint, typecheck, and test failures with shared cache/lock/logs | `bun run verify:changed` | `AGENTS.md` |
| `verify:logs` | Maintainability | Computational | Hidden or stale verification failures in cached logs | `bun run verify:logs` | Stop-policy prompts |
| `doctor` | Architecture fitness, maintainability | Computational | Worktree, DB, env, port, dependency, lint-suppression, and migration-safety drift | `bun run doctor` | `bun run worktree:*` scripts, `docs/guides/add-prisma-migration.md` |
| knip unused-code sensor | Maintainability | Computational | Workspace-unused files, exports, types, and dependencies | `bun run sensor:knip`, `bun run doctor` | `knip.config.ts` |
| staged blob-size sensor | Maintainability | Computational | Staged files over 500 KiB / 5 MiB thresholds unless allowlisted with a reason | `bun run sensor:blob-size`, via `doctor` | `.blob-size-allowlist` |
| `db:status` | Architecture fitness | Computational | Migration, Prisma client, and DB connectivity drift | `bun run db:status`, via `doctor` | `docs/guides/add-prisma-migration.md` |
| `db:migration-safety` | Architecture fitness, behavior | Computational | Destructive or risky Prisma migrations lacking acknowledgement | `bun run db:migration-safety`, via `doctor` | `docs/guides/add-prisma-migration.md` |
| `module:index:check` | Maintainability | Computational | Module doc index drift | `bun run module:index:check` | `docs/module-docs.md` |
| `eslint-disable-register` | Maintainability | Computational | New suppressions without `-- reason` text or broad disables outside the file/rule allowlist | Via `doctor`, script smoke tests | Register diagnostic |
| `suppression-register` | Maintainability | Computational | Current-state TypeScript and Stryker suppressions missing `-- reason`, deprecated `@ts-ignore`, `@ts-nocheck` outside allowlist, or broad Stryker disables; report-only in Leaf 16 v1 | Manual: `bash scripts/suppression-register.sh /workspace`, script smoke tests | Leaf 16 suppression baseline |
| AI hook adapters | Maintainability, architecture fitness | Computational | Protected-file edits, doc bloat, stale Prisma client risk, noisy command output, uncommitted stop state | Claude/Codex hooks | Adapter Boundary section above |
| Stop-hook cached-verify replay | Maintainability, architecture fitness, behavior | Computational | Agents stopping with the most recent `verify:changed` / pre-commit run still red, when its wrapper meta still matches the worktree | Stop hook (reads `$LOG_DIR/meta/wrapper.json`) | `verify` / `verify:changed` wrapper |
| Script smoke tests | Maintainability | Computational | Hook, verify, worktree, module-index, migration-safety, and script wrapper regressions | `bun run test:scripts`, `bun run verify` | `scripts/` comments and shell tests |
| Worktree drift/status checks | Architecture fitness | Computational | Secondary worktree DB, port, Redis, and SRD seed drift | `bun run worktree:status`, `doctor` | `bun run worktree:*` scripts |
| `local/socket-registry-broadcasts` | Architecture fitness, behavior | Computational | Registry-owned events emitted directly outside `broadcast-registry.ts` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-socket-broadcast.md` |
| `local/no-broadcast-in-transaction` | Architecture fitness, behavior | Computational | Socket broadcast helpers called inside Prisma `$transaction` callbacks instead of after commit | `bun run lint`, `bun run lint:changed` | `docs/guides/add-socket-broadcast.md` |
| Mutation testing | Behavior | Computational | Tests that execute rules code without proving meaningful behavior | Manual: `bun run test:mutation` | `docs/agent_notes/backlog/mutation-testing-stryker.md` |
| `drift:ai harness-freshness` | Maintainability | Computational | `docs/ai-harness.md` guide inventory drift: unreferenced `docs/guides/*.md`, missing referenced guides, and stale backtick repo paths | `bun run drift:ai harness-freshness`, via `doctor` | This map |
| `drift:ai module-doc-paths` | Maintainability | Computational | Stale backtick file references in `MODULE.md` / `*-MODULE.md` notes (path existence only; multi-base resolution, precision over recall); opt-in, report-only | Manual: `bun run drift:ai --check module-doc-paths` (or `--check all`) | `scripts/drift-ai/README.md`, `MODULE.md` files |
| `drift:ai` default report | Maintainability, architecture fitness | Computational | AI-specific drift on changed files: copy/paste duplicates, suspicious sibling modules, over-narrated comments, and newly added suppression comments; repo-specific roots and exclusions live in `drift-ai.config.json` | Manual, report-only by default: `bun run drift:ai` (filter with `--check`; pass `--config <path>` to test another config) | `scripts/drift-ai/README.md`, `drift-ai.config.json` |
| `drift:ai` opt-in checks | Maintainability, architecture fitness | Computational | Slower whole-graph AI-drift signals: commented-out code blocks, stale module-doc paths, knip-backed orphan files / duplicate export aliases / unused exports, TypeScript import cycles, server layer-direction reverse imports, AST-similar near-duplicate functions, and duplicate type/schema/literal/constant shapes | Manual, report-only by default: `bun run drift:ai --check commented-out-code`, `--check module-doc-paths`, `--check orphan-files`, `--check knip-duplicates`, `--check import-cycles`, `--check layer-direction`, `--check near-duplicates`, `--check duplicate-types`, `--check duplicate-schemas`, `--check duplicate-literals`, `--check duplicate-constants`, `--check unused-exports`, or `--check all` | `scripts/drift-ai/README.md`, target `knip` / `tsconfig` |
| `drift:ai hotspots` | Maintainability | Computational | Advisory git-history hotspots: churn, coupling, fragmentation, suppression-churn, and thrash lenses; areas to inspect, not defects | Manual advisory: `bun run drift:ai hotspots --lens all` | `scripts/drift-ai/README.md` |
| `drift:ai coldspots` | Maintainability | Computational | Advisory git-history coldspots: low-churn source files and stale-marker lines that may need a human look; areas to inspect, not defects | Manual advisory: `bun run drift:ai coldspots --lens all` | `scripts/drift-ai/README.md` |
| `harness:audit` fusion | Maintainability | Computational | Read-only fusion of `HarnessDiagnostics` envelope files (`lint:ratchet`, `drift:ai`, `logs:audit`) into one bounded report grouped by tool, with totals and per-control counts; an artifact generator for scheduled/manual review, not an edit-loop gate (findings never gate; only unreadable/malformed envelopes exit non-zero) | Manual: run a producer with `HARNESS_DIAGNOSTICS_OUTPUT=<path>`, then `bun run harness:audit <path...>` (`--format text\|json`, `--output <file>`). Scheduled weekly: `.github/workflows/slow-drift.yml` runs `bash scripts/slow-drift-audit.sh` and uploads fused artifacts. | `scripts/harness-audit.ts`, `scripts/slow-drift-audit.sh`, `packages/shared/src/schemas/harness-diagnostics.ts` |
| Future approved behavior fixtures | Behavior | Computational | Generated tests proving the wrong shape or missing reviewed scenario data | Targeted Vitest suites | Domain docs, SRD reference |
| Future slow drift reports | Maintainability, architecture fitness | Computational | Stale module docs, flake trends, layer drift, and other drift reports not already covered by `drift:ai` or existing sensors | `doctor`, CI, scheduled, or manual | This map |
| Future project-specific reviewer | Architecture fitness, behavior | Inferential | Semantic drift not expressible as deterministic checks | Manual after deterministic checks pass | This map and area docs |

For `drift:ai`, `--scope current` audits the current whole repo instead of the
default diff against `main`. `--check all` enables the slower opt-in checks;
without `--check`, the default set is tuned for routine changed-file review.
Use `--chunk-dir <path>` and optional `--chunk-size <n>` for AI handoff; the
primary report remains complete and chunks are additive. Reports exit `0` by
default even with findings; `--fail-on-findings` is the explicit gate mode.
The harness control inventory groups the default drift checks under
`drift-scope/changed` and `drift-scope/current`, gives each opt-in drift check
and promoted advisory subcommand its own control, and intentionally omits
prototype-lane `drift:ai` advisory subcommands until a lens is promoted.

## Slow Drift Schedule

`.github/workflows/slow-drift.yml` runs weekly and on manual
`workflow_dispatch`. It calls `bash scripts/slow-drift-audit.sh`, which writes:

- producer envelopes to `reports/slow-drift/envelopes/`;
- producer stdout/stderr captures to `reports/slow-drift/producers/`;
- fused `harness:audit` text and JSON reports to `reports/slow-drift/fused/`.

GitHub uploads those paths as `slow-drift-producer-envelopes`,
`slow-drift-producer-output`, and `slow-drift-fused-reports`. The default
scheduled producers are `lint:ratchet` and `drift:ai --scope current --check
all`. `logs:audit` joins the same fusion path when the driver receives
newline-separated runtime JSONL paths through `MUSI_SLOW_DRIFT_LOG_FILES`; the
scheduled CI job skips it by default because that job does not collect runtime
server logs.

Findings are report-only. Producer exit `1` still produces artifacts and
continues to fusion; unreadable envelopes, missing sidecars, and setup/tool
errors remain infrastructure failures.

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

- Behavior confidence is still weaker than maintainability and architecture
  fitness. Continue adding reviewed scenario fixtures for Character Live-State
  and other high-risk workflows as they are scoped.
- Diagnostics are partly human text. `lint:ratchet`, `drift:ai`, and
  `logs:audit` now emit the shared `HarnessDiagnostics` envelope
  (`HARNESS_DIAGNOSTICS_OUTPUT=<path>`), and `bun run harness:audit` fuses those
  envelope files into one report (text or JSON). `verify:logs`, `doctor`,
  `module:index:check`, migration safety, and the script smoke tests still emit
  only human text; adding the envelope there would let `harness:audit` (or
  future hooks or dashboards) combine every signal without parsing prose.
- Slow drift now has a weekly fused artifact for `lint:ratchet` plus
  current-scope `drift:ai --check all`. Remaining slow-lane gaps include runtime
  JSONL capture for `logs:audit`, changed behavior without nearby tests, scoped
  mutation testing for `packages/shared/src/rules/`, and flake/timing trends.

## Promotion Rule

When adding a new harness control, add or update all three pieces where they
apply:

1. A guide that explains the intended path.
2. A sensor that detects drift from that path.
3. Repair text or a codemod that tells an agent exactly how to recover.

Do not add more global instructions to `AGENTS.md` unless every agent needs
them on every session start.
