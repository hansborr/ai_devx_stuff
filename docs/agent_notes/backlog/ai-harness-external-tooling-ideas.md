# AI Harness External Tooling Ideas

Status: Parked research note
Date: 2026-05-15
Sources: `../../ai-harness.md`, `/home/node/tmp/ai-tools`,
`/home/node/tmp/language-service`

This note captures harness ideas from the Svelte AI tools and the Effect
language service. The tools themselves are not direct fits for Musi, but their
shapes are useful: Svelte packages an agent workflow around docs and validation,
while Effect exposes language-service intelligence through scriptable commands.

## Useful Patterns

### 1. Docs Discovery Before Docs Retrieval

Svelte does not ask agents to read all docs. It exposes a small discovery step
(`list-sections`) whose output includes `use_cases`, then a targeted retrieval
step (`get-documentation`) for selected sections:

- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/handlers/tools/list-sections.ts`
- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/handlers/tools/get-documentation.ts`
- `/home/node/tmp/ai-tools/packages/mcp-server/src/use_cases.json`

Musi has good guides, module notes, and `Concepts:` breadcrumbs, but agents
still discover much of that by reading filenames or using `rg`. A Musi-owned
`docs:intel` or `guide:intel` CLI could list relevant docs by area, package,
concept, and task guide, then fetch only the selected files. This would fit the
existing rule that `AGENTS.md` should not become a cookbook.

Candidate leaf:

- Add `bun run docs:intel -- list [--area trpc|prisma|socket|rules|client-cache]`
  and `bun run docs:intel -- get <id...>` over `docs/guides/`,
  `MODULE.md`, `*-MODULE.md`, and `docs/agent_notes/backlog/README.md`.
- Reuse existing `Concepts:` lines and add explicit `use_cases` only where
  discovery quality needs it.
- Keep CLI first; add MCP only as an adapter if a concrete client appears.

### 2. Read-Only Autofixer Output for Agent Loops

The Svelte autofixer is an agent-oriented validator rather than a normal
compiler wrapper. It combines compiler warnings, ESLint rules, and custom AST
visitors into a small structured response:

- `issues`
- `suggestions`
- `require_another_tool_call_after_fixing`

Relevant files:

- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/handlers/tools/svelte-autofixer.ts`
- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/autofixers/add-compile-issues.ts`
- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/autofixers/add-eslint-issues.ts`
- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/autofixers/visitors/`

Musi already has lint rules, codemods, `verify:changed`, `doctor`, and
`drift:ai`; the missing piece is a concise, file-scoped repair preview that an
agent can run repeatedly while editing. This should not become a new gate.

Candidate leaf:

- Add `bun run harness:quickfixes -- <file>` or extend existing codemods with a
  shared `--preview` output shape: severity, rule, location, repair command,
  optional diff, and whether rerun is required.
- Start with one high-value area where Musi already has codemods:
  tRPC shared input/output schemas, structured logging, or concurrency guards.
- For checks too contextual for regex, factor reusable TypeScript AST/scope
  helpers: router procedure detection, shared-schema import detection,
  transaction callback detection, and component-local socket listener detection.

### 3. CLI And MCP Share One Core

The Svelte package can run as a stdio MCP server, but the same package exposes
direct CLI subcommands for agents and scripts:

- `/home/node/tmp/ai-tools/packages/mcp-stdio/src/index.ts`
- `/home/node/tmp/ai-tools/documentation/docs/30-mcp/70-cli.md`

This reinforces Musi's current direction: repo-owned CLIs are the stable seam.
If Musi adds MCP, it should wrap `code:intel`, `drift:ai`, `verify:logs`, and
future `docs:intel` commands rather than becoming the only interface.

Candidate leaf:

- Do not build an MCP server first. Define stable JSON/text CLI output for one
  new or existing tool, then consider MCP as a thin transport adapter.

### 4. LLM-Oriented Overview Commands

Effect's `overview` command is explicitly designed to summarize project exports
for LLMs. It extracts services, layers, and yieldable errors, preserving source
locations, type strings, and JSDoc descriptions:

- `/home/node/tmp/language-service/packages/language-service/src/cli/overview.ts`
- `/home/node/tmp/language-service/packages/language-service/src/cli/layerinfo.ts`

Musi's closest existing tool is `bun run code:intel -- exports`, but it is a
symbol/navigation tool, not a domain overview. A Musi overview command would be
valuable for tRPC routers, services, shared schemas, socket broadcasts, cache
hooks, and tests.

Candidate leaf (**shipped** — `bun run code:intel -- overview` exists; see
`scripts/code-intel/overview-query.ts` and `overview-call-targets.ts`):

- Add `bun run code:intel -- overview <file>` for one slice first:
  tRPC router files.
- Output procedure name, query/mutation kind, input schema, output schema, auth
  helper, service call, broadcasts, and nearby tests when discoverable.
- Keep it read-only and compact. Treat missing fields as findings only if a
  paired sensor already enforces them.

### 5. Quick-Fix Preview Before Applying Edits

Effect exposes `quickfixes` as a CLI command that shows diagnostics with their
available fixes and rendered diffs. It can filter by diagnostic, line, column,
and fix name:

- `/home/node/tmp/language-service/packages/language-service/src/cli/quickfixes.ts`
- `/home/node/tmp/language-service/packages/language-service/src/cli/setup/diff-renderer.ts`

Musi codemods already know how to repair some drift, but discovery is split
across lint messages and individual codemod docs. A central quick-fix preview
would help agents pick the safest repair before editing.

Candidate leaf:

- Define a common `RepairAction` JSON contract for codemods and selected lint
  sensors: `id`, `title`, `file`, `span`, `reason`, `command`, `diff`.
- Implement it for one existing codemod before generalizing.

### 6. Setup/Doctor As Assessed Change Actions

Effect's setup command reads project files, assesses current state, computes
target changes, previews code actions, and applies them only after review:

- `/home/node/tmp/language-service/packages/language-service/src/cli/setup.ts`
- `/home/node/tmp/language-service/packages/language-service/src/cli/setup/assessment.ts`
- `/home/node/tmp/language-service/packages/language-service/src/cli/setup/changes.ts`

Musi's `doctor` is mostly diagnostic. For some classes of repair, a
`doctor --fix-plan` mode could produce exact, reviewable actions without
auto-mutating the repo.

Candidate leaf:

- Start with non-risky local setup drift: stale Prisma client, missing generated
  module index, missing env examples, or worktree port metadata.
- Avoid database, migration, or git-history mutation fixes.

### 7. Machine-Readable Rule Metadata

Effect keeps metadata for diagnostic groups, default severity, fixability, and
preview examples:

- `/home/node/tmp/language-service/packages/language-service/src/metadata.json`
- `/home/node/tmp/language-service/packages/language-service/src/presets.ts`

Musi's `docs/ai-harness.md` is currently the human inventory. A small metadata
registry for local ESLint rules, drift checks, codemods, and script sensors
could generate parts of that inventory and power repair UIs.

Candidate leaf (**shipped** — `harness.controls.json` is the registry, with
`category`, `principle`, `pairedGuide`, `repairKind`, `repairCommand`,
`source`, and `invocation` across lint rules, codemods, sensors, drift scopes,
ratchets, hooks, and doc generators):

- Add metadata for local ESLint rules first: category, paired guide, default
  command, fix command if any, and one bad/good example.
- Do not migrate the whole harness table at once.

### 8. Snapshot Harnesses For Diagnostics And Fixes

Effect has a large fixture/snapshot harness for diagnostics and quick fixes:

- `/home/node/tmp/language-service/packages/language-service/test/diagnostics.test.ts`
- `/home/node/tmp/language-service/packages/language-service/test/overview.test.ts`
- `/home/node/tmp/language-service/packages/language-service/test/setup-cli.test.ts`

Musi already has focused script and codemod tests. The transferable idea is
not "more snapshots everywhere"; it is fixture-driven tests that prove a
diagnostic's message, fix metadata, and applied output stay aligned.

Candidate leaf:

- For the next local ESLint rule or codemod, add a shared fixture shape that
  captures input, expected diagnostic, expected repair command, and expected
  fixed output.

### 9. Canonical Agent Assets With Adapter Sync

Svelte keeps skills, subagent prompts, and instruction text under `tools/`, then
syncs them into Claude, Cursor, and OpenCode plugin layouts:

- `/home/node/tmp/ai-tools/tools/skills/`
- `/home/node/tmp/ai-tools/tools/agents/svelte-file-editor.md`
- `/home/node/tmp/ai-tools/scripts/sync-claude-plugin.ts`
- `/home/node/tmp/ai-tools/scripts/sync-cursor-plugin.ts`
- `/home/node/tmp/ai-tools/scripts/sync-opencode-plugin.ts`

Musi already has an adapter boundary for hooks in `scripts/ai-hooks/`. The same
principle should apply to agent-facing skills and subagent prompts if they keep
growing. Today `.claude/skills` and `.codex/skills` duplicate content.

Candidate leaf (**shipped** — `scripts/harness/generate-skill-artifacts.ts`
projects canonical skill source into the per-harness adapters, gated by
`bun run harness:skills:refresh` / `harness:skills:check`):

- Move shared skill source into one repo-owned directory, then generate or sync
  `.claude/skills` and `.codex/skills` from it.
- Keep harness-specific fields in the adapters, not in shared source.

### 10. Task Prompts And Fallback Skills

Svelte encodes the whole docs, edit, validate, rerun loop as selectable prompts
and skills rather than as global startup instructions:

- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/handlers/prompts/svelte-task.ts`
- `/home/node/tmp/ai-tools/tools/skills/svelte-code-writer/SKILL.md`
- `/home/node/tmp/ai-tools/tools/agents/svelte-file-editor.md`

Musi's current guides are human-readable, but a task prompt can be more
procedural: "for a tRPC change, read these guides, run these `code:intel`
queries, use these codemods if applicable, then verify these flows." This keeps
`AGENTS.md` short while giving agents a precise workflow when the task area is
known.

Candidate leaf:

- Add one generated or handwritten prompt for `musi-trpc-task` or
  `musi-rules-task`; keep it optional and discoverable through `docs:intel`.
- Add a fallback skill that names the equivalent `bun run` commands when MCP or
  prompt tooling is unavailable.

### 11. Protocol-Level Adapter Tests And Config

Svelte tests MCP behavior through an in-memory transport and validates plugin
configuration with a schema and config precedence:

- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/handlers/tools/svelte-autofixer.test.ts`
- `/home/node/tmp/ai-tools/packages/mcp-server/src/mcp/handlers/tools/playground-link.test.ts`
- `/home/node/tmp/ai-tools/packages/opencode/config.ts`
- `/home/node/tmp/ai-tools/packages/mcp-stdio/server.json`

If Musi adds MCP or plugin packaging, tests should cover protocol shape, not
only handler functions: schemas, structured content, read-only annotations,
local path behavior, and error output. Project-local config should be
schema-validated and should only toggle adapters, guide sets, skills, and
subagents; the underlying CLI behavior should remain repo-owned.

Candidate leaf:

- When the first MCP wrapper exists, add an in-memory protocol test before
  adding more tools.
- Publish a local manifest for stdio first. Remote HTTP should stay optional
  and read-only unless a concrete use case appears.

## Non-Goals

- Do not patch TypeScript the way Effect does. That is appropriate for Effect's
  ecosystem-level language service, but too invasive for Musi's repo harness.
  Prefer ESLint, TypeScript types, and explicit CLIs.
- Do not add global AGENTS instructions for each new workflow. Prefer
  discoverable guides, `docs:intel`, and area-specific module docs.
- Do not make MCP the source of truth. Every useful command should stay runnable
  from `bun run`.
- Do not promote broad AI review until deterministic sensors pass and the
  review has a narrow, testable contract.

## Suggested Promotion Order

Items 1, 4, and 6 have since shipped; the rest are still open.

1. ~~`code:intel -- overview` for one tRPC router slice.~~ Shipped.
2. `docs:intel` discovery over guides and module docs.
3. Shared quick-fix preview contract for one codemod.
4. ~~Canonical skill/subagent source with `.claude` and `.codex` sync.~~
   Shipped as `harness:skills:refresh`.
5. Optional task prompt plus fallback skill for one high-risk workflow.
6. ~~Rule metadata registry for local ESLint rules and codemods.~~ Shipped as
   `harness.controls.json`.
7. MCP/plugin adapter tests only after a CLI-backed adapter exists.
