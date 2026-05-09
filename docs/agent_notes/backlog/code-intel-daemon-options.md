# Code Intel Daemon Options

Status: Parked daemon design with a preferred direction. The one-shot
`code:intel` CLI has landed; measured repeated lookup latency now justifies
planning the next adapter when this workstream is promoted.
Date: 2026-05-07; recommendation refreshed 2026-05-09

This note compares implementation options for future daemon, cache, LSP, or MCP
adapters behind `bun run code:intel --`. The goal is to make code navigation
more semantic for agents without turning the harness into a custom IDE.

## Problem

Agents currently use `rg` for nearly every code navigation question. That is
fast and predictable, but it is not enough for questions where TypeScript
resolution matters:

- Where is the definition of this aliased imported symbol?
- Which files reference the actual symbol, not just the same text?
- Which source files import this file through package exports or path aliases?
- Which tests are close enough to a changed module to run first?
- Which import path should a caller use from this package?

The current `code:intel` CLI provides a small interface over semantic and
repo-graph queries. Future adapters should preserve that CLI seam while
improving repeated lookup speed or adding symbol operations such as `refs`.

## Current Recommendation

Promote Option 2 first: a repo-owned custom daemon using the TypeScript
Language Service for symbol operations and Musi-owned graph modules for
dependents and nearby tests.

Claude Code currently has `typescript-language-server` installed globally, and
that makes an LSP-backed `refs` prototype cheaper. It does not change the
durable recommendation unless Musi adds `typescript-language-server` as an
explicit dev dependency. The repo already owns TypeScript/`tsserver`, while
the globally installed LSP server is an agent-runtime detail. LSP also does
not answer the repo-specific graph/test questions that make `code:intel`
valuable.

Practical sequencing:

1. Keep `bun run code:intel -- ...` as the stable public seam.
2. Use Option 2 for the durable daemon core when latency work resumes.
3. Optionally prototype `refs` against the existing LSP server to validate the
   desired output shape, but do not make that global binary a hidden
   dependency.
4. Add MCP or LSP adapters later over the same core only after CLI behavior is
   stable.

## Design Constraints

- Keep the useful interface small: definitions, optional future references,
  exports, dependents, and nearby tests.
- Treat the CLI as the stable interface. Daemons, language servers, and caches
  are adapters behind that seam.
- Preserve current terminal workflow. Agents should be able to run one command
  and paste the compact output into their reasoning.
- Prefer read-only commands. This tool should not edit files.
- Do not make this a gate at first. It is feedforward context, not verification.
- Use repo source files as the truth. Workspace package imports such as
  `@musi/shared/rules/foo.js` should resolve to `packages/shared/src/rules/foo.ts`,
  not only to generated `dist` declarations.

## Expected User Interface

Commands should stay boring and scriptable:

```bash
bun run code:intel -- def packages/server/src/routers/character.ts:42:18
bun run code:intel -- exports packages/shared/src/rules/character-rules.ts
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 2
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct
```

Human output should stay compact:

```text
definition CharacterUpdateInputSchema
  packages/shared/src/schemas/character.ts:82:14 value export

references CharacterUpdateInputSchema
  packages/server/src/routers/character.ts:12:3 import
  packages/server/src/routers/character.ts:88:12 value
  packages/shared/src/schemas/character.test.ts:17:10 value
```

JSON can come later if a hook, dashboard, or MCP adapter has a concrete
consumer.

## Option 1: One-Shot `ts-morph` CLI

The simplest implementation is a Bun script that loads the relevant TypeScript
project, answers one query, and exits.

Implementation sketch:

- Add `scripts/code-intel.ts`.
- Add `code:intel` to `package.json`.
- Use `ts-morph` to load the package `tsconfig.json` that owns the input file.
- Add Musi import resolution for workspace package exports and client `@/*`
  aliases.
- Build an import graph in memory only for commands that need it.
- Add Vitest fixture tests plus a shell smoke test selected by `test:scripts`.

Pros:

- Lowest implementation and maintenance cost.
- Easy to test with fixture files.
- No stale process state.
- No lifecycle commands or socket cleanup.
- Fits the current script and codemod pattern.

Cons:

- Re-loads TypeScript project state for each command.
- Rebuilds import graph repeatedly.
- Slower for repeated lookups during a long agent session.
- Harder to share cached state with future MCP or dashboard adapters.

Best fit:

- First implementation.
- Occasional agent lookups where startup cost is acceptable.
- Proving the command interface before adding a daemon.

## Option 2: Custom Daemon Using TypeScript Language Service

This option keeps the CLI as the public interface, but routes requests to a
repo-owned daemon. The daemon would use TypeScript's language service directly
for symbol operations and custom Musi logic for graph queries.

Implementation sketch:

- Add `bun run code:intel:server`.
- Store daemon state under `/tmp/musi-code-intel/<repo-key>/`.
- Communicate over a Unix socket or localhost port.
- Keep per-package TypeScript language service instances for shared, server,
  and client.
- Maintain a cached import graph with mtime or file watcher invalidation.
- Provide `status`, `stop`, and `restart` commands.
- Fall back to one-shot mode if the daemon is not running, or auto-start it
  after the first request.

Pros:

- Fast repeated definitions, references, exports, dependents, and test lookups.
- One place owns repo-specific import mapping and graph cache.
- Same core can later serve a CLI, MCP adapter, or dashboard.
- Easier to add higher-leverage commands once the graph is resident.

Cons:

- More code and more failure modes than a one-shot script.
- Needs stale-state detection when branches change, `bun.lock` changes, or
  generated files move.
- Needs process lifecycle management and cleanup.
- File watching across secondary worktrees needs care.
- The daemon interface can become shallow if it mirrors every low-level
  TypeScript operation instead of exposing Musi-specific queries.

Best fit:

- Second step if the one-shot CLI proves useful but too slow.
- Best long-term option if Musi wants both TypeScript symbols and repo-specific
  graph/test intelligence.

## Option 3: Adapter Over `tsserver`

TypeScript ships `tsserver`, the process editors use for TypeScript language
features. A `code:intel` adapter could spawn or connect to `tsserver` and speak
TypeScript's native server protocol.

Useful for:

- Definition lookup.
- Reference lookup.
- Quick info.
- Rename-safe symbol identity.
- Some import and project resolution behavior.

Pros:

- Closest to editor-grade TypeScript behavior.
- Reuses the TypeScript team's long-lived project machinery.
- Handles many tricky language cases better than ad hoc AST traversal.
- Potentially less custom code for symbol operations than a direct language
  service implementation.

Cons:

- The protocol is TypeScript-specific and awkward compared with a simple
  repo-owned request shape.
- Still does not answer Musi-specific graph questions by itself.
- The adapter must translate package-export and source-vs-dist expectations
  into repo-friendly output.
- Harder to fixture-test deterministically than a pure `ts-morph` helper.
- Adds daemon lifecycle concerns without fully removing custom graph code.

Best fit:

- If definition/reference correctness becomes the main problem and one-shot
  `ts-morph` results diverge from editor behavior.
- Less attractive as the first daemon because Musi still needs custom import
  graph and test-discovery modules.

## Option 4: Adapter Over `typescript-language-server` / LSP

`typescript-language-server` wraps TypeScript in the Language Server Protocol.
The `code:intel` CLI could become a small LSP client.

Environment note: Claude Code currently has `typescript-language-server`
available globally. Treat LSP as an optional adapter unless the repo adds an
explicit dev dependency and script wiring. The stable repo interface should not
assume a tool that only one agent runtime provides.

Useful for:

- Definition lookup.
- Reference lookup.
- Hover/quick-info style summaries.
- Document symbols.
- A future editor-like or MCP-facing integration.

Pros:

- Standard JSON-RPC/LSP request shape.
- Easier to reuse with generic agent tooling than raw `tsserver`.
- Good match if future work wants a language-server-backed MCP adapter.
- Keeps TypeScript editor behavior behind an existing adapter.
- Already available in Claude Code, so a Claude-only prototype could be cheap.

Cons:

- Adds another dependency and process.
- Not available in Codex today unless Musi installs and invokes it itself.
- LSP still does not provide Musi-specific dependents or nearby-test answers.
- The CLI needs client/session code, initialization, workspace folder setup,
  and shutdown behavior.
- LSP output is editor-shaped, so the repo still needs formatting and
  simplification for agent-facing output.
- More moving parts than the value justifies for the first iteration.

Best fit:

- Later, if the desired seam is "standard language-server client" rather than
  "repo-specific code intelligence", and Musi is willing to own the dependency
  instead of relying on agent-runtime availability.
- Useful if multiple tools need to share the same LSP connection.

## Option 5: MCP Server Adapter

An MCP server could expose semantic tools directly to agents:

```text
code_intel.definition
code_intel.references
code_intel.dependents
code_intel.tests_for_file
```

This should be an adapter over the CLI or daemon core, not the first
implementation.

Pros:

- Best agent experience when available.
- Tool results can be structured from the beginning.
- Avoids forcing agents to parse terminal text.
- Can expose only high-leverage Musi queries instead of raw TypeScript details.

Cons:

- More platform-specific than a repo script.
- Harder for humans to use without agent tooling.
- Needs the same TypeScript and graph implementation behind it.
- Risks hiding useful behavior from the normal `bun run` workflow if built
  first.

Best fit:

- After the CLI commands have proven stable.
- As a thin adapter over a custom daemon if repeated use warrants one.

## Option 6: Persistent File Index Without Language Server

A middle path is a daemon or cache builder that only owns the import graph and
export index. Symbol operations stay one-shot or are deferred.

Implementation sketch:

- Scan source files and write a compact index under `/tmp/musi-code-intel/`.
- Track imports, exports, package import mapping, and test files.
- Answer `exports`, `dependents`, and `tests` quickly.
- Keep `def` and `refs` backed by one-shot TypeScript calls, or leave them out
  initially.

Pros:

- Easier than a full language-service daemon.
- Directly targets the repo-specific questions that language servers do not
  answer.
- Cache invalidation can be simpler because the index is derived from files.
- Good stepping stone if graph queries are the first high-value use case.

Cons:

- Does not solve symbol identity for definitions and references.
- Can produce false confidence around re-exports, aliases, or dynamic imports
  unless resolution is robust.
- Still needs cache invalidation and stale-state reporting.
- May become throwaway work if a full daemon follows soon after.

Best fit:

- If repeated friction is mostly "what depends on this file?" and "which tests
  should I inspect?" rather than symbol navigation.

## Comparison Matrix

| Option | Startup Cost | Repeated Lookup Speed | Symbol Correctness | Repo Graph Support | Complexity | Best First? |
|---|---:|---:|---:|---:|---:|---|
| One-shot `ts-morph` CLI | Medium | Low | Medium-high | Medium | Low | Yes |
| Custom language-service daemon | High once | High | High | High | High | No |
| `tsserver` adapter | High once | High | Very high | Low without custom code | High | No |
| LSP adapter | High once | High | High | Low without custom code | High | No |
| MCP adapter | Depends on core | High | Depends on core | Depends on core | Medium-high | No |
| Persistent file index | Medium once | High | Low-medium | High | Medium | Maybe, for graph-only |

## Recommendation

The one-shot `ts-morph` CLI has landed, with the command interface designed so
its implementation can later move behind a daemon. Let real use and latency
measurements decide whether that next step is worth the extra lifecycle code.

The CLI is useful and repeated lookup latency is now measured at roughly
2-4 seconds per cold invocation. When this workstream resumes, promote the core
into a custom daemon using the TypeScript Language Service for symbol queries
and Musi-owned graph modules for dependents and nearby tests.

Keep `tsserver` and LSP as possible adapters, not the default first daemon,
because they solve editor-shaped symbol operations but not the repo-specific
graph and test questions that make this tool valuable. The globally installed
`typescript-language-server` in Claude Code is useful for a `refs` prototype
only; relying on it durably would require making it a repo-owned dependency.

## Review Questions

- Is `refs` important enough for the next symbol-query slice, or should future
  work stay focused on graph/test discovery?
- Is one-shot startup still acceptable in this repo as package sizes grow?
- Should the daemon auto-start, or should agents explicitly run
  `bun run code:intel:server`?
- What repo state should invalidate a daemon: branch change, `bun.lock`,
  `tsconfig*.json`, package manifests, generated Prisma client, or all of
  those?
- Which output should be stable for future adapters: human text, JSON, or an
  internal TypeScript object model?
