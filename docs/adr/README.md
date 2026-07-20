# Architecture Decision Records

ADRs record non-obvious architectural or behavior-significant decisions that
have a deterministic gate. Repair recipes stay in `docs/guides/`, and detailed
operational invariants stay in architecture or `MODULE.md` documents.

## Lifecycle and numbering

- IDs use `ADR-NNNN`, are permanent, and are never reused.
- Files use `NNNN-lowercase-slug.md`; the prefix must match the ID.
- Status is `Proposed`, `Accepted`, `Deprecated`, or
  `Superseded by ADR-NNNN`.
- Material decision changes create a new ADR and supersede the old one.
- An accepted ADR without at least one resolvable `enforced_by` gate is
  invalid.

Run `bun run adr:check` to validate the records, their gate locators, and
active reverse references.

## Locator grammar

`enforced_by` contains typed, repository-resolvable locators:

- `eslint-rule:local/concurrency-guard`
- `restricted-import:RawTxClient`
- `type-boundary:packages/server/src/utils/prisma-types.ts#TxClient`
- `package-script:codemod:concurrency-guard`
- `test-file:packages/server/src/routers/invite-concurrency.test.ts`

## Template

Copy this into the next numbered ADR file. The frontmatter parser deliberately
accepts only these unquoted scalar and two-space list forms.

```markdown
---
id: ADR-NNNN
date: YYYY-MM-DD
status: Proposed
enforced_by:
  - test-file:path/to/deterministic.test.ts
guide: docs/guides/actionable-repair-guide.md
---

# Decision title

## Context

Why the decision is necessary.

## Decision

The invariant contributors must preserve.

## Consequences

What future changes must do and where the repair recipe lives.
```
