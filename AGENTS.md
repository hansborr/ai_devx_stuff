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
- Secondary git worktrees: `bun run dev` auto-runs `worktree:init` to provision per-worktree DBs, ports, Redis, and env files. See `docs/guides/per-worktree-dev.md`.

## Working Model

- Package flow is `shared` -> `server` -> `client`. Shared Zod schemas are the contract; derive types from them.
- Keep complex business logic in `packages/server/src/services/`, not inline in routers.
- tRPC owns queries and mutations. Socket.io manages room membership, presence, and broadcasts after persistence.
- For auth changes, read `docs/authorization.md`; use the campaign and character auth helpers and preserve intentional `NOT_FOUND` mismatch semantics.
- Use existing test helpers and e2e page objects; place focused unit/integration tests beside the code they cover.
- Read the nearest `MODULE.md` or `*-MODULE.md` before editing feature, service, hook, or socket areas that have one.

## Code Standards

- Avoid type assertions. `as const` is always allowed; every other cast outside `*.test`/`*.spec`/`*.test-helper` files needs a parseable marker `// type-assertion-boundary: <category> - <reason>` where `<category>` is one of the five enforced by `local/type-assertion-boundary`: `framework`, `json`, `prisma`, `test`, `interop` (`interop` = a runtime invariant TS can't express, e.g. widening `Object.entries`/`Object.keys` results or narrowing a runtime predicate). Place the marker on the same line after the cast, or anywhere in the JSDoc/`//` comment block directly above the statement. A prose reason without the marker, or any other category, fails lint. See [`docs/guides/local-eslint-rules.md`](docs/guides/local-eslint-rules.md#type-assertion-boundary-marker).
- Use tRPC error codes consistently.
- Prisma schema changes require a migration.
- Read `docs/CONCURRENCY.md` before expanding race-sensitive mutation helper surfaces.
- Before adding a client `useEffect`, read `docs/guides/client-effects.md`; effects are for external-system sync only (derived state, event logic, and tRPC/TanStack Query fetching are not effects).

## Workflow

- Use TDD.
- Use `feat/...` or `fix/...` branches and conventional commits. The local Husky `commit-msg` hook enforces: `<type>(<scope>): <subject>` with subject ≥ 20 chars, plus a non-empty body ≥ 40 chars.
- Commit your work, which runs tests for you automatically.
- Fast-commit mode (opt-in, off by default): `touch "$(git rev-parse --git-common-dir)/musi-fast-commit"` makes pre-commit skip only the slow `test`+`scripts` slots (lint, ratchet, typecheck, and format still run every commit) for cheap multi-commit feature branches; `rm` the marker to disable. Land such a branch with `bash scripts/land.sh`, which runs the full sequential `verify` (always every slot) and then `git merge --no-ff` into the protected branch.
