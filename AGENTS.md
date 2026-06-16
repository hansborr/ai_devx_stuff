## Project

Musi is a 5E-compatible virtual tabletop and campaign management system built
on the SRD 5.2.1 ruleset.

- Monorepo: `packages/{shared,server,client}`
- Stack: TypeScript, Bun, Fastify, tRPC, Prisma/PostgreSQL, React, TanStack Query/Router, Tailwind v4, Socket.io
- Key docs: `docs/architecture-plan.md`, `docs/authorization.md`, `docs/socket-architecture.md`, `docs/CONCURRENCY.md`
- Task guides: see `docs/guides/` before tRPC, Prisma, socket, race-sensitive, client cache/socket, e2e, rules changes, or ratcheted-lint changes.

## Commands

`bun run` lists every script. Non-obvious ones:

- `bun run verify:changed` — default verification (lint:changed, typecheck, test:changed, test:scripts:changed). Stage intended source-relevant changes first; changed verification intentionally aborts on unstaged or untracked source-relevant work.
- `bun run --filter @musi/server db:migrate` / `prisma:generate` — schema change path; follow `docs/guides/add-prisma-migration.md`. `db:push` is local-only, never committed schema work.
- `bun run --filter @musi/server db:{push,seed,reset,studio}` — local DB utilities; package filter required.
- `bun run code:intel -- {def|exports|dependents|refs|tests} ...` — cross-file TypeScript symbol/import queries; resolves package exports, re-exports, and the client `@/*` alias. See `docs/guides/code-intel.md`.
- `bun run test:scripts:file -- <file>` (scripts project) or `bun run test -- <file>` (any project) — focused single-file test runs. Not `test:scripts -- <file>` (that is the shell smoke wrapper and rejects file args) and not `--filter @musi/scripts` (`scripts` is not a workspace package).

## Working Model

- Package flow is `shared` -> `server` -> `client`. Shared Zod schemas are the contract; derive types from them.
- Keep complex business logic in `packages/server/src/services/`, not inline in routers.
- tRPC owns queries and mutations. Socket.io manages room membership, presence, and broadcasts after persistence.
- For auth changes, read `docs/authorization.md`; use the campaign and character auth helpers and preserve intentional `NOT_FOUND` mismatch semantics.
- Use existing test helpers and e2e page objects; place focused unit/integration tests beside the code they cover.
- Read the nearest `MODULE.md` or `*-MODULE.md` before editing feature, service, hook, or socket areas that have one.

## Code Standards

- Avoid type assertions. Use them only at framework, JSON, Prisma, and test boundaries, or for `as const`; leave a short reason when the boundary is not obvious.
- Use tRPC error codes consistently.
- Prisma schema changes require a migration.
- Read `docs/CONCURRENCY.md` before expanding race-sensitive mutation helper surfaces.
- Before adding a client `useEffect`, read `docs/guides/client-effects.md`; effects are for external-system sync only (derived state, event logic, and tRPC/TanStack Query fetching are not effects).

## Workflow

- Use TDD.
- Use `feat/...` or `fix/...` branches and conventional commits. The local Husky `commit-msg` hook enforces: `<type>(<scope>): <subject>` with subject ≥ 20 chars, plus a non-empty body ≥ 40 chars.
- Commit your work, which runs tests for you automatically.
