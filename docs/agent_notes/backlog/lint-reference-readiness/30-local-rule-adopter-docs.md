# Local Rule Adopter Docs

Status: Parked
Order: 30

## Context

`docs/generated/local-lint-rules.md` is not prominent from the authored
local-rule guide. Custom rules are JavaScript with JSDoc while most of the repo
is TypeScript.

## Scope

- Link the generated local-rule catalog from
  `docs/guides/local-eslint-rules.md`.
- Document JavaScript custom rules as an intentional bootstrap choice: less
  implementation type safety in exchange for direct ESLint loading before any
  build step.
- Keep this separate from broad custom-rule test cleanup, which belongs in
  `10-zero-baseline-custom-rule-tests.md`.

## Definition Of Done

Future reviewers have a documented reason for the JavaScript rule files, and
readers can find the generated local-rule catalog from the authored guide.

## Verification

- `bunx prettier --check --ignore-unknown docs/guides/local-eslint-rules.md`
- Local-rule doc generation/check command if one exists
