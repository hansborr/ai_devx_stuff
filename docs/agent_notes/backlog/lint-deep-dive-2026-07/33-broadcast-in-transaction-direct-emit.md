# 33. `no-broadcast-in-transaction` catches `broadcast*()` names but not direct `io.to(room).emit(...)`

Status: Done — implemented on fix/lint-rule-holes-lane; direct socket emits inside transactions are now blocked.
Lens: local rules · Area: transaction boundary · Severity: med-high · Size: S · Confidence: high
Theme: rule-false-negative · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
The rule enforces "broadcast after persistence" (socket architecture doc) by
flagging calls whose callee is an Identifier named `broadcast`,
`broadcastToUsers`, or `/^broadcast[A-Z]/` inside `$transaction` callbacks. A
direct emit — the thing the helpers wrap — is a MemberExpression call and
returns `undefined` from the name extractor, so it is never reported:

```ts
await ctx.prisma.$transaction(async (tx) => {
  io.to(room).emit("encounter:updated", payload);   // not reported
});
```

Anyone bypassing the broadcast helpers (the more likely mistake for new code
that doesn't know the convention) is invisible to the rule that exists for it.

## Evidence
- `eslint-rules/no-broadcast-in-transaction.js:9,36-41` — `broadcastFunctionName` requires an Identifier callee; `:85-86` returns before reporting for member-expression calls. Verified 2026-07-04.

## Proposed direction
Also flag `.emit(...)` / `.volatile.emit(...)` member calls inside transaction
callbacks when the receiver chain looks Socket.io-shaped (`io`, `socket`,
`*.to(...)`, `*.in(...)`) — reuse the static property-name helper from the
socket-registry rules for the chain test. Report with the same message
(broadcast after the transaction commits).

## Scope / caveats
- `socket-registry-broadcasts.js` already understands emit shapes — extract or
  import its matcher rather than writing a third one.
- Expected findings today: likely zero (services own broadcasts); if any
  surface, they are real bugs per `docs/socket-architecture.md`, not ratchet
  candidates — fix them in the same branch.
- One commit: rule + invalid/valid tests (tx-scoped emit vs post-transaction
  emit vs emit inside a nested non-transaction callback).
- Accepted limitation (2026-07 follow-up): deferred broadcasts scheduled inside
  a transaction callback with `process.nextTick`, `setTimeout`, or similar still
  report. This preserves the rule's existing lexical behavior for helper calls
  and direct emits; schedule the broadcast after the transaction resolves to
  make the post-commit boundary explicit.
