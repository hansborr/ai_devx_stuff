# AGENTS.md

Shared guidance for AI coding agents working in this repository.

## Project

Musi is a D&D 5.5E virtual tabletop and campaign management system.

- Monorepo: `packages/{shared,server,client}`
- Stack: TypeScript, Bun, Fastify, tRPC, Prisma/PostgreSQL, React, TanStack Query/Router, Tailwind v4, Socket.io
- Key docs: `docs/architecture-plan.md`, `docs/authorization.md`, `docs/socket-architecture.md`, `docs/CONCURRENCY.md`
- SRD reference: `docs/SRD_CC_v5.2.1.pdf` (CC-BY-4.0)

## Agent Notes

On every session start, read `docs/agent_notes/STATUS.md` and `docs/agent_notes/NEXT.md`.

Do not read by default. Open these only when directly relevant:

- `docs/agent_notes/LOG.md` - landed-work history.
- `docs/agent_notes/in_progress/` - only the notes named in `STATUS.md`.
- `docs/agent_notes/backlog/` - parked workstreams; only when re-triaging or explicitly asked.
- `docs/agent_notes/finished_work/README.md` - index into archived notes.
- `docs/agent_notes/finished_work/` - archived task notes.
- `docs/roadmap/*.md` - only when the task lands in that scope.

Active DX sprint hot path: use `docs/agent_notes/NEXT.md` as the queue and
`docs/roadmap/developer-experience.md` as the canonical DX5-DX8 sprint scope.
When a leaf lands, tick every `- [ ]` checkbox under its `###` heading in the
roadmap, then promote exactly one next unchecked leaf into `NEXT.md`'s
`## Ready now` and end the iteration without implementing it.

Parked agent-driven workstreams live in `docs/agent_notes/backlog/`. Do not
open that folder during the DX sprint unless re-triaging or explicitly asked.

Keep these files short. Agent hook adapters may nudge on doc bloat. `STATUS.md`
is a snapshot; `LOG.md` is curated recent history, not a complete archive.

## First Hour

For a cold-start contributor or AI on a fresh checkout:

1. **Orient.** Read `docs/agent_notes/STATUS.md` and `docs/agent_notes/NEXT.md` first — they name the active task and the file to open next.
2. **Read only what the task touches.** Open `docs/architecture-plan.md`, `docs/authorization.md`, `docs/socket-architecture.md`, or `docs/CONCURRENCY.md` only when your change crosses that surface. Open `MODULE.md` only for the directory you are editing.
   New or refreshed module docs follow `docs/module-docs.md`; refresh
   `MODULE-INDEX.md` with `bun run module:index` when module docs move.
3. **Get a working environment.** Run `bun install`, then `bun run dev` from the primary checkout. For an isolated branch, run `bun run worktree:new ../<path> -b <branch>` from the primary; the wrapper creates the worktree, runs `worktree:init`, and prints the assigned URLs, DB names, Redis index, and the next command. The lower-level `git worktree add ... && bun run worktree:init` path still works if you need it.
4. **Verify changes.** Default to `bun run verify:changed`, which runs `lint:changed`, `typecheck`, and `test:changed` sequentially behind the shared pre-commit lock/log/cache. Reach for `bun run verify` (full lint/typecheck/test) when changes touch global config (`bun.lock`, `tsconfig*.json`, vitest config) or you are validating a release-shaped state, and the primitive `lint:changed` / `typecheck` / `test:changed` / `format:changed` commands when iterating on a single check. See _Checking your work_ below for the cache, sequencing, and `FORCE_VERIFY` details.

## Commands

```bash
# Dev
bun run dev
bun run db:status

# Tests
bun run test[:server|:client|:shared|:changed|:coverage|:watch]
bun run e2e
bun run vitest run <file>

# Lint / typecheck / format
bun run lint[:fix|:changed]
bun run typecheck[:watch]
bun run format[:changed|:check]

# Verify (lint + typecheck + test umbrella)
bun run verify           # full lint, typecheck, test
bun run verify:changed   # lint:changed, typecheck, test:changed
bun run verify:logs [lint|typecheck|test|e2e] [--full]  # inspect cached logs

# DB
bun run --filter @musi/server db:{migrate,push,seed,reset,studio}
bun run db:migration-safety   # warn-only Prisma migration scanner

# Secondary worktrees
bun run worktree:{new,init,drop,gc,status,template-refresh,refresh-data}
```

Checking your work: pre-commit runs `lint:changed`, `typecheck`, and `test:changed` in parallel and caches results. For manual verification, prefer `bun run verify:changed` (or `bun run verify` for the full suite); the wrapper runs the same primitives sequentially, reuses the pre-commit lock/log/cache, and short-circuits on an unchanged worktree. The primitive commands stay available for focused iteration. Agent hook adapters may replay cached results on unchanged worktrees. Use `FORCE_VERIFY=1` only when you actually need to rerun. Never bypass hooks.

## Working Model

- Package flow is `shared` -> `server` -> `client`. Shared Zod schemas are the contract; derive types from them.
- Keep complex business logic in `packages/server/src/services/`, not inline in routers.
- tRPC owns queries and mutations. Socket.io manages room membership, presence, and broadcasts after persistence.
- Access JWT goes in `Authorization: Bearer`; refresh token is the httpOnly `musi_refresh` cookie.
- Use the campaign and character auth helpers; character ownership/access mismatches intentionally return `NOT_FOUND`. See `docs/authorization.md`.
- Server tests use `createTestApp()` and `cleanDb()`. Client tests use `src/test/mock-trpc.tsx`; wizard tests use `renderWizard()`. E2E page objects live in `e2e/page-objects/`.
- Work inside the devcontainer; do not run Docker commands. After Prisma schema edits, run `bun run --filter @musi/server prisma:generate`.
- Secondary git worktrees auto-provision isolated DBs, ports, and a Redis logical DB on first `bun run dev`.

## Code Standards

- No `any`; use `unknown` plus narrowing.
- No `as` except Prisma JSON boundaries.
- No barrel files; import from source.
- ESLint complexity 10 is the real design constraint. Refactor instead of disabling rules.
- Use tRPC error codes consistently.
- New hot-path tRPC procedures must declare `.output(schema)` with shared Zod schemas.
- Prisma schema changes require a migration.
- Race-sensitive writes go through `utils/*-mutations.ts`; read `docs/CONCURRENCY.md` before expanding that surface.

## Workflow

- Write tests first.
- Before calling work done, verify the user flow across shared -> server -> client.
- Own failing tests until you prove otherwise.
- For non-trivial work, create `docs/agent_notes/in_progress/<task>.md`; when it lands, keep only durable details in `LOG.md`, `DECISIONS.md`, or a small `finished_work/` note, and refresh `STATUS.md` / `NEXT.md` if the snapshot changed.
- If you commit, do not push to `main`; use `feature/...` or `fix/...` branches and conventional commits.

## Domain

When making 5e/5.5e rules claims, verify against `docs/SRD_CC_v5.2.1.pdf`. Canonical rule logic lives in `packages/shared/rules/`; check existing helpers before writing new ones.

## Gotchas

- No `TODO` comments without a linked issue or roadmap reference.
- Never delete "dead code" without tracing the exported symbol usage first.
- If `worktree:status` or `doctor` reports SRD seed drift in a secondary
  worktree, run `bun run worktree:refresh-data` to re-apply the SRD seed
  in place (preserves user-created dev rows; the seed upserts and does not
  delete reference rows that were removed, so the exact drift warning stays
  visible). Pass `--destructive` to drop and reclone dev/test/e2e DBs from
  the template instead — that wipes local dev data but guarantees the seed
  matches the checked-out branch exactly and clears the warning. Warm
  `worktree:init` only catches up migrations; it intentionally does not
  reseed existing DBs over local data.

## Agent Compatibility

- Shared agent behavior belongs in `scripts/ai-hooks/`.
- `.claude/` and `.codex/` should remain thin adapter layers for tool-specific hook APIs.
- Future Copilot/Gemini support should add wrappers that reuse `AGENTS.md` and the shared hook scripts rather than copying policy.
- Claude has Edit/Write hooks that Codex does not currently expose. The
  immediate `protected-files`, `doc-length`, and `prisma-generate` reactions
  are therefore Claude-only by design, but shared logic lives in
  `scripts/ai-hooks/` and `scripts/doc-length-policy.sh`; repo-level fallbacks
  cover the enforceable parts: pre-commit warns on staged hot-doc bloat and
  stale Prisma clients, and `db:status` reports Prisma client freshness.
