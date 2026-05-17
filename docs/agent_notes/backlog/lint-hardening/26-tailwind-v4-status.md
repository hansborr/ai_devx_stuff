# Leaf 26: Tailwind v4 Lint Status

Status: Parked — informational, no immediate work
Depends on: external plugin maturity

## Problem

The client uses Tailwind v4. The long-standing `eslint-plugin-tailwindcss`
has only partial v4 support today (beta channel), and the maintainer has
signalled a full rewrite is in progress. Two newer projects exist:

- `eslint-plugin-better-tailwindcss` — community alternative, fuller v4
  support today.
- `@poupe/eslint-plugin-tailwindcss` — community alternative with broader
  v4 syntax validation.

Neither is yet established as the default for v4.

## Decision

Do not add a Tailwind ESLint plugin today. Wait for either:

1. The upstream `eslint-plugin-tailwindcss` v4 rewrite to ship a stable
   release, or
2. One of the community alternatives to gain clear adoption signals
   (download stats, sustained release cadence, no major open issues).

Until then, the no-regret options are:

- `prettier-plugin-tailwindcss` for class-order normalisation (already a
  Prettier plugin; minimal risk).
- A small repo-owned regex sensor for obvious class-name typos (only if
  observed in postmortems).

Revisit this leaf when promoting a Tailwind-related lint task.

## Verification

- N/A — no rule rollout yet. Revisit annually or when v4 lint coverage
  becomes a felt gap.

## References

- [eslint-plugin-tailwindcss issue #325 (v4 support)](https://github.com/francoismassart/eslint-plugin-tailwindcss/issues/325)
- [eslint-plugin-better-tailwindcss](https://www.npmjs.com/package/eslint-plugin-better-tailwindcss)
