# Leaf 40: logs-audit And drift Entry-Point Lint Adoption

Status: Drafted 2026-05-20 - parked ratchet-first/drain leaf
Sources:

- `docs/agent_notes/backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- `scripts/logs-audit.ts`
- `scripts/drift-ai.ts`
- `scripts/drift-ai.test.ts`
- `scripts/code-intel.test.ts`

## Problem

Some script entrypoints and large script-side tests remain outside normal
ESLint coverage even after smaller adjacent files landed:

- `logs-audit.ts` at 769 physical lines.
- `drift-ai.ts` at 1202 physical lines.
- `drift-ai.test.ts` at 1642 physical lines.
- `code-intel.test.ts` at 2183 physical lines.

These are not good first cleanup files, but they should not stay invisible
after the lower-risk script leaves land.

## Scope

Inventory and split the large script entrypoint/test files after Leaves 31-34
and 39 have ratcheted their surrounding helper surfaces. This leaf is expected
to split again if the fresh inventory shows independent workstreams.

## Ratchet-First Enforcement

Before moving helpers or splitting large tests, add ratchet coverage for these
large files at current counts. This leaf is specifically for avoiding another
"too large to lint, therefore unenforced" gap. Normal lint adoption comes after
baseline drains.

## Candidate Work

- Re-run lint inventory for the four files after adjacent helper leaves land.
- Add scoped ratchet entries for current findings before cleanup.
- Move CLI parsing, scenario fixtures, and assertion helpers into linted helper
  modules where that reduces test-file size without hiding complexity.
- For large tests, split by feature area rather than line count alone:
  daemon/client behavior for code-intel, scope/report modes for drift-ai, and
  log-state classification for logs-audit.
- Add each cleaned file to normal script lint coverage only after its ratcheted
  findings drain.

## Exit Criteria

- At least one large entrypoint/test file has current-count ratchet coverage,
  or this leaf splits into smaller per-file leaves with current inventories and
  ratchet plans.
- New or higher finding counts fail `bun run lint:ratchet`.
- Extracted helpers are linted and covered by existing shell or Vitest tests.
- No fixture or generated directory is pulled into lint accidentally.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh` if ratchet runner/source support changes
- Temporary-violation probe if any new ratchet scope starts at 0 findings
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bash scripts/test-code-intel.sh`
- Relevant logs-audit and drift-ai script tests selected by
  `bun run test:scripts:changed`
- `bun run drift:ai --scope current`
- `bun run test:scripts:changed`
- `bun run verify:changed`
