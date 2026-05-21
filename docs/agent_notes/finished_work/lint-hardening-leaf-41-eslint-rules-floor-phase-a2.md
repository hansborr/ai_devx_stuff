# Leaf 41: eslint-rules Floor Phase A.2

Date: 2026-05-20

## Summary

Phase A.2 added a sibling non-type-aware ESLint block for the 18
`eslint-rules/*.js` rule implementation files. It restores the syntactic
strict-tier maintainability rules and regexp plugin rules without adding
`projectService: true` and without touching any rule implementation source.

Rules added back:

- `complexity`, `local/max-lines`, `max-lines-per-function`, `max-params`,
  `no-nested-ternary`, and `no-magic-numbers` with the same options as the
  existing strict-tier block.
- `regexp.configs["flat/recommended"].rules` plus the explicit regexp rules
  from the existing regexp block.

Both existing carve-outs stay in place:

- The general regexp block still ignores `eslint-rules/*.js`.
- The mixed strict-tier block still ignores `eslint-rules/*.js` because it uses
  project service parsing.

The Phase A.2 block directly reapplies the syntactic regexp and maintainability
subset to `eslint-rules/*.js`.

## Ratchet Baseline

`bun run lint` surfaced 8 existing findings, all tractable:

- `complexity`: 3 findings
  (`strict-trpc-input.js`, `structured-logging.js`,
  `type-assertion-boundary.js`)
- `no-magic-numbers`: 2 findings (`type-assertion-boundary.js`)
- `regexp/no-unused-capturing-group`: 2 findings
  (`no-barrel.js`, `structured-logging.js`)
- `regexp/no-useless-non-capturing-group`: 1 finding
  (`no-llm-artifacts.js`)

Because the ratchet runner is one-rule-per-entry and separates core from
third-party sources, Phase A.2 added four ratchets:

- `ratchet/core-complexity-eslint-rules`
- `ratchet/core-no-magic-numbers-eslint-rules`
- `ratchet/regexp-no-unused-capturing-group-eslint-rules`
- `ratchet/regexp-no-useless-non-capturing-group-eslint-rules`

The normal ESLint config has exact-path overrides only for these existing debt
items so `bun run lint` stays passing while `lint:ratchet` prevents new or
higher counts. `eslint-plugin-regexp` was added to the ratchet third-party
allowlist; it was already a dependency.

## Exit Path

EXIT PATH: Phase A.3 audits `local/*`, `eslint-comments`, and
`simple-import-sort` rules for `eslint-rules/*.js` applicability. Phase B
brings `eslint-rules/*.test.js` under lint with the rule-tester / Vitest floor.

## Verification

- `bun run lint`
- `bun run lint:ratchet`
- `bun run lint:ratchet:check-baseline`
- `bash scripts/test-lint-ratchet.sh`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run typecheck`
