# 36. `trpc-require-output-schema` analyzes only chains rooted at `*Procedure` — aliased builders escape

Status: Done — implemented on fix/lint-alias-binding-lane. Re-verified file:line before acting.
Lens: local rules · Area: tRPC contract · Severity: med · Size: M · Confidence: high
Theme: rule-false-negative · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`analyzeProcedureChain` walks a call chain to its root identifier and bails
unless the root matches `publicProcedure`/`protectedProcedure`/`*Procedure`.
Splitting the chain through a variable defeats it:

```ts
const authed = protectedProcedure.input(inputSchema);
authed.query(async () => value);   // missing .output(...) — not reported
```

The sibling rules `trpc-shared-input-schema`/`trpc-shared-output-schema`
share the chain-walking approach, so the same bypass likely applies there —
confirm while fixing.

## Evidence
- `eslint-rules/trpc-require-output-schema.js:23-26,34-35` — root-name requirement; `:86` early-returns for non-procedure roots (`authed`). Verified 2026-07-04.

## Proposed direction
Resolve the root identifier through scope analysis: if the variable's init is
itself a procedure chain (recursively), treat the variable as
procedure-rooted and merge the chain segments seen across both statements
when checking for `.output(...)`/`.input(...)` presence. Cache per-variable
analysis on the `Variable` object to stay linear. Add tests: aliased builder
with and without output, alias reused by multiple procedures, alias imported
from another module (out of scope — document as a known hole rather than
guessing cross-module).

## Scope / caveats
- Shared fix shape with leaves 31/32/38 (binding-aware resolution) — build
  the small scope-resolution helper once in a rule-lib and reuse.
- Check current codebase for the alias pattern before assuming zero findings;
  routers are heavily conventioned, so expect zero, but if found they start
  as a ratchet entry per house rules.
- Accepted limitation from review follow-up: alias analysis follows local
  declaration initializers and caches by binding. Reassigned `let` procedure
  builders are out of scope; router builder aliases should stay `const`.
- One commit: helper + rule + tests (plus sibling-rule confirmation).
