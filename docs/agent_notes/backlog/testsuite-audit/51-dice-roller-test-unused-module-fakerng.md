# 51. Unused module-level fakeRng fixture in dice-roller.test.ts breaks the file's local-mock convention

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: maintainability · Area: shared · Severity: low · Size: XS · Confidence: high
Theme: dead-fixture · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
`packages/shared/src/dice/dice-roller.test.ts` declares `fakeRng` at module scope, then uses it in exactly one of its 21 `it()` cases — the "propagates parse errors" test — and even there the function is never actually called. `rollFromNotation("garbage", fakeRng)` throws inside `parseDiceNotation` before control ever reaches `rollDice`, the only place an rng is invoked, so the fixture's return value (`1`) is irrelevant to the assertion. A throwaway `() => 1` at the call site would be fully equivalent.

This matters for readability, not correctness. The file otherwise follows a clean, self-documenting convention: every other test declares its own local `mockRng` next to the call it drives, so a reader sees exactly which return sequence produces each asserted total. The lone module-scoped `fakeRng` at the top of the file reads like shared state that ought to feed several tests — but it feeds none of them, and its name diverges from the `mockRng` pattern the rest of the file teaches. It is dead context that a reader has to scan, trace to its single call site, and then realize is inert. Small, but it is exactly the kind of misleading shared fixture that erodes trust in a test file's conventions.

## Evidence
- `packages/shared/src/dice/dice-roller.test.ts:5` — `const fakeRng = vi.fn().mockReturnValue(1);` declared once at module top, outside every `describe`.
- `packages/shared/src/dice/dice-roller.test.ts:261` — the only use: `expect(() => rollFromNotation("garbage", fakeRng)).toThrow();`, where parsing fails before the rng is read.
- `packages/shared/src/dice/dice-roller.test.ts:10-256` — every other test declares a local `mockRng` (21 `it()` cases total; `rg -n "mockRng"` shows the local declarations at lines 10, 21, 33, 45, 59, 76, 94, 113, 130, 146, 160, 176, 188, 202, 211, 223, 230, 239, 247, 255), never `fakeRng`.
- `packages/shared/src/dice/dice-roller.ts:54-55` — `rollFromNotation` calls `parseDiceNotation(notation)` (line 54) before `rollDice(...)` (line 55); the rng is first invoked only inside `rollDice` at `dice-roller.ts:16` (`rolls.push(rng(1, group.sides))`). With `"garbage"` input the parse throws first and the rng is never called.

## Proposed direction
Inline a throwaway rng at the single call site and delete the module-level `fakeRng`:

```ts
it("propagates parse errors", () => {
  expect(() => rollFromNotation("garbage", () => 1)).toThrow();
});
```

Then remove `const fakeRng = vi.fn().mockReturnValue(1);` at line 5. This restores the local-mock convention used by every other test in the file and removes the only piece of misleading module-scope state. Pure cleanup, behavior-neutral: the parse-error assertion still asserts the throw, and since the rng is never reached on `"garbage"` input its return value is immaterial. Estimated impact: trivial readability win for the next reader of the dice tests, no measurable runtime change (one fewer `vi.fn()` allocation). Verify with `bun run test -- packages/shared/src/dice/dice-roller.test.ts` (same 21 cases pass, same assertions).

## Scope / caveats
Touch only `dice-roller.test.ts`; do not modify `dice-roller.ts`, `dice-notation.ts`, or any other source. XS cosmetic cleanup, coverage-preserving — the parse-error test's behavior is unchanged because the rng value is unreachable when parsing throws first. This is a bottom-of-barrel maintainability nit; severity correctly stays `low` and should not be elevated. It is a dead-fixture / convention-consistency finding, not a dead-code or duplication finding (those are owned by `docs/agent_notes/backlog/drift-ai-findings/`) — nothing is unused at the module level except this one test-local fixture. No tooling pins `fakeRng` by name (a grep before editing confirms it appears only in this file). Independent of the other shared/dice findings; safe to land standalone or fold into any broader dice-test tidy-up.
