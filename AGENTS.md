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

Treat everything else in `docs/agent_notes/` as on-demand context:

- `docs/agent_notes/LOG.md` - landed-work history.
- `docs/agent_notes/in_progress/` - only the notes named in `STATUS.md`.
- `docs/agent_notes/backlog/` - parked workstreams; only when re-triaging or explicitly asked.
- `docs/agent_notes/finished_work/README.md` - index into archived notes.
- `docs/agent_notes/finished_work/` - archived task notes.
- `docs/roadmap/*.md` - only when the task lands in that scope.

Use `docs/agent_notes/NEXT.md` as the active queue. When a leaf lands, update
durable handoff history, remove or retier it from `NEXT.md`, and promote one
next ready leaf only from the source named by `STATUS.md` / `NEXT.md` or after
explicit re-triage.

Keep these files short. Agent hook adapters may nudge on doc bloat. `STATUS.md`
is a snapshot; `LOG.md` is curated recent history, not a complete archive.

## Cold Start

For a cold-start contributor or AI on a fresh checkout:

1. **Orient.** Read `docs/agent_notes/STATUS.md` and `docs/agent_notes/NEXT.md` first — they name the active task and the file to open next.
2. **Read only what the task touches.** Open `docs/architecture-plan.md`, `docs/authorization.md`, `docs/socket-architecture.md`, or `docs/CONCURRENCY.md` only when your change crosses that surface. Open local `MODULE.md` / `*-MODULE.md` files only for directories you edit. For cross-file TypeScript symbol work, prefer `bun run code:intel -- ...`; it resolves package exports, re-exports, and the client `@/*` alias.
   New or refreshed module docs follow `docs/module-docs.md`; refresh
   `MODULE-INDEX.md` with `bun run module:index` when module docs move.
3. **Get a working environment.** Run `bun install`, then `bun run dev` from the primary checkout. For an isolated branch, use `bun run worktree:new ../<path> -b <branch>` from the primary; it prints the assigned URLs, DB names, Redis index, and next command.
4. **Verify changes.** Default to `bun run verify:changed`. Use `bun run verify` for global config or release-shaped validation, and the primitive lint/typecheck/test/format commands for focused iteration.

## Commands

```bash
# Dev
bun run dev
bun run db:status

# Tests
bun run test[:server|:client|:shared|:changed|:coverage|:watch]
bun run test:slow             # explicit slow tier (*.slow.test.{ts,tsx})
bun run test:mutation         # manual Stryker audit for rules/assertion strength
bun run test:scripts[:changed]
bun run e2e
bun run vitest run <file>

# Lint / typecheck / format
bun run lint[:fix|:changed]
bun run typecheck[:watch]
bun run format[:changed|:check]

# Code intel (read-only graph queries + exact-name definitions; see docs/guides/code-intel.md)
# Codex skill source: .codex/skills/code-intel/SKILL.md
bun run code:intel -- {def|exports|dependents|refs|tests} ...
bun run code:intel:server -- {status|restart|stop}

# Verify / diagnostics
bun run doctor
bun run verify           # full lint, typecheck, test, test:scripts
bun run verify:changed   # lint:changed, typecheck, test:changed, test:scripts:changed
bun run verify:slow      # verify + test:slow (deliberate, kept out of hooks)
bun run verify:logs [lint|typecheck|test|e2e] [--full]  # inspect cached logs

# DB
bun run --filter @musi/server db:{migrate,push,seed,reset,studio}
bun run db:migration-safety   # warn-only Prisma migration scanner

# Docs
bun run module:index[:check]

# Secondary worktrees
bun run worktree:{new,init,drop,gc,status,template-refresh,refresh-data}
```

Checking your work: pre-commit runs `lint:changed`, `typecheck`, and
`test:changed` in parallel, plus `test:scripts:changed` when staged hook or
script files need it. `bun run verify:changed` runs the changed checks
sequentially and reuses the shared lock/log/cache; use `FORCE_VERIFY=1` only
when a real rerun is needed. Never bypass hooks.

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

- Avoid explicit `any`; prefer `unknown` plus narrowing, an existing shared type, or a small local type. If a boundary is intentionally untyped, suppress the exact line with a reason.
- Avoid type assertions. Use them only at framework, JSON, Prisma, and test boundaries, or for `as const`; leave a short reason when the boundary is not obvious.
- No barrel files; import from source. Use `bun run codemod:expand-barrel -- --barrel <path>` when removing an existing barrel.
- ESLint complexity 10 is the real design constraint. Refactor instead of disabling rules.
- Use tRPC error codes consistently.
- New and changed tRPC queries/mutations must declare `.output(schema)` with shared Zod schemas.
- Prisma schema changes require a migration.
- Race-sensitive writes go through `utils/*-mutations.ts`; read `docs/CONCURRENCY.md` before expanding that surface.

## Workflow

- Write tests first.
- Before calling work done, verify the user flow across shared -> server -> client.
- Own failing tests until you prove otherwise.
- Agents may delegate when their harness supports it for bounded exploration,
  verification, disjoint implementation work, or reviewing their own changes
  before handoff; keep delegated tasks concrete and avoid overlapping edits.
- For non-trivial work, create `docs/agent_notes/in_progress/<task>.md`; when it lands, keep only durable details in `LOG.md`, `DECISIONS.md`, or a small `finished_work/` note, and refresh `STATUS.md` / `NEXT.md` if the snapshot changed.
- If you commit, do not push to `main`; use `feature/...` or `fix/...` branches and conventional commits.

## Domain

When making 5e/5.5e rules claims, verify against `docs/SRD_CC_v5.2.1.pdf`. Canonical rule logic lives in `packages/shared/src/rules/`; check existing helpers before writing new ones.

## Gotchas

- No `TODO` comments without a linked issue or roadmap reference.
- Never delete "dead code" without tracing the exported symbol usage first.
- Agent hooks block hook bypasses, Docker/direct DB/Redis CLIs, destructive
  Git or history rewrites, protected-branch pushes, GitHub mutations/auth
  changes, and raw shell `grep`. Use repo scripts, non-destructive Git,
  read-only `gh`, `rg` / `git grep`, or `bun run code:intel -- ...` as
  appropriate. Full search guidance lives in `docs/guides/code-intel.md`.
- If `worktree:status` or `doctor` reports SRD seed drift in a secondary
  worktree, run `bun run worktree:refresh-data` to preserve local dev rows, or
  pass `--destructive` to reclone dev/test/e2e DBs from the template and wipe
  local dev data.

## Agent Compatibility

Shared agent behavior belongs in `scripts/ai-hooks/`; `.claude/` and `.codex/`
should stay thin adapters. See `docs/ai-harness.md` before adding harness
policy or new global instructions.
