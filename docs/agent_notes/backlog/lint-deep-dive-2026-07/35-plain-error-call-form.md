# 35. `no-plain-error-in-trpc` misses `throw Error(...)` — the `new`-less constructor form

Status: Done — implemented on fix/lint-rule-holes-lane; `throw Error(...)` is now blocked.
Lens: local rules · Area: tRPC errors · Severity: med · Size: S · Confidence: high
Theme: rule-false-negative · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`isPlainErrorConstructor` requires `node.type === "NewExpression"`, so the
equivalent call form throws a plain `Error` through tRPC-adjacent code without
a report:

```ts
throw Error("Map not found");   // not reported; new Error(...) is
```

JavaScript's `Error(...)` without `new` constructs the same object; agents
write both forms.

## Evidence
- `eslint-rules/no-plain-error-in-trpc.js:8-11,38-39` — NewExpression-only match. Verified 2026-07-04.
- `eslint-rules/no-plain-error-in-trpc.test.js:25` — no call-form case in the suite.

## Proposed direction
Accept both `NewExpression` and `CallExpression` with callee Identifier
`Error` (and the same for the built-in subclasses the rule already covers, if
any — `TypeError(...)` etc. behave identically). Add invalid tests for the
call form and a valid test for a local function named `Error`-adjacent
(`errorFor(...)`) to pin no over-reach.

## Scope / caveats
- Trivial, zero expected new findings (`rg 'throw Error\('` is empty today) —
  lands at zero, no ratchet.
- One commit: rule + tests.
