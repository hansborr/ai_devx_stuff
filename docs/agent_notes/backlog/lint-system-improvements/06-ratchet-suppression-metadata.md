# Ratchet Suppression Metadata

Status: Parked
Order: 6

## Context

`eslint-config/script-configs.js` contains `scriptDebtOverrideConfigs`, which
suppresses normal ESLint findings for debt already tracked by ratchets. That
creates a shadow policy file: the ratchet registry tracks the debt, but normal
lint suppressions must be maintained separately.

The source review recommends moving ownership to exact ratchet metadata before
generating any ESLint suppression fragment.

Prerequisite: complete or consciously revalidate
`05-derive-linted-script-reinclude-patterns.md`, and recheck ratchet command
semantics from `04-verify-ratchet-ci-parity.md` if CI/local ratchet wiring has
changed.

## Scope

- Re-audit `scripts/lint-ratchet-config.ts`,
  `eslint-config/script-configs.js`, `eslint.config.js`, and related tests.
- Add explicit registry metadata for normal-lint suppressions:
  ratchet id, file globs, ESLint rule id, reason, and whether the suppression
  replaces a duplicate normal lint finding or preserves a narrower ratchet
  floor.
- Generate a flat-config fragment such as
  `eslint-config/generated-ratchet-suppressions.js`.
- Import the generated fragment from `eslint.config.js`.
- Add a check mode that fails when the generated fragment is stale.
- Do not derive broad suppressions from ratchet file globs alone.

## Definition Of Done

Ratcheted debt suppressions have one owner in the ratchet registry, and normal
ESLint override drift is generated or detected.

## Verification

- Ratchet registry tests
- Generated-fragment stale check
- `bun run lint:ratchet:check-registry`
- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
