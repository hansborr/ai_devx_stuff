# Derive Linted Script Reinclude Patterns

Status: Done
Order: 5

## Context

`eslint-config/shared-policy.js` owns `lintedScriptFiles` and
`lintedScriptReincludePatterns`. The source review identified those arrays as a
manual mirror: the positive linted-script surface and the negated flat-config
unignore patterns need to stay aligned.

## Scope

- Re-audit `eslint-config/shared-policy.js`,
  `eslint-config/base-configs.js`, config tests, and any coverage-map consumers.
- Derive regular reinclude patterns from the positive linted-script list, for
  example:

  ```js
  export const lintedScriptReincludePatterns = [
    ...lintedScriptFiles.map((file) => `!${file}`),
    "!scripts/vitest.config.ts",
  ];
  ```

- If directory entries are required for flat-config unignore behavior, encode
  that through a named helper rather than a separate hand-maintained mirror.
- Add or update tests that catch drift between the two surfaces.

## Definition Of Done

The linted script surface has one owner, and flat-config reinclude patterns are
derived or validated from that owner.

## Resolution

`eslint-config/shared-policy.js` now derives regular script reinclude patterns
from `lintedScriptFiles` through `deriveLintedScriptReincludePatterns`. The
helper emits the direct `!<pattern>` unignore plus parent and descendant
directory unignores for recursive globstar entries so ESLint flat config can
traverse re-opened script directories. `scripts/vitest.config.ts` remains the
only extra script-tree reinclude because it is linted by the TS config-file
policy rather than the runtime script policy.

## Verification

- ESLint config tests or targeted resolved-config checks
- `bun run lint -- --max-warnings=0`
- `bun run docs:lint-coverage-map:check`
- `bun run verify:changed`
