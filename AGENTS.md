# AGENTS.md

Shared guidance for AI coding agents working in this repository.

## Project

Musi is a D&D 5.5E virtual tabletop and campaign management system.

- Monorepo: `packages/{shared,server,client}`
- Stack: TypeScript, Bun, Fastify, tRPC, Prisma/PostgreSQL, React, TanStack Query/Router, Tailwind v4, Socket.io
- Key docs: `docs/architecture-plan.md`, `docs/authorization.md`, `docs/socket-architecture.md`, `docs/CONCURRENCY.md`
- Task guides: see `docs/guides/` before tRPC, Prisma, socket, race-sensitive, client cache/socket, e2e, rules changes, or ratcheted-lint changes.

## Agent Notes

On every session start, read `docs/agent_notes/STATUS.md` and `docs/agent_notes/NEXT.md`. Everything else under `docs/agent_notes/` is on-demand. When a leaf lands, update durable handoff (`LOG.md`, `DECISIONS.md`, or a `finished_work/` note) and refresh `STATUS.md` / `NEXT.md` if the snapshot changed.

## Commands

`bun run` lists every script. Non-obvious ones:

- `bun run verify:changed` — default verification (lint:changed, typecheck, test:changed, test:scripts:changed). Set `FORCE_VERIFY=1` to bypass the unchanged-worktree cache.
- `bun run --filter @musi/server db:migrate` / `prisma:generate` — schema change path; follow `docs/guides/add-prisma-migration.md`. `db:push` is local-only, never committed schema work.
- `bun run --filter @musi/server db:{push,seed,reset,studio}` — local DB utilities; package filter required.
- `bun run code:intel -- {def|exports|dependents|refs|tests} ...` — cross-file TypeScript symbol/import queries; resolves package exports, re-exports, and the client `@/*` alias. See `docs/guides/code-intel.md`.

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

## Workflow

- Use TDD.
- Use subagents as you work (exploring code, reviewing changes, etc).
- Before calling work done, verify the user flow across shared -> server -> client.
- For non-trivial work, create `docs/agent_notes/in_progress/<task>.md`; when it lands, keep only durable details in `LOG.md`, `DECISIONS.md`, or a small `finished_work/` note.
- If you commit, use `feature/...` or `fix/...` branches and conventional commits. The `commit-msg` hook enforces: `<type>(<scope>): <subject>` with subject ≥ 20 chars, plus a non-empty body ≥ 40 chars (trailers like `Co-Authored-By:` don't count). Merge, revert, fixup, and squash commits are exempt.

## Domain

When making 5e/5.5e rules claims, verify against `docs/SRD_CC_v5.2.1.pdf`. Canonical rule logic lives in `packages/shared/src/rules/`; check existing helpers before writing new ones.
