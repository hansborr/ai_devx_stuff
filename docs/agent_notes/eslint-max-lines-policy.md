# ESLint Max-Lines Policy

Status: Active reference
Date: 2026-06-12

## Context

Per-file `local/max-lines` caps in ESLint and their exception metadata are
centralized here. The last max-lines ratchet was retired after codemod sources
moved under normal ESLint coverage; this policy now explains the ordinary lint
model used by `eslint-config/max-lines-policy.js`.

## Current Policy

- The normal `local/max-lines` default cap is 300 effective lines with blank
  lines and comments skipped.
- Larger files must be listed in `maxLinesPolicy.exceptions` with an exact
  path, cap, severity, reason, `lifecycle` label, and `ratchetExcluded` value.
- Write each reason as a present-tense structural justification. For an
  exception expected to retire, name its retirement condition; a permanent
  exception should instead explain its enduring cohesion or nature. Keep
  ticket names, named change history, and line or cap deltas in Git history.
- The `lifecycle` label classifies the exception's intent and is one of:
  - `candidate-for-split` — accepted large today, but flagged to break up
    (the reason names the future split/extraction/refactor).
  - `permanent` — inherently large by nature (data tables, schema mirrors,
    canonical fixtures/harnesses, bounded glue) and not expected to split.
  - `temporary` — large only until imminent in-flight work removes the
    exception (currently unused; reserve for short-lived exceptions).
- `ratchetExcluded` is retained in the exception baseline as historical
  lifecycle metadata. No current max-lines ratchet consumes it; all live
  max-lines enforcement is ordinary ESLint.
- `eslint-config/max-lines-policy.js::maxLinesPolicy` is the single source for
  ESLint per-file overrides (`eslint-config/code-quality-configs.js`) and the
  policy tests; its checked JSDoc is also the type contract `scripts/*.ts`
  consumers resolve (`tsconfig.scripts.json` sets `allowJs`).
- Any future max-lines debt starts directly in
  `scripts/lint-ratchet/lint-ratchet-config.ts`; the retired
  `maxLinesPolicy.ratchets` adapter surface is not kept empty in anticipation.

## Delivered (Leaf 08, 2026-06-12)

The reference-readiness goals are now met by the single-source policy object:

- Large-file exceptions live in one data structure (`maxLinesPolicy.exceptions`)
  carrying path, cap, severity, reason, `lifecycle` label, and `ratchetExcluded`.
- ESLint overrides import that object rather than duplicating it.
- `eslint-rules/max-lines-policy.test.js` catches missing reasons, stale paths,
  invalid lifecycle labels, ESLint-cap drift, and unexpected reintroduction of
  a max-lines ratchet.

Out of scope (still gated): building reporting/dashboards on top of the
lifecycle labels — deferred per the lint-followups summary
(`docs/agent_notes/finished_work/lint-followups-2026-06.md`; old watchlist in
git history) until this single-source landing settled.

## Verification

- Relevant config/policy tests
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
