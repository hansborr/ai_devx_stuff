# 71. The lint and runtime nested-write walkers duplicate one subtle payload-state machine

Status: **Open — follow-up only; do not re-open leaf 60's production guard.**
Theme: Keep the advisory lint aligned with the authoritative runtime boundary · Area: harness + server · Severity: low · Size: M

Source: leaf 60 four-model pre-merge panel, 2026-07-31; Opus 5 identified the
residual and explicitly recommended a future simplification pass rather than
churn in the runtime-guard branch · Confidence: high

Evidence is pinned to `6e3db06cb`. Re-resolve symbols before implementation.

## Problem

Leaf 60 correctly kept two consumers with different jobs: ESLint provides an
early, non-authoritative diagnostic over syntax, while the Prisma `$extends`
guard is the production authority over assembled runtime values. Both consumers
now independently implement the same three-state classification — `wrapper`,
`data`, and `ambiguous` — including the `data`-scalar exception and `where`
evidence used to avoid treating valid JSON as a Prisma envelope.

That duplication is the largest subtle part left by a LOW-severity defense-in-
depth leaf. A future edit can make lint disagree with production even though
each surface's own tests remain green. The consequence is developer friction or
a missed author-time diagnostic, not a bypass of the runtime guard.

## Evidence

- `packages/server/src/prisma/nested-write-guard.ts:15,128-161` defines
  `WalkKind`, `envelopeValueKind`, ambiguous-`data` handling, and the ordering
  between relation and envelope traversal.
- `eslint-rules/concurrency-guard.js:307-423` independently defines
  `NestedWalkKind`, `envelopeValueKind`, `canFollowAmbiguousData`, and the same
  relation-before-envelope ordering over ESTree nodes.
- `eslint-rules/concurrency-guard.test.js:543-544` preserves all 45 former
  parity cases as a lint-only regression corpus. Runtime tests cover concrete
  value shapes separately, but no executable assertion says the two state
  machines agree on their shared policy.

## Proposed direction

Start with deletion pressure, not a shared framework:

1. Inventory the genuinely shared decisions: envelope classification,
   relation-before-envelope ordering, `data` scalars, `where` evidence, root
   upsert update branches, and to-one update shorthand.
2. Decide whether the lint can become simpler while remaining a useful early
   diagnostic. If it cannot, prefer a small declarative policy or cross-surface
   behavior matrix over sharing executable traversal between ESTree and runtime
   values.
3. Preserve the current production walker as the authority and prove every
   simplification with the existing JSON-scalar and shorthand regressions.

## Scope / caveats

- Do not restructure either walker merely to make the files look alike. Their
  input models differ, and a shared executable abstraction may cost more than
  the duplication it removes.
- Do not weaken, configure, or add an escape hatch to the runtime guard. Leaf 60
  remains closed and ADR-0007 remains the boundary decision.
- Keep the 45-case lint corpus until a replacement proves at least the same
  static regression floor. Runtime coverage is not a substitute for author-time
  lint coverage.
- Treat divergence as a diagnostic-quality problem, not a security finding.
  This leaf must not broaden v1 to create/delete/connect-style operators.

## Verify

Follow TDD with at least the `Notification.data` JSON collision, root-upsert
update branch, and to-one shorthand shapes represented on both applicable
surfaces. Any `eslint-rules/*` or generated graph change requires full
foreground `bun run verify` under this pack's convention.
