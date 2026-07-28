---
id: ADR-0004
date: 2026-07-25
status: Accepted
enforced_by:
  - eslint-rule:local/strict-trpc-input
  - eslint-rule:local/trpc-require-output-schema
  - eslint-rule:local/trpc-shared-input-schema
  - eslint-rule:local/trpc-shared-output-schema
  - package-script:codemod:trpc-shared-input
  - package-script:codemod:trpc-shared-output
  - test-file:packages/server/src/routers/app-router.output-coverage.test.ts
guide: docs/guides/add-trpc-procedure.md
---

# tRPC procedures use shared schemas and explicit outputs

## Context

A router that declares its input or output shape inline owns a private copy of
the wire contract. The client then derives its expectation from the tRPC type
inference of that copy, so the two drift silently: a renamed field, a widened
union, or a dropped property type-checks on both sides while the running
response no longer matches. Unknown input keys are worse than a rename — a
non-strict `z.object` accepts a client typo, discards it, and the procedure
proceeds with a default the caller never intended.

A declared output is only a contract if it constrains something.
`.output(z.unknown())`, `z.any()`, or a schema that accepts `undefined` at the
top level satisfies the "has an output" check while guaranteeing nothing.

## Decision

Every router query and mutation declares `.output(schema)`, and every procedure
that accepts client data declares `.input(schema)`. Both schemas are imported
from a `packages/shared/src/schemas/` module — outputs from a named
result/detail/summary schema. Inline `z.object(...)` at the router is not an
alternative, and neither is a local copy of a shared shape. `*-inputs.ts` is the
convention the repair codemod targets, but the gate checks the shared-schema
import, not the filename: a query input that lives beside its domain schema
(`listSpellsInputSchema` in `spell.ts`) is a conforming input, and moving it is
not a fix for anything.

Permissiveness is judged structurally, not syntactically. The output-coverage
test rejects `z.any()` at any depth, and rejects `z.unknown()` or a schema
accepting `undefined` at the top level. Nested `z.unknown()` is deliberately
allowed: heterogeneous stored JSON (combat-log rolls, map-layer data, choice
data) has no honest typed shape, and the surrounding schema still constrains
where it may appear. Mutations are enforced unconditionally; the query allowlist
in that test file is a reviewed exception list carrying a written reason, not a
parking space.

Two parts of this boundary are convention rather than gate, and should be read
that way. The lint pair runs only over `packages/server/src/routers/**/*.ts`, so
a procedure factory outside that scope — `packages/server/src/utils/srd-query-helpers.ts`
composes a generic `.input(input)` with an inline `.output(z.array(item))` — is
unchecked by lint; the output-coverage test still walks the assembled router, so
the output side is covered at runtime while the input side is not gated there.
And `local/strict-trpc-input` only fires on an inline `z.object(...)` at the call
site, which the shared-import rule already forbids in routers, so input
strictness is enforced at the schema definition site by review and schema tests.

## Consequences

Adding a procedure without an output schema, with a non-strict input object, or
with a router-local schema fails lint before it reaches review; the two
`codemod:trpc-shared-*` scripts move the simple shapes, and `.extend`/`.merge`/
`.and`/`.or` shapes move by hand. Widening an output means editing the shared
schema, which makes the client's compile the change-detection surface. Growing
the query allowlist is a review signal. See the linked guide for the authoring
sequence and `packages/server/src/routers/routers-MODULE.md` for which router
owns a new procedure.
