# 32. `no-outer-client-in-transaction` exempts any nested param named `prisma` — passing the outer client through a helper is invisible

Status: Done — implemented on fix/lint-alias-binding-lane. Re-verified file:line before acting.
Lens: local rules · Area: transaction boundary · Severity: med-high · Size: M · Confidence: high
Theme: rule-false-negative · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
Inside a `$transaction` callback, the rule (a) only reports member-expression
call chains that *start at* the outer client identifier, and (b) adds any
nested function parameter named `prisma` to the trusted client set. So the
deadlock-shaped pattern it exists to catch survives one trivial indirection:

```ts
await prisma.$transaction(async (tx) => {
  async function write(prisma) {                       // param name trusted
    await prisma.character.update({ where: { id }, data });
  }
  await write(prisma);                                 // outer client passed in — not reported
});
```

The callee is an Identifier, so the argument is never inspected; and even if it
were, the nested `prisma` param is pre-trusted by name.

## Evidence
- `eslint-rules/no-outer-client-in-transaction.js:61-69` — `localPrismaParamNamesFor` trusts nested params named `prisma`; `:113-119` adds them to the tx-client set. Verified 2026-07-04.
- `eslint-rules/no-outer-client-in-transaction.js:135-137` — reporting requires the chain to root at the outer client; `write(prisma)` call-argument form never inspected. Verified.

## Proposed direction
Two independent tightenings, either alone is an improvement:
1. Report the outer client appearing as a **call argument** inside a
   transaction callback (`write(prisma)`) unless the callee is an allowlisted
   safe wrapper — this is the cheap, high-signal half.
2. Stop pre-trusting nested params by the name `prisma`; trust only the actual
   transaction-callback parameter binding (scope-resolved), and params that
   are demonstrably called with a tx client at every local call site.

## Scope / caveats
- Read `docs/CONCURRENCY.md` first; coordinate with leaf 31's binding-tracking
  helper so both rules share one "which binding is the tx client" resolver.
- Watch for false positives on legitimate helper factories that receive the
  outer client for *post-commit* work scheduled inside the callback — check
  existing valid tests before tightening.
- One commit per tightening; start with (1).
- Implemented helper-argument inspection covers direct arguments plus
  object/array/spread containers. Conditional and logical wrappers such as
  `write(cond ? prisma : tx)` or `write(prisma || tx)` remain an accepted
  residual hole for this slice.
