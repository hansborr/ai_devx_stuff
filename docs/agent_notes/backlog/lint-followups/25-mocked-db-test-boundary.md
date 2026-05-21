# Leaf 25: Mocked Database Test Boundary

Status: Parked until replacement helper boundary exists
Sources:

- `docs/agent_notes/backlog/lint-hardening-cross-repo-review.md`

## Problem

The hardening index called out mocked database tests as a known AI footgun:
tests can pass against mocked persistence while missing real Prisma,
transaction, authorization, or helper behavior. The item was deferred because a
lint or sensor is only useful when it can name a sanctioned replacement path.

## Scope

Do not add a blanket ban on mocks. Start with server/router/service test
families where a replacement helper is already clear, such as `createTestApp`,
`cleanDb`, `createTestUser`, `test-db`, or a module-specific pure resolver
boundary.

## Candidate Work

- Inventory current `vi.mock(...)`, module mock, and hand-rolled database
  stand-in patterns in server and shared tests.
- Separate legitimate pure-unit seams from mocks that should use the real test
  database or existing app/test helpers.
- Document or create the replacement helper before writing any lint rule or
  sensor.
- If the policy is narrow enough, add a local lint rule or script sensor whose
  diagnostic names the sanctioned helper path.
- If no clean boundary exists, keep the item deferred and record the missing
  helper explicitly.

## Exit Criteria

- One test family is migrated away from an unsafe mocked database pattern, or
  the policy is explicitly deferred with the missing helper named.
- Any new lint/sensor is scoped to the proven unsafe pattern and has repair
  guidance.

## Verification

- `rg` or AST inventory before and after
- Targeted server/shared tests for migrated test families
- `bun run lint -- --max-warnings=0` if adding lint coverage
- `bun run test:changed`
- `bun run verify:changed`
