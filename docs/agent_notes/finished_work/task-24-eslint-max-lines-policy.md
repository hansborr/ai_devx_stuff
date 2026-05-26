# Task 24: ESLint Max-Lines Policy

Date: 2026-05-26

## Summary

Max-lines exception metadata now lives in `eslint-config/shared-policy.js`.
`eslint.config.js` generates per-file `local/max-lines` caps from that policy,
and `scripts/lint-ratchet-config.ts` reads the max-300 ratchet floor scopes and
ignore globs from the same source.

The policy distinguishes the higher normal ESLint caps from the ratchet floor
with separate `exceptions` and `ratchets` sections. Each exception records
path, cap, severity, reason, and whether the file is excluded from current
max-lines ratchet coverage.

## Verification

- `bun run test -- --project=eslint-rules max-lines-policy.test.js`
- `bun run test -- --project=eslint-rules max-lines-policy.test.js max-lines.test.js`
- `./node_modules/.bin/tsc -p tsconfig.scripts.json --noEmit`
- `./node_modules/.bin/eslint --max-warnings=0 --no-warn-ignored eslint.config.js eslint-config/shared-policy.js scripts/lint-ratchet-config.ts scripts/eslint-config-shared-policy.d.ts eslint-rules/max-lines-policy.test.js`
- `bun run lint:ratchet:check-registry`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bun run lint:ratchet:zero-baseline`
- `bun run docs:lint-coverage-map:check -- --staged`
- `bun run format:changed:check`
