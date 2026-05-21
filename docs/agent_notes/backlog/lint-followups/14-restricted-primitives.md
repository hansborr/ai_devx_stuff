# Leaf 14: Restricted Primitives Follow-ups

Status: 14a clock-primitive slice resolved/deferred; 14b `process.env`
slice adopted; 14c raw `fetch` slice adopted. Direct timers or polling loops
in tests remain parked.
Sources:

- `docs/agent_notes/backlog/lint-hardening/11-restricted-primitives.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-14a-clock-primitives-inventory.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-14b-process-env-adoption.md`
- `docs/agent_notes/finished_work/lint-hardening-leaf-14c-raw-fetch-adoption.md`

## 14c Resolution (2026-05-19)

Raw `fetch(...)` calls were inventoried over production source in
`packages/shared/src/**`, `packages/server/src/**`,
`packages/client/src/**`, and `scripts/**`, excluding tests, test helpers,
and `packages/server/src/generated/**`. The probe found 0 shared rows and
0 script rows. Server had three `rg` rows in
`packages/server/src/utils/srd-query-helpers.ts`, but those are DI-pattern
calls to a shadowing parameter named `fetch`, not raw global fetch sites.
Client had two sanctioned bare global fetch boundaries: the auth-token
refresh endpoint in `packages/client/src/lib/trpc.ts` and the multipart
map-image upload in `packages/client/src/hooks/use-map-image-upload.ts`.
Outcome: **adopt the raw global `fetch` `no-restricted-globals` ban with a
scoped client allowlist**. `no-restricted-globals` is intentionally preferred
over a `no-restricted-syntax` `CallExpression` selector because it reports
only unresolved global identifiers, skipping the server DI parameter, the
tRPC object method named `fetch`, and explicit `globalThis.fetch(...)`
member-expression calls.

## 14b Resolution (2026-05-19)

Raw `process.env` member access was inventoried over production source in
`packages/shared/src/**`, `packages/server/src/**`, and `scripts/**`,
excluding tests, test helpers, and `packages/server/src/generated/**`.
The final probe found 0 shared rows and 0 unsanctioned server production
rows outside named allowlist sites. `packages/server/src/config/env.ts`
is now the sanctioned server env reader; the one unsanctioned production
read, `packages/server/src/prisma/client.ts` reading `DATABASE_POOL_MAX`,
moved into the env schema as an optional positive integer consumed through
`serverEnv.databasePoolMax`. Outcome: **adopt the `process.env`
`no-restricted-syntax` ban with scoped allowlist caveats**. Allowlisted
boundaries are the env helper itself, the db-status admin display tool,
child-process spawn `env: process.env` pass-through scripts, and the
pre-existing bootstrap/seed/CLI terminator files covered by the shared
restricted-primitive override. Test/helper/e2e setup files remain outside
the production `process.env` ban while retaining the `process.exit(...)`
selector.

## 14a Resolution (2026-05-19)

Raw clock primitives (`Date.now()`, `new Date(`) were inventoried over
production source in `packages/shared/src/**` and `packages/server/src/**`,
excluding tests and test helpers. The final probe found 0 shared rows and
20 server rows after excluding `*-test-helper.ts`; the legacy probe shape
without that exclude reports 22 server rows because
`packages/server/src/services/level-up/level-up-test-helper.ts` contributes
two test-helper false positives. The 20 production rows classify as
7 input-date-parsing / 3 persisted-now-write / 3 expiry-computation /
3 expiry-comparison / 2 rate-limit-window / 2 logging-timestamp /
0 other. Outcome: **defer a raw clock primitive ban until a sanctioned
clock helper exists**. A naive `new Date(` ban would flag the 7 parsed
cursor/date-field constructors that are not clock reads, while the genuine
clock reads need an injectable `Clock` surface such as `now(): Date` and
`nowMs(): number` threaded through server context/service factories before
the diagnostic can name a repair path. No production rewrite landed.

## Problem

`process.exit(...)` is gated, but other dangerous primitives remain policy
candidates. Each needs a sanctioned helper or boundary before lint can produce
a useful diagnostic.

## Scope

Candidates:

- raw `fetch(...)`;
- direct `process.env` reads;
- `Date.now()` and `new Date()` in deterministic shared/server logic;
- direct timers or polling loops in tests.

Do not write a ban until the diagnostic can name the sanctioned alternative.

## Candidate Work

- Inventory one primitive at a time.
- Identify or create the helper/wrapper boundary first:
  - app API/client helper for raw fetch,
  - `loadServerEnv` or package-specific env readers,
  - clock helper for deterministic rules/services,
  - test wait helper for timers/polling.
- Use `no-restricted-syntax`, `no-restricted-properties`, or a local rule
  depending on how much context is needed.
- Keep legitimate bootstrap, config, seed, serializer, and UI display
  boundaries explicit.

## Exit Criteria

- One primitive is either gated, deferred with missing-boundary rationale, or
  rejected after inventory.
- Any lint diagnostic names the repair path.

## Verification

- `rg` or AST inventory before and after
- `bun run lint -- --max-warnings=0`
- `bun run vitest run --project=eslint-rules` if adding a local rule
- Targeted tests for helper rewrites
- `bun run verify:changed`
