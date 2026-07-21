# AI Harness

Musi's AI harness is the repo-owned support system around coding agents. Keep
this file as an inventory and gap map, not a design essay. First visit? Start
with the [15-minute harness tour](harness-tour.md) before this inventory.

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

## Report-Only Sensor Lifecycle

For gate-candidate sensors — checks that exist to eventually block a class
of drift — report-only is a stage, not a destination: a warning agents can
ignore becomes background noise, and unearned sensors erode the whole
report surface. Some sensors are instead deliberately terminal advisories
and never candidates for gating — the inventory below marks `drift:ai
hotspots`/`coldspots` as "areas to inspect, not defects" and `harness:audit`
as an artifact generator whose findings never gate. Terminal advisories are
exempt from promotion pressure but still answer to the noise budget. Every
gate-candidate report-only sensor follows this lifecycle:

- **Entry**: a new broad or judgment-heavy sensor starts report-only outside
  the edit loop, with the drift it is supposed to catch stated in its
  inventory row below and its repair text drafted up front.
- **Observation**: run it report-only through roughly 2-4 weeks of normal
  work or about 10 real invocations before deciding anything. During
  observation nothing may treat its findings as blocking.
- **Noise budget**: a finding an agent correctly ignores is noise — false
  positives, duplicates of another sensor's report, or debt nobody will act
  on. More than roughly 1 ignorable finding in 5 puts the sensor over budget:
  narrow its scope or sharpen its detection before the next review.
- **Promotion**: promote to a gate only when the Timing rule holds for the
  tier the check will gate in — low noise, clear repair text, and fast enough
  for that tier (edit-loop and pre-commit gates must be fast; slower checks
  can gate only in CI) — and observation produced findings that were actually
  fixed. Promotion is per-check, not per-tool: `drift:ai`'s runtime
  import-cycle floor gates in lint while its sibling checks remain
  report-only.
- **Demotion, retention, or deletion**: a sensor still over budget after one
  narrowing attempt, or whose findings nobody acted on across an observation
  window, moves down a stage — gate back to report-only, report-only to
  deleted. A sensor whose reports are read and useful but that should never
  gate may instead exit the lifecycle as a terminal advisory — record that
  disposition in its inventory row (as the hotspots, coldspots, and
  `harness:audit` rows do) so it stops counting as a stalled gate candidate.
  Record any demotion and its evidence in the inventory row or the sensor's
  README. Deleting a sensor that never earned trust is a harness improvement,
  not a loss.

## Adapter Boundary

Shared hook policy and reusable behavior belong in `scripts/ai-hooks/`. The
per-harness files under `.claude/hooks/`, `.codex/hooks/`, and
`.copilot/hooks/` are shims: resolve the repo root, translate only the
harness-specific payload or response shape, then run the shared body. The
Bash-surface aggregates (`scripts/ai-hooks/bash-pre-tool-use.sh` and
`bash-post-tool-use.sh`) group several Bash policies behind one hook entry for
Codex and Copilot; Claude uses direct Bash adapters for the same policy
surfaces. Copilot shims translate through
`scripts/ai-hooks/copilot-adapter.sh` because Copilot's payloads, response
schema, and native matcher behavior differ, with adapter-side toolName filters
kept as defense in depth.

Hook registration is generated from `harness.controls.json`. The generator at
`scripts/harness/generate-hook-wiring.ts` replaces the `hooks` key in
`.claude/settings.json`, writes `.codex/hooks.json` and
`.github/hooks/copilot.json`, and emits every adapter shim under
`.claude/hooks/`, `.codex/hooks/`, and `.copilot/hooks/` from per-adapter
templates (`scripts/harness/hook-shims.ts`), reconciling orphans away when a
manifest entry is removed. `bun run harness:check` runs the generator's
`--check` mode, which byte-compares configs and shims and asserts shim file
type and executable bits. Deliberate harness gaps must be recorded in the
manifest notes, which render into `docs/generated/harness-controls.md`, not
explained only by leaving an adapter unwired.

Cursor is a checked exclusion from that hook inventory. Cursor currently has
no repository `PreToolUse` (or equivalent policy) API, while
`agent-cli work cursor` must launch headless Cursor with `--force`, which gives
the run unrestricted shell access. `harness:check` rejects any `cursor` entry
under `hookWiring.harnesses`; adding Cursor to a hook surface requires revisiting
this exclusion against a real product hook API.

Implementation details for shim headers, shared bodies, `hookWiring`, verify
slots, and porting assumptions live in `scripts/ai-hooks/README.md`.

Shared skills are also inventoried in `harness.controls.json` as `skill`
controls. Each `skillWiring` entry names the canonical tree, harness targets,
gitignore opt-ins, smoke subjects, and narrow permitted overlays. Exact bytes
are the default. `harness:check` performs a bounded filesystem scan of the
immediate children under `.claude/skills/` and `.codex/skills/`, including
ignored local directories, and rejects an uninventoried skill tree. Mirror
comparison fails closed on symlinks, requires real opening and closing
frontmatter delimiters before applying a field overlay, and rejects forbidden
overlay paths even when their bytes match. Metadata files and smoke/gitignore
surfaces remain inventoried as well.

When changing shared behavior, update `scripts/ai-hooks/` first. The thin
shims themselves are generated projections — never edit one by hand. When the
harness payload shape requires a shim-side change, adjust the `hookWiring`
entries in `harness.controls.json` (or the per-adapter templates in
`scripts/harness/hook-shims.ts`) and rerun `bun run harness:wiring`. If a hook
body is intentionally harness-specific, keep that fact in
`harness.controls.json` so the generated wiring and docs stay aligned.

## Public Archive Boundary

Public source archives include the copyable harness config that
`harness.controls.json` and `docs/generated/harness-controls.md` reference:
`.claude/settings.json`, `.claude/hooks/`, `.claude/output-styles/`,
`.claude/skills/`, `.codex/config.toml`, `.codex/hooks.json`,
`.codex/hooks/`, `.codex/skills/`, and `.copilot/hooks/`. They also include
`docs/generated/lint-coverage-map.md` and
`docs/generated/observed_flaky_tests.md`, because generated and hook-facing
harness docs point at those references.

Other `docs/agent_notes/**` files remain process notes and are export-ignored.
Use a full git clone, not a generated source archive, when you need backlog
packs, recent-history notes, or decision logs.

## Portable Core And Adapters

This map describes the current copy boundary. It is not a package boundary yet:
the files below still live in Musi's repo, and later behavior-preserving splits
are deferred until an external adopter needs them.

**Portable core** is the harness machinery that should carry to another
TypeScript repo with limited policy edits:

- The diagnostics envelope and fusion path:
  `packages/shared/src/schemas/harness-diagnostics.ts`,
  `scripts/harness/harness-diagnostics-output.ts`,
  `scripts/harness-audit.ts`, and
  `scripts/harness/harness-audit-report.ts` — plus the CLI substrate
  they parse through: `scripts/lib/cli.ts` (spec-driven `parseCli`
  with a structural schema contract) and its value reader
  `scripts/cli-option-values.ts`. The pair copies together —
  `cli.ts` imports that sibling reader and nothing else, so the
  substrate carries no package imports; the per-tool option schemas
  use Zod, which the envelope schema already requires, so the copy
  set gains no new dependency.
- The lint-ratchet engine under `scripts/lint-ratchet/` plus the
  `scripts/lint-ratchet.ts` entrypoint. The current registry still contains
  Musi-specific rules; use `docs/guides/lint-ratchet-adoption.md` for the
  adopter copy recipe and replacement points.
- The hook and control wiring machinery:
  `scripts/harness/generate-hook-wiring.ts`,
  `scripts/harness/hook-wiring-schema.ts`,
  `scripts/harness/generate-harness-controls.ts`,
  `scripts/harness/generate-verify-steps.ts`, and
  `scripts/harness/verify-step-schema.ts`.
- Reusable shell helpers for hook state, caching, bounded output, and wiring
  checks: `scripts/ai-hooks/cache.sh`,
  `scripts/ai-hooks/throttle-state.sh`,
  `scripts/ai-hooks/output-filter.sh`,
  `scripts/ai-hooks/check-wiring.sh`, and the shared sourcing helper
  `scripts/ai-hooks/common.sh`.

**Musi adapters** are this repo's instantiation of that machinery. Treat these
as examples to replace, not portable policy:

- Concrete ratchet registry entries and path globs in
  `scripts/lint-ratchet/lint-ratchet-config.ts`,
  `scripts/lib/max-lines-policy.ts`, and
  `eslint-config/shared-policy.js`.
- The concrete controls manifest in `harness.controls.json` and its generated
  output in `docs/generated/harness-controls.md`.
- Repo-specific hook policy files such as `scripts/ai-hooks/policy.sh`,
  `scripts/ai-hooks/protected-files.sh`, `scripts/ai-hooks/no-direct-db.sh`,
  `scripts/ai-hooks/prisma-generate.sh`,
  `scripts/ai-hooks/bun-run-quiet.sh`,
  `scripts/ai-hooks/session-state.sh`, and
  `scripts/ai-hooks/stop-policy.sh`.
- Harness shims and registrations under `.claude/`, `.codex/`, `.copilot/`,
  and `.github/hooks/copilot.json`.

**App code** is not part of the copyable harness. Musi's packages, Prisma
schema, SRD data, campaign/VTT domain code, module docs, and product tests are
evidence for how the harness is used, but adopters should not copy them to get
the harness running.

Minimal starter:

1. Copy the diagnostics envelope schema plus
   `scripts/harness/harness-diagnostics-output.ts`,
   `scripts/harness-audit.ts`, and
   `scripts/harness/harness-audit-report.ts`.
2. Add one producer that writes `HARNESS_DIAGNOSTICS_OUTPUT`, either by
   adopting `lint:ratchet` or by wrapping an existing check.
3. Add a `harness:audit` package script that runs
   `bun scripts/harness-audit.ts` over one or more envelope files.

Advanced controls starter:

1. Copy `harness.controls.json` as a template, then delete Musi controls before
   filling in the target repo's policy.
2. Copy the hook wiring and generated-doc scripts listed in portable core.
3. Copy only the harness shims the target tools need, then replace local hook
   policy with the target repo's branch, database, command, and protected-path
   rules.

Public source archives are enough for the `.claude/`, `.codex/`,
`scripts/ai-hooks/`, `scripts/harness/`, `scripts/lint-ratchet/`, diagnostics
schema, and manifest paths named above. They are not enough for backlog notes;
use a full clone for `docs/agent_notes/backlog/**`.

## Substrate Ruling (Bash Vs TS)

The bash/TS boundary is a ruling, not author preference. New or reworked
harness tools pick their substrate by these rules:

- **Portable-skill surfaces stay single-file, dependency-free bash.** Anything
  under `.claude/skills/**` meant to be copied into another repo (for example
  `agent-run.sh`) must run before `bun install` in a fresh worktree or a
  foreign repo, so it cannot depend on the TS toolchain.
- **Repo-local gate orchestration stays bash, sharing engine libraries.**
  `scripts/verify.sh`, `.husky/pre-commit`, `scripts/land.sh`, and the hook
  entrypoints under `scripts/ai-hooks/` are process glue — traps, locks,
  markers, watchdogs. They remain bash but must share extracted engine libs
  rather than duplicating blocks (arch-review leaf 10 owns that extraction).
- **Anything analytical lives in TS.** Parsing, comparing, reporting, policy
  evaluation, and data transformation belong under `scripts/` in TS, reachable
  from bash via `bun` entrypoints. A bash tool that grows analysis logic (the
  831-line `doctor.sh` is the cautionary example) should shed that logic to
  TS.
- **Duplicates across the boundary are defects.** One substrate owns a
  behavior; the other calls it. The DB-status diagnostic was the known
  shell/TS duplicate; arch-review leaf 17 retired the shell copy and kept the
  TS implementation under this rule.

Recorded exception (2026-07-19): three hook- and CLI-local run-meta readers
stay outside the TS codec (`scripts/lib/verify-metadata-core.ts`) — the
`.husky/pre-push` jq verify-evidence fallback readers
(`musi_pre_push_json_string`/`_int`), `scripts/verify-logs.sh`'s jq display
queries, and `scripts/ai-hooks/stop-policy.sh`'s awk readers
(`ai_stop_verify_meta_string`/`_int`). Rationale and measured latency numbers:
`docs/agent_notes/backlog/arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md`
(S2 record). Revisit all three together only if a defect is traced to one.

Recorded rejection: a full Bun/TS rewrite of
`.claude/skills/agent-cli/scripts/agent-run.sh` was considered and rejected
(2026-07-07) under the copyability lens — a `.sh` must run before
`bun install` in a fresh worktree, and the skill stays self-contained. The
backend-adapter-table work shrank the bash instead. Do not re-litigate the
rewrite without a new constraint that defeats the copyability argument.

## Green-Output Policy

Actionable red output is the harness's scarce signal; green paths stay quiet
by default. Every success line a hook or gate emits to the agent must earn its
place as one of:

- **Required command output** — the summary that replaces deliberately
  suppressed verbose output (`<script> OK (Ns) - full log: …`,
  `Commit succeeded: …`, the verify `OK (Ns) — <slots>` banner) or the
  load-bearing rows of a diagnostics command (`verify:logs`).
- **Backpressure confirmation** — a "this already happened, do not retry"
  note: `cached OK … FORCE_VERIFY=1 to re-run`, `already verified … skipping`,
  the fast-commit `slots skipped` suffix, `async verify: running`, tidy
  `skipped (<reason>)`. These prevent redundant re-runs and stay.
- Anything else is chatter and should be removed or kept off the agent
  channel (stderr/log file only).

Hook bodies are silent-on-green by construction (`ai_emit_continue` with no
message); intentional backpressure strings are pinned by the ai-hooks and
verify smokes so a cleanup cannot drop them by accident — with one known
exception: `verify.sh`'s `nothing to verify` guidance is not yet pinned
(follow-up #2 in the audit note). Inventory and per-line classification:
`docs/agent_notes/finished_work/green-output-backpressure-audit-2026-07.md`.

## Guides

Always-loaded workflow rules belong in `AGENTS.md`. Output styles can shape
tone and verbosity, but they must not be the only home for policy that every
agent or contributor needs every session.

Musi's `MODULE.md` / `*-MODULE.md` convention is the repo-local equivalent of
nested `AGENTS.md` orientation files. Root `AGENTS.md` instructs agents to read
the nearest module doc before scoped edits, and `MODULE-INDEX.md` provides the
generated map. Projects copying this harness for agents that only use native
nested-`AGENTS.md` discovery should generate tiny `AGENTS.md` pointers to the
module docs; Musi leaves those stubs out until an active agent in this repo
needs them.

| Guide | Category | Mode | Prevents | Timing | Paired sensor |
|---|---|---|---|---|---|
| `AGENTS.md` | Maintainability, architecture fitness, behavior | Inferential | Agents missing global repo rules, workflow, and domain constraints | Session start | `verify:changed`, pre-commit, `doctor` |
| `docs/guides/verify-gate-lifecycle.md` | Maintainability | Inferential | Contributors and adopters treating the commit gate as an opaque exit code instead of generated slots with structured repair feedback | First-contact harness tour or gate troubleshooting | `verify` / `verify:changed` wrapper, pre-commit |
| `docs/agent_notes/README.md`, `docs/agent_notes/LOG.md`, and `docs/agent_notes/backlog/README.md` | Maintainability | Inferential | Agents treating pruned notes as active work or preserving excessive history | On demand | Stop-hook dirty-work user warning |
| `docs/architecture-plan.md` | Architecture fitness | Inferential | Cross-package and stack-level changes drifting from planned architecture | Manual, area-specific | Typecheck, tests, future graph checks |
| `docs/adr/README.md` and accepted ADRs | Architecture fitness, behavior | Inferential | Non-obvious architectural gates losing their stable rationale, lifecycle, or deterministic cross-links | Architecture decisions and gate changes | `bun run adr:check` |
| `docs/authorization.md` | Architecture fitness, behavior | Inferential | Auth mismatch semantics, especially intentional `NOT_FOUND`, being reimplemented incorrectly | Area-specific | Auth/router tests |
| `docs/socket-architecture.md` | Architecture fitness, behavior | Inferential | Socket.io being used for writes, unregistered broadcast behavior, or broadcasts before commit | Area-specific | ADR-0003, broadcast registry tests, `local/socket-registry-broadcasts`, `local/no-broadcast-in-transaction` |
| `docs/CONCURRENCY.md` | Architecture fitness, behavior | Inferential | Race-sensitive writes bypassing locked mutation helpers | Area-specific | ADR-0001, restricted Prisma types, `local/concurrency-guard`, RawTxClient lint |
| `MODULE.md` / `*-MODULE.md` files | Maintainability, architecture fitness | Inferential | Agents editing a module without its local interface, flows, and invariants | Area-specific | `module:index:check`, future doc-freshness sensor |
| `docs/module-docs.md` | Maintainability | Inferential | Module notes drifting into inconsistent shape | When adding or refreshing module docs | `bun run module:index:check` |
| `docs/guides/add-module-doc.md` | Maintainability | Inferential | Agents adding or refreshing module docs without the charter, `Concepts:` breadcrumb, index refresh, and verification recipe | When adding or refreshing module docs | `bun run module:index:check`, `scripts/tests/test-generate-module-index.sh` |
| `docs/guides/coverage-cadence.md` | Maintainability, behavior | Inferential | Agents turning coverage into an edit-loop gate or missing the manual baseline cadence | Manual, weekly | `bun run test:coverage` |
| `docs/guides/per-worktree-dev.md` | Maintainability | Inferential | Agents running a secondary worktree without its provisioned DB, ports, Redis, and env files | When working in a secondary worktree | `bun run worktree:init`, `bun run doctor` |
| `docs/guides/local-eslint-rules.md` | Maintainability | Inferential | Agents adding local ESLint diagnostics outside the repo's message guidance convention | When editing `eslint-rules/` | `eslint-rules/message-guidance.test.js` |
| `docs/guides/lint-overview.md` | Maintainability | Inferential | Agents changing the lint system's parts without the architecture map and rationale that orient them | When editing lint config or rules | `bun run lint` |
| `docs/guides/lint-ratchet.md` and `docs/guides/lint-ratchet-adoption.md` | Maintainability | Inferential | Agents changing ratchets without preserving baseline lifecycle, registry checks, and adopter-facing assumptions | When editing ratchet config or docs | `bun run lint:ratchet`, `bun run lint:ratchet:zero-baseline` |
| `docs/guides/biome-lint-adoption.md` | Maintainability | Inferential | Agents treating Biome as a drop-in replacement for the authoritative ESLint/ratchet setup | Manual, external-adopter work | `bun run lint` |
| `.claude/skills/playwright-cli/SKILL.md` and `.codex/skills/playwright-cli/SKILL.md` | Behavior | Inferential | Browser verification being run with the wrong workflow | Manual | Playwright e2e logs and Playwright lint rules |
| `docs/guides/add-e2e-test.md` | Behavior | Inferential | Agents adding e2e tests without the page-object, fixture, selector, and route-exploration recipe | Area-specific | `local/e2e-prefer-role-selectors`, Playwright e2e |
| `docs/guides/add-socket-broadcast.md` | Architecture fitness, behavior | Inferential | Agents adding registry-owned broadcasts without the schema, helper, post-commit timing, or logger recipe | Area-specific | `local/socket-registry-broadcasts`, `local/no-broadcast-in-transaction`, broadcast registry tests |
| `docs/guides/add-trpc-procedure.md` | Architecture fitness, behavior | Inferential | Agents adding router procedures without the shared input, output, auth, service, and test recipe | Area-specific | `local/strict-trpc-input`, `local/trpc-require-output-schema`, app-router output coverage test |
| `docs/guides/add-prisma-migration.md` | Architecture fitness, behavior | Inferential | Agents changing Prisma schema without generating, inspecting, applying, and safety-scanning the migration | Area-specific | `db:migration-safety`, `db:status`, `doctor` |
| `docs/guides/add-race-sensitive-mutation.md` | Architecture fitness, behavior | Inferential | Agents adding or changing race-sensitive mutations without the gate, locked helper, conflict semantics, restricted imports, and concurrency test recipe | Area-specific | `local/concurrency-guard`, `RawTxClient` restricted import, Restricted Prisma delegate types |
| `docs/guides/add-client-feature-module-cache-socket.md` | Architecture fitness, behavior | Inferential | Agents adding client feature modules with hand-built query keys, component-local socket listeners, or untested optimistic cache writes | Area-specific | Client hook/component tests, `local/test-file-location` |
| `docs/guides/client-effects.md` | Behavior | Inferential | Agents reaching for a client `useEffect` for derived state, event logic, or data fetching instead of external-system sync | Before adding a client effect | `local` effect lint, client hook/component tests |
| `docs/guides/client-auth-session.md` | Architecture fitness, behavior | Inferential | Agents mishandling the client auth token and session lifecycle | Area-specific | Client auth/session tests |
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
- Complete local-rule catalog and principles: see
  `docs/generated/local-lint-rules.md` (generated; refresh with
  `bun run docs:lint-guidance`). The `local/*` rows below are selected
  operational examples, not a second inventory.

| Sensor | Category | Mode | Catches | Timing / command | Paired guide |
|---|---|---|---|---|---|
| `adr:check` | Architecture fitness, behavior | Computational | Invalid ADR shape or lifecycle, unresolved typed gate locators, missing reverse references, and active gates pointing at superseded decisions | `bun run adr:check`, `verify`, `verify:changed`, `verify:parallel`, pre-commit | `docs/adr/README.md` |
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
| `local/no-llm-artifacts` | Maintainability | Computational | Leftover AI editing comments, TODO comments without a locatable issue/PR id, URL, or `docs/roadmap|agent_notes` path, and exact incomplete implementation throws | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| `local/no-async-array-callbacks` | Behavior, maintainability | Computational | Async callbacks passed to array methods that drop promises or treat promises as predicates, while preserving Promise-combinator async map shapes | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| `local/no-swallowed-errors` | Behavior, maintainability | Computational | Catch blocks whose executable body only logs to `console.log`, `console.warn`, `console.error`, or `console.debug` and then continues | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| `local/no-barrel` | Architecture fitness, maintainability | Computational | `index.ts(x)` re-export barrels, with a repair command for source-import expansion | `bun run lint`, `bun run lint:changed` | `codemod:expand-barrel`, `docs/agent_notes/finished_work/expand-barrel-codemod.md` |
| `local/strict-trpc-input` | Architecture fitness | Computational | Inline router `.input(z.object(...))` schemas that omit `.strict()` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-require-output-schema` | Architecture fitness | Computational | Router queries/mutations missing `.output(schema)` before `.query(...)` or `.mutation(...)` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-shared-input-schema` | Architecture fitness | Computational | Router `.input(...)` schemas not imported from `@musi/shared/schemas/...` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/trpc-shared-output-schema` | Architecture fitness | Computational | Router `.output(...)` schemas not imported directly from `@musi/shared/schemas/...` | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/strict-shared-schemas` | Architecture fitness | Computational | Input schemas allowing unknown keys at package boundaries | `bun run lint`, `bun run lint:changed` | `docs/guides/add-trpc-procedure.md` |
| `local/structured-logging` | Maintainability, architecture fitness | Computational | Server code bypassing structured logging or direct `console.*` in server/seed code | `bun run lint`, `bun run lint:changed` | `codemod:structured-logging-fix` |
| `local/test-file-location` | Maintainability | Computational | Unit-test files with an empty feature prefix or no `describe`/`it`/`test` block | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| Shared schema barrel import ban | Architecture fitness | Computational | Imports from removed `@musi/shared/schemas` barrel | `bun run lint`, `bun run lint:changed` | Future schema-import codemod |
| Shared/client socket import restrictions | Architecture fitness | Computational | `packages/shared` depending on app/runtime adapters, or client code constructing a second Socket.io client outside `SocketProvider` | `bun run lint`, `bun run lint:changed` | `AGENTS.md`, `docs/socket-architecture.md` |
| `local/concurrency-guard` | Architecture fitness, behavior | Computational | Direct `.update`, `.updateMany`, `.updateManyAndReturn`, or `.upsert` calls on concurrency-gated Prisma delegates outside mutation helpers | `bun run lint`, `bun run lint:changed` | ADR-0001, `docs/guides/add-race-sensitive-mutation.md` |
| `RawTxClient` restricted import | Architecture fitness, behavior | Computational | Race-sensitive Prisma write escape outside `utils/*-mutations.ts` | `bun run lint`, `bun run lint:changed` | ADR-0001, `docs/CONCURRENCY.md` |
| Restricted Prisma delegate types | Architecture fitness, behavior | Computational | Direct `.update`, `.updateMany`, `.updateManyAndReturn`, or `.upsert` on gated tables | `bun run typecheck` | ADR-0001, `docs/CONCURRENCY.md` |
| App-router output coverage test | Architecture fitness | Computational | tRPC queries/mutations missing non-permissive `.output(schema)` | `bun run test:server`, `bun run verify:changed` when selected | `docs/guides/add-trpc-procedure.md` |
| Vitest test-structure lint (`vitest/no-focused-tests`, `vitest/no-disabled-tests`, `vitest/no-identical-title`, `vitest/no-commented-out-tests`, `vitest/valid-describe-callback`, `vitest/valid-title`) | Maintainability, behavior | Computational | Focused, disabled, duplicate, commented-out, malformed, or ambiguously named Vitest tests in non-e2e unit/integration files | `bun run lint`, `bun run lint:changed` | Rule diagnostic |
| Vitest assertion/import lint (`vitest/expect-expect`, `vitest/valid-expect`, `vitest/valid-expect-in-promise`, `vitest/no-standalone-expect`, `vitest/no-unneeded-async-expect-function`, `vitest/no-import-node-test`, `vitest/no-mocks-import`, `vitest/no-interpolation-in-snapshots`, `vitest/require-local-test-context-for-concurrent-snapshots`, `vitest/prefer-called-exactly-once-with`, `vitest/prefer-comparison-matcher`, `vitest/prefer-equality-matcher`, `vitest/prefer-to-contain`) | Behavior, maintainability | Computational | Vitest tests with missing or invalid assertions, unsafe standalone/async expect usage, wrong test imports, mock/snapshot footguns, weak single-call assertions, and zero-baseline matcher drift | `bun run lint`, `bun run lint:changed` | Rule diagnostic and local test helpers |
| Vitest unit/integration tests | Behavior | Computational | Regressions covered by server, client, shared, and script tests | `bun run test`, `bun run test:changed`, `bun run verify:changed`; focused single file: `bun run test -- <file>` (any project) or `bun run test:scripts:file -- <file>` (scripts project) | Area docs and test helpers |
| Playwright e2e | Behavior | Computational | Browser workflow regressions | `bun run e2e`; Stop-hook user warning on cached/failing e2e | `playwright-cli` skill |
| `local/e2e-prefer-role-selectors` | Behavior | Computational | New raw CSS locator use in e2e files when a role, label, text, or test-id selector should be used instead | `bun run lint:changed` | `docs/guides/add-e2e-test.md` |
| `eslint-plugin-playwright` rules | Behavior | Computational | Missing Playwright awaits, focused or skipped tests, discouraged waits, and other e2e hygiene drift | `bun run lint:changed` | `docs/guides/add-e2e-test.md` |
| `verify` / `verify:changed` wrapper | Maintainability, architecture fitness, behavior | Computational | Lint, typecheck, and test failures with shared cache/lock/logs | `bun run verify:changed` | `AGENTS.md` |
| `verify:logs` | Maintainability | Computational | Hidden or stale verification failures in cached logs | `bun run verify:logs` | Stop-policy user warnings |
| `doctor` | Architecture fitness, maintainability | Computational | Worktree, DB, env, port, dependency, lint-suppression, and migration-safety drift | `bun run doctor` | `bun run worktree:*` scripts, `docs/guides/add-prisma-migration.md` |
| knip unused-code advisory sensor | Maintainability | Computational | Workspace-unused files, exports, types, and dependencies; the broad report is a terminal advisory and never gates — the unused-export floor below is its promoted per-check gate | `bun run sensor:knip`, `bun run doctor` | `knip.config.ts` |
| knip unused-export floor | Maintainability | Computational | Drift in knip-reported unused exported symbol count above or below the committed baseline; intentionally fail-closed in verify/pre-commit, measured about 1.5s on 2026-07-02, and runs without knip `--cache` so each gate reads the current graph directly | `bun run sensor:knip-unused-exports`, `verify`, pre-commit | `knip.config.ts`, `sensor-knip-unused-exports.baseline.json` |
| near-duplicate no-new floor | Maintainability | Computational | New fuzzy 8-line/45-token/0.85 function-clone identities touching staged files; existing whole-repo debt is admitted by a committed shrink-only baseline. C3's scoped single-walk 3-line/15-parser-token exact tier passes the measured timing and bucket caps but remains report-only because 535 newly exposed identities still fail the one-at-a-time baseline-growth gate. | `bun run sensor:near-duplicates`, `verify`, pre-commit; update after cleanup with `bun scripts/sensor-near-duplicates.ts --update` | `scripts/drift-ai/near-duplicates.ts`, `sensor-near-duplicates.baseline.json` |
| staged blob-size sensor | Maintainability | Computational | Staged files over 500 KiB / 5 MiB thresholds unless allowlisted with a reason | `bun run sensor:blob-size`, via `doctor` | `.blob-size-allowlist` |
| always-loaded context budget | Maintainability | Computational | Growth of the summed always-on per-session context (root `CLAUDE.md`, `AGENTS.md`, and their `@`-imports) that per-file doc-length caps cannot see; terminal advisory — a governance figure that never gates. Sums only the repo-owned set: sessions may also load `.claude/rules/*.md`, `CLAUDE.local.md`, and user-level memory (excluded as per-machine and non-reproducible), so treat the total as a lower bound | `bun run sensor:context-budget`, via `doctor` (report-only line) | `scripts/doc-length-policy.sh` |
| `db:status` | Architecture fitness | Computational | Migration, Prisma client, and DB connectivity drift | `bun run db:status`, via `doctor` | `docs/guides/add-prisma-migration.md` |
| `db:migration-safety` | Architecture fitness, behavior | Computational | Destructive or risky Prisma migrations lacking acknowledgement | `bun run db:migration-safety`, via `doctor` | `docs/guides/add-prisma-migration.md` |
| `module:index:check` | Maintainability | Computational | Module doc index drift | `bun run module:index:check` | `docs/module-docs.md` |
| `eslint-disable-register` | Maintainability | Computational | New suppressions without `-- reason` text or broad disables outside the file/rule allowlist | Blocking: `bun run lint:suppressions` in `verify`, `verify:changed`, `verify:parallel`, and pre-commit | `docs/generated/harness-controls.md` |
| `suppression-register` | Maintainability | Computational | Current-state TypeScript and Stryker suppressions missing `-- reason`, deprecated `@ts-ignore`, `@ts-nocheck` outside allowlist, or broad Stryker disables | Blocking: `bun run lint:suppressions` in `verify`, `verify:changed`, `verify:parallel`, and pre-commit | `docs/generated/harness-controls.md` |
| AI hook adapters | Maintainability, architecture fitness | Computational | Protected-file edits, doc bloat, stale Prisma client risk, noisy command output, uncommitted stop state | Claude/Codex hooks | Adapter Boundary section above |
| Stop-hook cached-verify replay | Maintainability, architecture fitness, behavior | Computational | A stop while the most recent `verify:changed` / pre-commit run is still red, when its wrapper meta still matches the worktree, surfaced to the user | Stop hook, user warning (reads `$LOG_DIR/meta/wrapper.json`) | `verify` / `verify:changed` wrapper |
| Script smoke tests | Maintainability | Computational | Hook, verify, worktree, module-index, migration-safety, and script wrapper regressions | `bun run test:scripts`, `bun run verify` | `scripts/` comments and shell tests |
| Worktree drift/status checks | Architecture fitness | Computational | Secondary worktree DB, port, Redis, and SRD seed drift | `bun run worktree:status`, `doctor` | `bun run worktree:*` scripts |
| `local/socket-registry-broadcasts` | Architecture fitness, behavior | Computational | Registry-owned events emitted directly outside `broadcast-registry.ts` | `bun run lint`, `bun run lint:changed` | ADR-0003, `docs/guides/add-socket-broadcast.md` |
| `local/no-broadcast-in-transaction` | Architecture fitness, behavior | Computational | Socket broadcast helpers called inside Prisma `$transaction` callbacks instead of after commit | `bun run lint`, `bun run lint:changed` | ADR-0003, `docs/guides/add-socket-broadcast.md` |
| Mutation testing | Behavior | Computational | Tests that execute code without proving meaningful behavior, across shared logic, scripts, server services, and the portable lint-ratchet engine | Manual: `bun run test:mutation`, `test:scripts:mutation`, `test:server:mutation`, `test:lint-ratchet:mutation` | `docs/agent_notes/backlog/mutation-testing-stryker.md` |
| Mutation survivor summarizer | Behavior, maintainability | Computational | Raw Stryker `mutation.json` dumps nobody triages: ranks `Survived` and `NoCoverage` mutants by file and directory area with bounded per-file samples; report-only triage aid — survivor counts never gate; exit 2 only for infrastructure failures (unreadable/malformed report, unwritable output, CLI misuse) | Manual after a mutation run: `bun run mutation:survivors` (`--input`, `--format text\|json`, `--output`, `--top`) | `scripts/mutation-survivors.ts`, Mutation Testing section below |
| `drift:ai harness-freshness` | Maintainability | Computational | `docs/ai-harness.md` guide inventory drift: unreferenced `docs/guides/*.md`, missing referenced guides, and stale backtick repo paths | `bun run drift:ai harness-freshness`, via `doctor` | This map |
| `drift:ai module-doc-paths` | Maintainability | Computational | Stale backtick file references in `MODULE.md` / `*-MODULE.md` notes (path existence only; multi-base resolution, precision over recall); opt-in, report-only | Manual: `bun run drift:ai --check module-doc-paths` (or `--check all`) | `scripts/drift-ai/README.md`, `MODULE.md` files |
| `drift:ai` default report | Maintainability, architecture fitness | Computational | AI-specific drift on changed files: jscpd copy/paste blocks (8 lines / 60 tokens / mild, no percentage threshold), suspicious sibling modules, over-narrated comments, and newly added suppression comments; duplicate findings, skips, and malformed-tool diagnostics stay advisory and the check has no verify slot | Manual, report-only by default: `bun run drift:ai` (filter with `--check`; pass `--config <path>` to test another config) | `scripts/drift-ai/README.md`, `drift-ai.config.json` |
| `drift:ai` opt-in checks | Maintainability, architecture fitness | Computational | Slower whole-graph AI-drift signals: commented-out code blocks, stale module-doc paths, knip-backed orphan files / duplicate export aliases / unused exports, TypeScript import cycles, server layer-direction reverse imports, fuzzy plus parser-token exact near-duplicate functions, and duplicate type/schema/literal/constant shapes | Manual, report-only by default: `bun run drift:ai --check commented-out-code`, `--check module-doc-paths`, `--check orphan-files`, `--check knip-duplicates`, `--check import-cycles`, `--check layer-direction`, `--check near-duplicates`, `--check duplicate-types`, `--check duplicate-schemas`, `--check duplicate-literals`, `--check duplicate-constants`, `--check unused-exports`, or `--check all` | `scripts/drift-ai/README.md`, target `knip` / `tsconfig` |
| `drift:triage` report reducer | Maintainability, architecture fitness | Computational | Agent handoffs overwhelmed by repeated cross-tool evidence, ambiguous swarm ownership, incompatible verdicts, explicitly informational cycles, test-only examples, high-volume literal signals, and hidden upstream truncation | Manual after JSON drift / Semgrep / Dolos scans: reduce with `bun run drift:triage --format json --output <triage.json> [--packet-dir <dir>] <report.json...>`; collect swarm verdicts with `bun run drift:triage collect --manifest <manifest.json> --verdict-dir <dir>` | `scripts/drift-triage/MODULE.md`, raw input reports |
| `drift:ai` runtime import-cycle floor | Architecture fitness, maintainability | Computational | New runtime import cycles anywhere in the module graph (cycles that survive when type-only edges are removed); type-only cycles stay report-only evidence and never gate | `bun run lint`, `bun run lint:changed` — the "import cycles" lane runs `drift:ai --scope current --check import-cycles --fail-on-runtime-cycles` and fails closed if the check skips | `scripts/drift-ai/README.md`, `scripts/lint.sh` |
| `drift:ai hotspots` | Maintainability | Computational | Advisory git-history hotspots: churn, coupling, fragmentation, suppression-churn, and thrash lenses; areas to inspect, not defects | Manual advisory: `bun run drift:ai hotspots --lens all` | `scripts/drift-ai/README.md` |
| `drift:ai coldspots` | Maintainability | Computational | Advisory git-history coldspots: low-churn source files and stale-marker lines that may need a human look; areas to inspect, not defects | Manual advisory: `bun run drift:ai coldspots --lens all` | `scripts/drift-ai/README.md` |
| `harness:audit` fusion | Maintainability | Computational | Read-only fusion of `HarnessDiagnostics` envelope files (`lint:ratchet`, `drift:ai`, `logs:audit`) into one bounded report grouped by tool, with totals and per-control counts; an artifact generator for scheduled/manual review, not an edit-loop gate (findings never gate; only unreadable/malformed envelopes exit non-zero) | Manual: run a producer with `HARNESS_DIAGNOSTICS_OUTPUT=<path>`, then `bun run harness:audit <path...>` (`--format text\|json`, `--output <file>`). Scheduled weekly: `.github/workflows/slow-drift.yml` runs `bash scripts/slow-drift-audit.sh` and uploads fused artifacts. | `scripts/harness-audit.ts`, `scripts/slow-drift-audit.sh`, `packages/shared/src/schemas/harness-diagnostics.ts` |
| Lint message eval | Maintainability | Inferential + computational grader | Treatment/control agent repairs over identical structural-rule violations; iterations to green plus stuck, oscillating, and cascading interactions | Manual capture and `bun run eval:lint-messages`; weekly replay in `.github/workflows/slow-drift.yml`, report-only and outside commit gates | `docs/guides/lint-message-evals.md` |
| Future approved behavior fixtures | Behavior | Computational | Generated tests proving the wrong shape or missing reviewed scenario data | Targeted Vitest suites | Domain docs, SRD reference |
| Future slow drift reports | Maintainability, architecture fitness | Computational | Stale module docs, flake trends, layer drift, and other drift reports not already covered by `drift:ai` or existing sensors | `doctor`, CI, scheduled, or manual | This map |
| Future project-specific reviewer | Architecture fitness, behavior | Inferential | Semantic drift not expressible as deterministic checks | Manual after deterministic checks pass | This map and area docs |

### Heavy-tool memory admission

`scripts/verify/memory-budget.sh` is the shared, cross-worktree admission
policy for gate slots and full direct runs of `bun run test`, `bun run lint`,
`bun run test:scripts`, and `bun run lint:ratchet`. Its expected-peak table is
seeded from measured cold process-tree RSS. Gate launchers pass their live
reservation token into admitted children, so a nested tool entry point skips a
second reservation only while that owning reservation remains live. Admitted children also
best-effort raise `oom_score_adj`; unsupported hosts silently keep their
default score.

Admission fails closed whenever a slot's expected peak exceeds measured
headroom, even when there are no other live Musi reservations: an empty
reservation set does not prove that unrelated host workloads are idle. The
timeout diagnostic reports the required peak, measured availability, safety
reserve, and resulting admission headroom; free memory and retry rather than
launching below the budget. `MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK=1` is an
explicit emergency opt-in for admitting an oversized slot only when no other
Musi reservation is live. It restores the risky solo behavior for that process
and is not a normal gate or direct-tool setting.

Only positively identified narrow test invocations—where every positional
selector resolves to an explicit existing `*.test.*` or `*.spec.*` file inside
the repository—and `test:scripts --changed` skip the full-suite reservation.
Directories, project selections (including strict subsets), unresolved
substrings, and glob-like selectors pay full admission. Option values are
consumed before classifying positionals, while config/root overrides and other
ambiguous or potentially full shapes reserve the full peak. This fail-closed
boundary keeps ordinary full invocations admitted without serializing genuine
edit-loop checks behind the default test slot's 3,200 MB reservation. The
measured default is `NON_SERVER_TEST_MAX_WORKERS=6`: an unset override or a
positive override at or below 6 charges 3,200 MB, while an elevated or
malformed value charges the conservative pre-cap 5,580 MB bound. The largest
supported override is 8, the only measured elevated candidate. Under installed
Vitest 4.1.7, `VITEST_MAX_WORKERS` takes precedence over CLI `--maxWorkers`, which takes precedence over `NON_SERVER_TEST_MAX_WORKERS`;
the full-suite wrapper makes that order execution-real by translating a
validated CLI value into `VITEST_MAX_WORKERS` only when native env is unset.
This is necessary because Vitest workspace projects otherwise retain their own
configured `maxWorkers` instead of inheriting the global CLI value. Admission
observes the translated value, and both environment variables are still
validated independently. A translation-origin marker lets root Vitest config
capture the translated value for non-server projects and then remove only the
synthetic native override before server resolution, preserving the measured
server cap; an explicitly inherited native override keeps its existing global
semantics. The `test:changed` ordinary/fallback Vitest phase uses the same translation;
its client fast-lane phase deliberately replaces native env with
`MUSI_CLIENT_FAST_LANE_MAX_WORKERS` (4 by default), so that distinct phase does
not consume the CLI value. The root test wrappers accept both CLI value syntaxes
and Vitest's equivalent `--max-workers` spelling, validate them before
classification and admission, and reject malformed or above-8 values before
dispatch. Repeated worker flags are rejected as ambiguous, including mixed
camel- and kebab-case spellings, because Vitest 4.1.7 accumulates repeats rather
than applying last-wins semantics. An effective 7 or 8 always charges 5,580 MB,
while 1 through 6 charges 3,200 MB.
`MUSI_CLIENT_FAST_LANE_MAX_WORKERS` is 4 by default and uses the same 1–8 validation;
because the gate can see it before `test-changed.sh` converts it to
`VITEST_MAX_WORKERS`, 7 or 8 also raises the parent test-slot reservation to
5,580 MB. The focused test override remains 2. For emergency diagnostics only,
`MUSI_TOOL_MEMORY_ADMISSION_BYPASS=1` bypasses direct tool-entry admission; it
does not bypass verify or pre-commit admission. Keep the full lint ESLint lane
serial—`--concurrency` remains prohibited because its measured process-tree
growth can kill the host.

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
- replayed lint-message treatment/control reports to `reports/slow-drift/message-eval/`.
- per-step wall-clock timings to `reports/slow-drift/fused/timings.txt` (also
  echoed into the workflow step summary) — trend evidence for spotting slow
  drift in the lane itself, never a pass/fail verdict.
- with `MUSI_SLOW_DRIFT_MUTATION=1` (the scheduled workflow sets it): a
  scoped shared-rules Stryker run (`test:mutation --mutate
  packages/shared/src/rules/**`) followed by `mutation:survivors`, writing
  the ranked triage list to `reports/slow-drift/fused/mutation-survivors.txt`
  and the step summary. Report-only trend evidence: `thresholds.break` stays
  null, and a failed or timed-out mutation run (own bound:
  `MUSI_SLOW_DRIFT_MUTATION_TIMEOUT_SECS`, default 1800) leaves a note while
  the lane continues.

These `reports/` artifacts are gitignored local outputs and may be stale after
the worktree moves. Slow-drift text artifacts include a metadata header
(`generated-at`, HEAD, command, Bun version, and a staleness warning); JSON
artifacts keep parseable JSON and carry the same header in adjacent `.meta.txt`
sidecars. Rerun `bash scripts/slow-drift-audit.sh` or use the latest uploaded
CI artifact before treating local reports as current.

GitHub uploads those paths as `slow-drift-producer-envelopes`,
`slow-drift-producer-output`, `slow-drift-fused-reports`, and
`slow-drift-lint-message-eval`. The default scheduled producers are
`lint:ratchet` and `drift:ai --scope current --check all`; the message-eval
replay runs beside them but is not a `HarnessDiagnostics` fusion producer.
`logs:audit` joins the same fusion path when the driver receives
newline-separated runtime JSONL paths through `MUSI_SLOW_DRIFT_LOG_FILES`; the
scheduled CI job skips it by default because that job does not collect runtime
server logs.
Automation should use `bun run logs:audit --latest` only after its no-log path
has been proven quiet in that environment.

Findings are report-only. Producer exit `1` still produces artifacts and
continues to fusion; unreadable envelopes, missing sidecars, and setup/tool
errors remain infrastructure failures.

Steps are individually disableable and boundable: `MUSI_SLOW_DRIFT_SKIP`
(comma- or space-separated step names — `lint:ratchet`, `drift:ai`,
`logs:audit`, `lint-message-eval`, `mutation`; unknown names warn and are
ignored) skips named steps while recording a `skipped` timing line. Skipping
every envelope producer is a deliberate degraded run: the lane notes it and
ends green without fusion. `MUSI_SLOW_DRIFT_STEP_TIMEOUT_SECS` (unset/`0` =
unlimited; invalid values warn and fall back to unlimited) bounds each step's
wall clock — a timed-out step is an infrastructure failure (exit 124 in
`timings.txt`; exit 137 when the step ignored TERM and was SIGKILLed after
`MUSI_SLOW_DRIFT_STEP_KILL_AFTER_SECS`, default 30), not a finding.

## Mutation Testing

Run `bun run test:mutation` manually when changing shared pure logic,
`bun run test:scripts:mutation` when auditing script assertion strength, or
`bun run test:server:mutation` when auditing server service logic. These
commands are intentionally outside `verify`, `verify:changed`, and pre-commit
because Stryker is a slower quality audit, not an edit-loop gate.

Scopes:

- `test:mutation` (`stryker.config.mjs`) mutates all of
  `packages/shared/src/**` — dice, map, schemas, and rules. Pure logic, no DB.
- `test:scripts:mutation` (`scripts/stryker-scripts.ts`) mutates `scripts/**`
  (codemods excluded, see below).
- `test:server:mutation` (`stryker.config.server.mjs`) mutates
  `packages/server/src/services/**`. It runs serially (`concurrency: 1`) and
  `inPlace`, uses `packages/server/vitest.mutation.config.ts`, and scopes the
  dry run to service tests. Serial keeps one mutant under test at a time, which
  avoids the `VITEST_POOL_ID`-only test-DB isolation collisions parallel
  Stryker workers would hit. Provision the worktree first
  (`bun run worktree:init`) so the per-worktree test DB exists. Service mutants
  reachable only via router/integration tests show as `NoCoverage` — honest
  signal that the service lacks direct unit coverage.

Reports (gitignored, regenerated per run):

- `reports/mutation/index.html` — interactive triage UI; open this first.
- `reports/mutation/mutation.json` — machine-readable report.
- `reports/mutation/stryker-incremental.json` — incremental cache; safe to
  delete to force a clean run.
- `reports/mutation-scripts/` — same report shape for
  `bun run test:scripts:mutation`.
- `reports/mutation-server/` — same report shape for
  `bun run test:server:mutation`.

Summarize a finished run with `bun run mutation:survivors` (defaults to
`reports/mutation/mutation.json`; `--input` points it at the scripts/server
report). It ranks `Survived` and `NoCoverage` mutants by file and directory
area with a few sample mutants per file — a triage list, not a verdict:
survivor counts never change the exit code.

The weekly slow-drift lane (see Slow Drift Schedule above) additionally runs
a scoped shared-rules mutation pass plus this summarizer, so survivor counts
finally trend week over week instead of living in one-off local audits. That
recurring signal stays report-only end to end.

The scripts mutation command currently excludes `scripts/codemods/**`. That
subsystem's `trpc-shared-input` fixture test compares exact transformed output,
and that comparison fails under Stryker's instrumentation, so the dry run fails
before mutation testing can start. The failure is not isolated to the
`trpc-shared-*` sources (excluding them does not fix it), so re-inclusion needs
that test made instrumentation-robust rather than a glob tweak; keep codemods
covered by their fixture tests until then.

`scripts/lint-ratchet/**` is included: its dry run passes (203 related tests)
and mutation testing runs cleanly against it, so it carries no Stryker-specific
incompatibility.

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

Non-obvious architectural gates also carry an ADR ID for stable rationale;
actionable repair text remains local to the diagnostic and guide.

Do not add more global instructions to `AGENTS.md` unless every agent needs
them on every session start.
