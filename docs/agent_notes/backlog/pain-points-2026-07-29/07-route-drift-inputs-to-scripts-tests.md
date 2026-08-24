# Route Drift-Guard Inputs to Scripts Tests

Status: Closed (won't fix)
Date: 2026-07-29
Priority: P1
Size: S
Source: `focused-verification-gaps.md` — “Changed selection misses behavioral
dependencies”

## Problem

The scripts-project concurrency drift guard reads four runtime inputs directly
from the filesystem:

- `eslint-rules/concurrency-guard.js`
- `eslint-rules/concurrency-guard-nested-corpus.json`
- `packages/server/src/utils/prisma-types.ts`
- `packages/server/prisma/schema.prisma`

Because these are filesystem reads rather than module imports, Vitest's
dependency graph cannot relate a change in any of them to
`scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts`.

## Disposition

This changed-selection gap is accepted deliberately. No routing or generated
snapshot will be added for these inputs.

The decisive constraint is that `scripts/test-changed.sh` composes Vitest
`--project=` filters from path classification before Vitest sees any dependency
graph. A `packages/server/*` change sets only the server classification
(`scripts/test-changed.sh:201-205`), and an `eslint-rules/*` change sets only the
ESLint-rules classification (`:216-219`). Project arguments are then assembled
from those flags at `:289-315`. The `scripts` project is absent from either
invocation, so no static import or other module edge inside that project can
select the drift test.

Two other properties make the former generated-snapshot direction a poor fit:

- A generated artifact beside the codemod would match `scripts/codemods/*` and
  set the single global `full_run` flag (`scripts/test-changed.sh:228-232`).
  That drops `--changed` from the whole selected project set at `:317-320`,
  reproducing the local-latency regression through regeneration.
- A module edge would exist only after regeneration. More importantly, a
  name-only projection of `prisma-types.ts` would not represent the guard's
  type-structure assertions: `BanWrites`, the branded mutators, and the
  `TxClient`/`DbClient` shapes are inspected directly
  (`concurrency-guard-drift.test.ts:298-345,386-427`).

Generated-surface freshness is a real blocking CI check:
`scripts/harness-check.ts:90-101,140` runs every registered `checkScript`, and
`.github/workflows/ci.yml:204-205` runs `harness:check`. Pre-commit freshness is
advisory (`.husky/pre-commit:289-290,376-377`). That corrected fact bounds a
stale-artifact window, but it does not overcome project selection or the
snapshot's incomplete representation.

## Accepted coverage trade

CI runs full `bun run verify` for every pull request to `main`
(`.github/workflows/ci.yml:3-5,75-81`). Its test slot runs full `bun run test`
(`scripts/verify/steps.generated.sh:65`), whose Vitest workspace includes the
scripts project (`vitest.config.ts:26-38`). The drift guard therefore remains a
blocking PR check.

The accepted cost is local feedback latency: edits to `prisma-types.ts`,
`schema.prisma`, the ESLint rule, or its corpus do not select the scripts drift
test through `test:changed`. Contributors can still run the focused guard or a
full verify locally; CI remains the mandatory coverage gate. This is a
deliberate trade in exchange for keeping path-specific and multi-phase routing
machinery out of `scripts/test-changed.sh`.

The shell smoke now also pins the reverted attempt's failure mode: a server
change under the `verify:changed` reporter/output-file argv shape must retain
`--changed main` and must not add `--project=scripts`.

## Optional owner decisions

Two follow-ups solve ownership or duplication problems rather than this routing
gap. They are owner decisions and are neither prescribed nor implemented here:

- Single-source the rule/codemod concurrency vocabulary where the loader
  boundaries permit it.
- Generate `GATED_RELATION_FIELDS` from `packages/server/prisma/schema.prisma`.
