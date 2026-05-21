# Leaf 41: eslint-rules Floor Phase A

Date: 2026-05-20

## Summary

Phase A brought the 18 top-level `eslint-rules/*.js` rule implementation
files under normal ESLint coverage without touching any rule implementation
source. The rule-test files and Vitest config stay deferred:

- `eslint-rules/*.test.js` remains ignored for Phase B.
- `eslint-rules/vitest.config.ts` remains ignored by the config-file ignore.

## Config

The global ignore now uses a re-includable top-level contents pattern:

- ignore `eslint-rules/*`;
- unignore `!eslint-rules/*.js`;
- re-ignore `eslint-rules/*.test.js`.

`js.configs.recommended` applies through the existing `codeFiles` block once
the implementation files are re-included. A focused `eslint-rules/*.js` block
keeps `no-unused-vars` explicit:

```js
{
  files: ["eslint-rules/*.js"],
  ignores: ["eslint-rules/*.test.js"],
  rules: {
    "no-unused-vars": "error",
  },
}
```

The broader regexp and mixed TypeScript/project-hardening `codeFiles` blocks
now ignore `eslint-rules/*.js`; Phase A is the recommended-JS floor requested
for the JSDoc-typed JavaScript implementations, not a complexity/regexp drain.

`eslint-plugin-jsdoc` is not currently installed, so JSDoc rules were not
added and are recorded as a follow-on in `NEXT.md`.

## Ratchet

No ratchet was added. The final Phase A floor had zero findings under
`bun run lint`, so there is no baseline entry and no
`lint-ratchet.baseline.json` change.

## Phase B Deferral

Phase B brings `eslint-rules/*.test.js` under normal lint with Vitest and
rule-tester-aware rules, then adds the bug-class ratchet for the test corpus.
This Phase A implementation floor stays as-is.

EXIT PATH: Phase B brings `*.test.js` under normal lint with vitest rules; this
Phase A floor stays as-is.

## Verification

- `bun run lint`
- `bun run docs:lint-coverage-map:check`
- `bun run harness:check`
- `bun run docs:harness-controls:check`
- `bash scripts/test-harness-check.sh`
- `bun run typecheck`
