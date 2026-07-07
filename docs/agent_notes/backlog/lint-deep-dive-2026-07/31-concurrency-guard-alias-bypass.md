# 31. Concurrency guard resolves delegates by final name only — aliases and renamed destructures bypass the race fence

Status: Done — implemented on fix/lint-alias-binding-lane. Re-verified file:line before acting.
Lens: local rules · Area: concurrency-guard · Severity: med-high · Size: M · Confidence: high
Theme: rule-false-negative · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`local/concurrency-guard` recognizes gated Prisma delegates
(`characterStats`, …) only from the literal identifier or static property name
at the call site. Both alias forms bypass it:

```ts
const stats = ctx.prisma.characterStats;
await stats.update({ where: { characterId }, data });      // not reported

const { characterStats: stats2 } = ctx.prisma;
await stats2.update({ where: { characterId }, data });     // not reported
```

The rule's own report message admits the limitation ("aliases and destructured
delegates still need a manual fix") — so this is a known gap, but it guards
race-sensitive mutations (`docs/CONCURRENCY.md`), where a silent bypass is
expensive. Same-name destructuring IS caught today.

## Evidence
- `eslint-rules/concurrency-guard.js:73-82` — `delegateName` resolves Identifier/static-property text against `GATED_DELEGATES`; no binding tracking. Verified 2026-07-04.
- `eslint-rules/concurrency-guard.js:113` — message text acknowledging the alias gap.

## Proposed direction
Track bindings with ESLint scope analysis: when a variable's init is
`<expr>.characterStats` (or a destructure pattern whose source property is a
gated delegate), record that `Variable` as gated and resolve identifiers at
call sites through `context.sourceCode.getScope(...).references`. Const-only
tracking is enough — a `let` reassignment can conservatively keep the gated
mark. Update the message to drop the "manual fix" caveat for the covered
forms; add invalid cases for both alias shapes and a valid case where the
alias comes from a *transaction* client.

## Scope / caveats
- Read `docs/CONCURRENCY.md` and the rule's MODULE context first; the helper
  boundary semantics must not loosen.
- Follow the scope-variable pattern proposed for leaf 38 (`no-async-array-
  callbacks`) — same fix shape, two rules.
- One commit: rule + tests. If existing debt surfaces (unlikely — aliasing is
  rare in the touched services), start as a ratchet entry per the house rule.
