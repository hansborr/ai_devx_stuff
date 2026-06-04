# 15 - Golden-path reference feature pointer

Status: Parked
Track: D (docs/feedforward)
Size: small
Depends on: none
Blocks: none

## Goal

Pick one clean end-to-end tRPC feature slice and add a single pointer so agents
know what to copy for shared -> server -> client work.

## Background

The harness has many negative rules and workflow guides, but no positive
reference feature. The review recommends one tiny pointer, not a new cookbook.

## Seams to touch

- `AGENTS.md` only if the pointer truly belongs in always-loaded context.
- Otherwise prefer a short note in `docs/guides/add-trpc-procedure.md`.
- Candidate discovery should use `bun run code:intel -- overview <router-file>`
  and related `refs` / `dependents` queries.

## What to do

1. Identify a stable vertical slice covering:
   - shared Zod schema;
   - server service;
   - tRPC router procedure;
   - client query/mutation hook or call site;
   - tests, and socket/cache behavior if present.
2. Add a concise "golden path" pointer with file paths and the build order.
3. Keep it short enough that future path freshness can cover the pointers.
4. Avoid creating a synthetic sample. Point at real code.

## Testing

- `bun run format:changed:check`
- If `AGENTS.md` changes, keep it well under the doc-length policy and run
  `bash scripts/ai-hooks/test.sh` only if hook behavior changes.

## Out of scope

- Creating a new feature.
- Creating a task skill.
- Adding long explanatory prose to `AGENTS.md`.
