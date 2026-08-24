> **Preserved upstream artifact.** This is the always-loaded agent brief
> (`AGENTS.md`) from the upstream Musi repo, kept here as an example of the
> feedforward-context pattern the harness docs describe. Its commands and
> workflow rules apply to the full upstream repo, **not** to this partial
> clone — see this repo's own [`AGENTS.md`](../AGENTS.md). Re-copied on
> every `sync-from-upstream` run; do not edit by hand.

## Project

Musi is a 5E-compatible virtual tabletop and campaign management system built
on the SRD 5.2.1 ruleset.

- Monorepo: `packages/{shared,server,client}`
- Stack: TypeScript, Bun, Fastify, tRPC, Prisma/PostgreSQL, React, TanStack Query/Router, Tailwind v4, Socket.io
- Key docs: `docs/architecture-plan.md`, `docs/authorization.md`, `docs/socket-architecture.md`, `docs/CONCURRENCY.md`, `docs/ai-harness.md`
- Task guides: see `docs/guides/` before tRPC, Prisma, socket, race-sensitive, client cache/socket, e2e, rules changes, or ratcheted-lint changes (`docs/guides/lint-ratchet.md`).

## Commands

`bun --cwd="$(git rev-parse --show-toplevel)" pm pkg get scripts` lists every
root script without Bun's CLI help preamble. Non-obvious ones:

- Root scripts resolve against the nearest `package.json`. From a package subdirectory, run `bun --cwd="$(git rev-parse --show-toplevel)" run <script> [-- <args>]`; this preserves the script's arguments and exit status. Use this form for root-only tools such as `doctor`, `backlog:lint`, `harness:check`, and `worktree:status`. Keep the `=` in `--cwd=...`; Bun 1.3 otherwise prints help instead of running the script.

- `bun run verify:changed` — default manual verification when you need a pre-commit check. Runs the generated changed-mode slot set (`MUSI_VERIFY_CHANGED_STEPS` in `scripts/verify/steps.generated.sh`) in parallel via `scripts/verify.sh`. Stage intended source-relevant changes first; changed verification intentionally aborts on unstaged or untracked source-relevant work.
- `bun run --filter @musi/server db:migrate` / `prisma:generate` — schema change path; follow `docs/guides/add-prisma-migration.md`. `db:push` is local-only, never committed schema work.
- `bun run --filter @musi/server db:{push,seed,reset,studio}` — local DB utilities; package filter required.
- `bun run test:scripts:file -- <file>` is for scripts Vitest files (`*.test.ts`/`*.test.tsx`); use `bun run test -- <file>` for Vitest files in any project. Run one shell smoke directly with `bash <path>` or the registered shell-smoke suite with `bun run test:scripts`. Not `test:scripts -- <file>` (that wrapper rejects file args) and not `--filter @musi/scripts` (`scripts` is not a workspace package).
- Secondary git worktrees: `bun run dev` auto-runs `worktree:init` to provision per-worktree DBs, ports, Redis, and env files. See `docs/guides/per-worktree-dev.md`.
- `bun run doctor` — read-only environment-sanity escape hatch: env-file, port, dependency-freshness, and lint-suppression-drift checks with exact follow-up commands. Run it when something feels off locally.
- `bun run harness:check` — validates `harness.controls.json` against the live tree (hook wiring, generated verify data, lint guidance); run after touching hook, settings, manifest, or generated harness surfaces. Related: `harness:audit`, `docs:harness-controls:check`.

## Working Model

- Package flow is `shared` -> `server` -> `client`. Shared Zod schemas are the contract; derive types from them.
- Keep complex business logic in `packages/server/src/services/`, not inline in routers.
- tRPC owns queries and mutations. Socket.io manages room membership, presence, and broadcasts after persistence.
- For auth changes, read `docs/authorization.md`; use the campaign and character auth helpers and preserve intentional `NOT_FOUND` mismatch semantics.
- Use existing test helpers and e2e page objects; place focused unit/integration tests beside the code they cover.
- Read the nearest `MODULE.md` or `*-MODULE.md` before editing feature, service, hook, or socket areas that have one; follow `docs/guides/add-module-doc.md` to create or refresh one.

## Code Standards

- Avoid type assertions. `as const` is always allowed; every other cast outside `*.test`/`*.spec`/`*.test-helper` files needs a parseable marker `// type-assertion-boundary: <category> - <reason>` where `<category>` is one of the five enforced by `local/type-assertion-boundary`: `framework`, `json`, `prisma`, `test`, `interop` (`interop` = a runtime invariant TS can't express, e.g. widening `Object.entries`/`Object.keys` results or narrowing a runtime predicate). Place the marker on the same line after the cast, or anywhere in the JSDoc/`//` comment block directly above the statement. A prose reason without the marker, or any other category, fails lint. See [`docs/guides/local-eslint-rules.md`](docs/guides/local-eslint-rules.md#type-assertion-boundary-marker).
- Use tRPC error codes consistently.
- Prisma schema changes require a migration.
- Read `docs/CONCURRENCY.md` before expanding race-sensitive mutation helper surfaces.
- Before adding a client `useEffect`, read `docs/guides/client-effects.md`; effects are for external-system sync only (derived state, event logic, and tRPC/TanStack Query fetching are not effects).

## Workflow

- Use TDD.
- Use `feat/...` or `fix/...` branches and conventional commits; if you start from `main`, branch before the first commit. The local Husky `commit-msg` hook enforces: `<type>(<scope>): <subject>` with subject ≥ 20 chars, plus a non-empty body ≥ 40 chars.
- Commit completed work without asking first. Commit incrementally by logical unit; do not defer a large mixed change to the end.
- Treat the commit gate as the normal verification step. While building, run focused tests for the files you change; run `verify:changed` directly only when you are not committing or when troubleshooting a gate failure.
- Ask before push, PR creation, or branch integration. Integrate finished branches with a merge commit (`git merge --no-ff`) unless the user explicitly asks for a fast-forward.
- Fast-commit mode (opt-in, off by default): `touch "$(git rev-parse --git-common-dir)/musi-fast-commit"` makes pre-commit skip only the slow `test`+`scripts` slots (lint, ratchet, typecheck, and format still run every commit) for cheap multi-commit feature branches; `rm` the marker to disable. Land such a branch with `bash scripts/land.sh`, which runs the full sequential `verify` (always every slot) and then `git merge --no-ff` into the protected branch. The marker lives in the shared git dir, so it applies to every worktree of the repo. Before fanning multi-lane work out from a fast-commit base, run `bun run verify` once on the base first: fast-commit lets the base itself carry deferred test debt, and a pre-dispatch baseline keeps land-time failures attributable to the lanes rather than to the base.
If you come across a pain point as you work, read the index at
`/home/node/persist/musi/pain_points.log` and update the closest focused note
under `/home/node/persist/musi/pain_points/`. If no topic fits, create a
kebab-cased Markdown note and add one concise link/summary to the index. Do not
append chronological prose directly to the index.
