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
  path, cap, severity, reason, and `ratchetExcluded` value.
- `ratchetExcluded: false` means normal ESLint has a higher cap while a
  `local/max-lines` ratchet still keeps the max-300 floor visible.
- `ratchetExcluded: true` means the file is intentionally outside the default
  max-lines ratchet; the exception reason must explain why that larger file is
  currently accepted.
- Max-lines ratchet scopes live in `maxLinesPolicy.ratchets` so
  `scripts/lint-ratchet/max-lines-policy.ts` can feed the ratchet registry from
  the same shared policy object.

## Future Cleanup

The remaining reference-readiness work is to make this policy harder to drift:

- Keep large-file exceptions in one data structure containing path, cap,
  reason, owner or exit path, and whether the file is excluded from the default
  max-lines ratchet.
- Generate or import that same data for ESLint overrides and ratchet ignores.
- Add checks that catch missing reasons, stale paths, and drift between ESLint
  caps and ratchet ignore policy.

The broader platform carry-forward is parked in
`docs/agent_notes/backlog/lint-review-2026-06/watchlist.md` (Platform And
Reference Carry-forwards section).

## Verification

- Relevant config/policy tests
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
