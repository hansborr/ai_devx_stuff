# 30. Raw-SQL fence matches only `property.name` — `prisma["$queryRaw"]` walks straight through

Status: Done — implemented on fix/lint-rule-holes-lane; computed raw-SQL member forms are fenced.
Lens: local rules · Area: raw-SQL fence · Severity: high · Size: S · Confidence: high
Theme: rule-false-negative · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
The raw-SQL fence (hardened by harness-review-2026-07 leaf 31) is a
`no-restricted-syntax` selector of the form
`MemberExpression[property.name=/^\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]`.
`property.name` only exists on `Identifier` properties, so the computed
string-literal form `prisma["$queryRaw"]\`...\`` has a `Literal` property and is
never matched. That is a one-line evasion of a security-relevant fence — and
exactly the "make the gate green" rewrite an agent under pressure discovers.
Notably, the hand-built-query-key selectors elsewhere in the config DO handle
computed forms, so the gap is an inconsistency, not a style decision.

## Evidence
- `eslint-config/package-boundary-configs.js:12-13` — selector matches `property.name` only; wired at `:220-225`, `:235-240`, `:248`. Verified 2026-07-04 (Literal property has no `.name`).

## Proposed direction
Add the computed variants to the selector set:
`MemberExpression[computed=true][property.value=/^\$(queryRaw|...)$/]` for
string literals, plus the same for the template-literal single-quasi form if
cheap. If the selector pair grows unwieldy, promote the fence to a tiny local
AST rule reusing the static-property-name helper the socket rules already use —
one resolver, both spellings.

## Scope / caveats
- Zero expected findings today (`git grep '\["\$queryRaw'` comes back empty),
  so this lands at zero with no ratchet needed.
- Same audit should sweep the OTHER `no-restricted-syntax` fences for the same
  `property.name`-only pattern (permissive-schema selectors have the identical
  gap — tracked as part of leaf 34).
- One commit: selectors + a config test invalid-case for the computed form.
- Accepted limitation (2026-07 follow-up): the fence intentionally covers
  identifier properties, string-literal computed properties, and single-quasi
  template computed properties. It does not evaluate dynamic key construction
  such as `prisma["$" + "queryRaw"]`; keep raw-SQL method names statically
  spelled so the selector can see them.
