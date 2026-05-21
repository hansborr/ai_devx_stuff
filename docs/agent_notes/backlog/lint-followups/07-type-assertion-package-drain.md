# Leaf 7: Type-Assertion Package Drain

Status: Resolved 2026-05-20 — full package drain landed through batches 3a-6;
`ratchet/local-type-assertion-boundary` is at 0 current findings.
Sources:

- `docs/agent_notes/backlog/lint-hardening/12-type-assertion-boundary-lint.md`
- `docs/agent_notes/finished_work/lint-hardening-review-followup-pr-4-custom-ratchet.md`
- `lint-ratchet.baseline.json`

## Problem

`local/type-assertion-boundary` is enforced for e2e, scripts, and package code.
PR 4 originally captured 370 current findings, but the package drain completed
through the batch 6 entry-dialog leaf. This note remains provenance only.

## Scope

No active scope. Future work should use a new leaf if type-assertion findings
reappear or if the team wants to convert more of the ratcheted scope into normal
ESLint enforcement.

Valid fixes include:

- replacing convenience casts with real type narrowing,
- moving casts to framework/JSON/Prisma/test/interop boundaries,
- adding parseable boundary comments only where the assertion is truly a
  boundary, and
- deleting dead code or redundant helpers that only exist to satisfy a cast.

## Historical Candidate Work

- Rerun the ratchet and group current findings by package/module.
- Promote one high-value slice, such as shared rules, a server service family,
  or a client form module.
- Update `lint-ratchet.baseline.json` with lower counts after cleanup.
- Keep any increased count behind
  `bun run lint:ratchet:update -- --allow-worse --reason "<why>"` and a durable
  rationale.

## Historical Exit Criteria

- The promoted slice lowers the ratchet baseline or converts a coherent module
  family to strict enforcement.
- The baseline update is deterministic and improvement-only unless explicitly
  justified.

## Verification

- `bun run lint:ratchet`
- `bun run lint:ratchet:update`
- `bun run lint:ratchet:check-baseline`
- `bun run lint`
- Targeted tests for any production code rewritten
- `bun run verify:changed`
