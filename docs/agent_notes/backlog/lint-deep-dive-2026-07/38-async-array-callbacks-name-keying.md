# 38. `no-async-array-callbacks` tracks consumption by bare name across the whole file — cross-scope suppression

Status: Done — implemented on fix/lint-alias-binding-lane. Re-verified file:line before acting.
Lens: local rules · Area: async hygiene · Severity: med · Size: M · Confidence: high
Theme: rule-false-negative · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
The rule's `pendingMapCalls`/`consumedNames` are file-global and keyed by
bare identifier name. Any `Promise.all(tasks)` anywhere in the file marks
every variable named `tasks` as consumed — including a pending unawaited
`items.map(async ...)` in a completely different function:

```ts
async function a(files) {
  const tasks = files.map(async (file) => read(file));  // never awaited — not reported
}
async function b(tasks) {
  await Promise.all(tasks);                             // unrelated, same name
}
```

Common helper names (`tasks`, `promises`, `results`) make accidental
suppression realistic in service files.

## Evidence
- `eslint-rules/no-async-array-callbacks.js:113-115` (global name maps), `:141-144` (any Promise.all consumes the name), `:162-165` (Program:exit suppression by name). Verified 2026-07-04.

## Proposed direction
Key both maps by the ESLint scope `Variable` object (resolve the identifier
via `sourceCode.getScope(node).references`) instead of its name; a
`Promise.all(x)` then consumes exactly the binding it references. This is the
same binding-resolution helper leaves 31/32/36 need — build it once
(`eslint-rules/lib/` or a shared helper module) and use it in all four rules.
Add tests: same-name different-scope (invalid stays invalid), shadowing,
parameter-vs-const.

## Scope / caveats
- Run the tightened rule over the repo before landing; genuine new findings
  either get fixed inline (preferred for async-correctness bugs) or a ratchet
  entry per house policy.
- One commit: shared helper + this rule + tests (other rules migrate in
  their own leaves).
