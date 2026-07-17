# 30. Custom rule: ban outer `prisma` client member calls inside interactive `$transaction` callbacks

Status: Done — `eslint-rules/no-outer-client-in-transaction.js`, registered in `local-plugin.js` (`d867c3d2`→`3a5e55ca`).
Lens: lint-rules · Area: server · Severity: high · Size: M · Confidence: high
Theme: transaction-atomicity · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Inside `prisma.$transaction(async (tx) => …)`, every write must go through `tx`. A member call
on the outer `prisma` (or `ctx.prisma`) client inside the callback silently escapes atomicity —
it commits even when the transaction rolls back — and, because it checks out a second pooled
connection while the transaction holds one, it can deadlock the pool under load. Nothing lints
for this today: `local/concurrency-guard` only guards the five gated delegates
(`eslint-rules/concurrency-guard.js:12-18`), and `local/no-broadcast-in-transaction` only flags
broadcast calls. This is a classic agent mistake (copying an outer-client call into a callback),
and the failure is invisible in tests that never roll back.

## Evidence
- 42 `$transaction` occurrences in non-test, non-generated `.ts` under `packages/server/src`
  (excluding `src/test/`, `**/generated/**`, `*.md`); 31 of those are actual `$transaction(`
  call spans (the audit's "~49" also counted MODULE.md/README mentions). Verified via `rg` +
  a paren-balanced scan on 2026-07-01.
- Current violations: **0**. A span scan of all 31 callbacks found only
  `packages/server/src/routers/auth.ts:223-225`, which is the legitimate batch-array form
  (`ctx.prisma.$transaction([ctx.prisma.session.delete(…), ctx.prisma.session.create(…)])`),
  not an interactive-callback escape.
- Reusable AST machinery: `eslint-rules/no-broadcast-in-transaction.js:23-28`
  (`isTransactionCall`) and `:62-98` (transaction-callback `WeakSet` + function stack) already
  implement exactly the "am I inside a `$transaction` callback" detection this rule needs.
- `local/concurrency-guard` suggestions map (`eslint-rules/concurrency-guard.js:22-40`) shows
  the house style for naming sanctioned alternatives in messages.

## Proposed direction
New local rule (working name `local/no-outer-client-in-transaction`): when inside a function
passed as the first argument to a `$transaction(...)` call (reuse the no-broadcast detection),
report any `MemberExpression` whose object resolves to `prisma` / `ctx.prisma` (identifier
name `prisma`, or `.prisma` property access), excluding the `$transaction` call itself.
Explicitly do NOT flag the batch-array form `$transaction([prisma.a.x(), …])` — only
callback-style transactions. Message in guidance shape ("Why: escapes atomicity / risks pool
deadlock. How to fix: use the `tx` callback parameter …"). Escape hatch: a parseable marker
comment mirroring `type-assertion-boundary` (`// outer-client-in-transaction: <reason>`) for
the rare intentional non-transactional read, or start with no escape hatch since the current
count is zero. Register in `eslint-config/local-plugin.js`, follow the `meta.docs` contract in
`docs/guides/local-eslint-rules.md` (description/principle/category/pairedGuide/repairKind;
pairedGuide: `docs/CONCURRENCY.md`), RuleTester tests beside the rule.

## Scope / caveats
- Zero current findings verified → per the house rollout convention this goes straight into
  normal lint (no ratchet entry needed); the guide path for new rules is
  `docs/guides/local-eslint-rules.md`, ratchet path (`docs/guides/lint-ratchet.md`, "Adding a
  new rule to an already linted area") only if a violation appears before landing.
- Aliasing (`const db = prisma;` then `db.x` inside the callback) and clients passed through
  helper params are out of scope for v1 — name-based detection of `prisma`/`ctx.prisma`
  matches the codebase's actual usage (all 31 spans use those two spellings).
- Keep `packages/server/src/test/**` and `*.test.ts` out of scope (test helpers legitimately
  mix clients).
- One small commit: rule + tests + local-plugin registration + config enable + guidance-catalog
  regeneration (`bun run docs:lint-guidance`).
