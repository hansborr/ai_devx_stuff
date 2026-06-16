# ESLint Max-Lines Policy

Status: Active reference
Date: 2026-06-12

## Context

Per-file `local/max-lines` caps in ESLint must stay aligned with matching
ratchet floors and ratchet exclusions. Active ratchet lifecycle metadata points
here because this policy is not just backlog planning: it explains the current
large-file exception model used by `eslint-config/shared-policy.js`.

## Current Policy

- The normal `local/max-lines` default cap is 300 effective lines with blank
  lines and comments skipped.
- Larger files must be listed in `maxLinesPolicy.exceptions` with an exact
  path, cap, severity, reason, `lifecycle` label, and `ratchetExcluded` value.
- The `lifecycle` label classifies the exception's intent and is one of:
  - `candidate-for-split` — accepted large today, but flagged to break up
    (the reason names the future split/extraction/refactor).
  - `permanent` — inherently large by nature (data tables, schema mirrors,
    canonical fixtures/harnesses, bounded glue) and not expected to split.
  - `temporary` — large only until imminent in-flight work removes the
    exception (currently unused; reserve for short-lived exceptions).
- `ratchetExcluded: false` means normal ESLint has a higher cap while a
  `local/max-lines` ratchet still keeps the max-300 floor visible.
- `ratchetExcluded: true` means the file is intentionally outside the default
  max-lines ratchet; the exception reason must explain why that larger file is
  currently accepted.
- Max-lines ratchet scopes live in `maxLinesPolicy.ratchets` so
  `scripts/lint-ratchet/max-lines-policy.ts` can feed the ratchet registry from
  the same shared policy object.
- `eslint-config/shared-policy.js::maxLinesPolicy` is the single source: ESLint
  per-file overrides (`eslint-config/code-quality-configs.js`), the ratchet
  registry (`scripts/lint-ratchet/max-lines-policy.ts`), and the policy test
  (`eslint-rules/max-lines-policy.test.js`) all read it; the ambient type lives
  in `scripts/eslint-config-shared-policy.d.ts`.

## Delivered (Leaf 08, 2026-06-12)

The reference-readiness goals are now met by the single-source policy object:

- Large-file exceptions live in one data structure (`maxLinesPolicy.exceptions`)
  carrying path, cap, severity, reason, `lifecycle` label, and `ratchetExcluded`.
- ESLint overrides and the ratchet registry import that same object rather than
  duplicating it (see the single-source bullet under Current Policy).
- `eslint-rules/max-lines-policy.test.js` catches missing reasons, stale paths,
  invalid lifecycle labels, ESLint-cap drift, and ratchet-exclusion drift.

Out of scope (still gated): building reporting/dashboards on top of the
lifecycle labels — deferred per the `lint-followups-2026-06` watchlist until
this single-source landing settled.

## Verification

- Relevant config/policy tests
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
