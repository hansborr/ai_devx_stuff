# strict-boolean-expressions Ratchet Leaf 23 Inventory

Date: 2026-05-19
Branch: `feature/lint-strict-boolean-expressions-ratchet`
HEAD: `164abdaa`

## Run

- Rule: `@typescript-eslint/strict-boolean-expressions`
- Output: `/tmp/strict-boolean-inventory.json`
- Final runtime: 16.285s wall-clock; under the 5 minute concern threshold.
- Final ESLint status: `1` for findings. Stderr empty. Non-rule diagnostics: 0.
- Run note: `/tmp` ESM configs cannot resolve workspace package imports by
  name, so the temp config used `createRequire("/workspace/package.json")`.
- Parser note: the temp config copied main ESLint's custom parser-project
  overrides for linted scripts, server scripts, and e2e. Plain
  `projectService: true` cannot cover those paths because they live outside the
  nearest package `tsconfig.json` includes.

Final inventory options were explicit:
`allowAny: false`, `allowNullableBoolean: false`,
`allowNullableEnum: false`, `allowNullableNumber: false`,
`allowNullableObject: true`, `allowNullableString: false`,
`allowNumber: false`, `allowString: false`.

Total: 659 findings across 260 files.

## Package Counts

| Package | Findings |
| --- | ---: |
| client | 398 |
| server | 173 |
| scripts | 58 |
| e2e | 23 |
| shared | 7 |

## Directory Counts

| Package | Directory | Findings |
| --- | --- | ---: |
| client | `packages/client/src/components` | 332 |
| server | `packages/server/src/routers` | 64 |
| scripts | `scripts/code-intel` | 55 |
| server | `packages/server/src/services` | 46 |
| server | `packages/server/src/seed` | 26 |
| client | `packages/client/src/pages` | 25 |
| client | `packages/client/src/hooks` | 17 |
| server | `packages/server/src/utils` | 15 |
| e2e | `e2e/page-objects` | 14 |
| client | `packages/client/src/lib` | 10 |
| client | `packages/client/src/test` | 10 |
| e2e | `e2e/helpers` | 6 |
| server | `packages/server/src/test` | 6 |
| server | `packages/server/src/socket` | 4 |
| client | `packages/client/src/routes` | 3 |
| e2e | `e2e/global-setup.ts` | 3 |
| scripts | `scripts/drift` | 3 |
| server | `packages/server/src/routes` | 3 |
| server | `packages/server/src/trpc` | 3 |
| server | `packages/server/prisma` | 2 |
| server | `packages/server/src/config` | 2 |
| shared | `packages/shared/src/dice` | 2 |
| shared | `packages/shared/src/rules` | 2 |
| shared | `packages/shared/src/schemas` | 2 |
| client | `packages/client/src/stores` | 1 |
| server | `packages/server/scripts` | 1 |
| server | `packages/server/src/prisma` | 1 |
| shared | `packages/shared/src/map` | 1 |

## Message Counts

| Findings | Message |
| ---: | --- |
| 342 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| 179 | Unexpected string value in conditional. An explicit empty string check is required. |
| 46 | Unexpected value in conditional. A boolean expression is required. |
| 33 | Unexpected nullable boolean value in conditional. Please handle the nullish case explicitly. |
| 24 | Unexpected number value in conditional. An explicit zero/NaN check is required. |
| 16 | Unexpected any value in conditional. An explicit comparison or type conversion is required. |
| 10 | Unexpected nullable number value in conditional. Please handle the nullish/zero/NaN cases explicitly. |
| 7 | Unexpected nullable boolean value in array predicate return type. Please handle the nullish case explicitly. |
| 2 | Unexpected string value in array predicate return type. An explicit empty string check is required. |

## Top Directory/Message Groups

Full package/directory/message TSV: `/tmp/strict-boolean-grouped.tsv`; source JSON: `/tmp/strict-boolean-inventory.json`.
Top ranked groups:

| Package | Directory | Findings | Message |
| --- | --- | ---: | --- |
| client | `packages/client/src/components` | 148 | Unexpected string value in conditional. An explicit empty string check is required. |
| client | `packages/client/src/components` | 118 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| server | `packages/server/src/routers` | 44 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| scripts | `scripts/code-intel` | 38 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| server | `packages/server/src/services` | 36 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| client | `packages/client/src/components` | 20 | Unexpected nullable boolean value in conditional. Please handle the nullish case explicitly. |
| client | `packages/client/src/components` | 16 | Unexpected number value in conditional. An explicit zero/NaN check is required. |
| client | `packages/client/src/pages` | 15 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| e2e | `e2e/page-objects` | 12 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| server | `packages/server/src/routers` | 12 | Unexpected value in conditional. A boolean expression is required. |
| server | `packages/server/src/seed` | 12 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| client | `packages/client/src/components` | 11 | Unexpected value in conditional. A boolean expression is required. |
| client | `packages/client/src/hooks` | 11 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| server | `packages/server/src/seed` | 11 | Unexpected string value in conditional. An explicit empty string check is required. |
| client | `packages/client/src/test` | 10 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| server | `packages/server/src/utils` | 9 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| scripts | `scripts/code-intel` | 8 | Unexpected value in conditional. A boolean expression is required. |
| client | `packages/client/src/components` | 7 | Unexpected any value in conditional. An explicit comparison or type conversion is required. |
| client | `packages/client/src/pages` | 7 | Unexpected string value in conditional. An explicit empty string check is required. |
| client | `packages/client/src/components` | 6 | Unexpected nullable number value in conditional. Please handle the nullish/zero/NaN cases explicitly. |
| client | `packages/client/src/lib` | 6 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| e2e | `e2e/helpers` | 6 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| shared | `packages/shared/src/dice` | 2 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |
| shared | `packages/shared/src/rules` | 2 | Unexpected value in conditional. A boolean expression is required. |
| shared | `packages/shared/src/schemas` | 2 | Unexpected nullable string value in conditional. Please handle the nullish/empty cases explicitly. |

## Scope Recommendation

Recommend `packages/shared/src` production source only.

Scope:

```ts
files: ["packages/shared/src/**/*.{ts,tsx}"],
ignores: [
  "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
  "packages/shared/src/**/*.test-helper.{ts,tsx}",
  "packages/shared/src/test/**/*.{ts,tsx}",
  "**/dist/**",
  "**/generated/**",
  "**/node_modules/**",
],
```

Candidate ranking under the recommended options:

| Candidate | Findings | Files | Verdict |
| --- | ---: | ---: | --- |
| `packages/shared/src` prod | 6 | 3 | Best first scope. Small, semantic, contract-layer protection. |
| `packages/client/src/hooks` prod | 14 | 10 | Small, but lower protection value than shared. |
| `packages/client/src/pages` prod | 24 | 13 | UI workflow review cost is higher. |
| e2e + linted `scripts/*` | 81 | 26 | Needs parser-project support not expressible by current ratchet profiles. |
| `packages/server/src/services` prod | 44 | 19 | Valuable, but domain review is broader. |
| `packages/server/src/routers` prod | 57 | 20 | Valuable, but auth/input semantics need more coordination. |
| `packages/client/src/components` prod | 325 | 111 | Too broad for the first ratchet. |

Shared wins on:

- Size: 6 findings in 3 production files.
- Semantic clarity: current findings are regex capture presence, shared map
  lookup presence, and Zod ID presence.
- Protection value: shared rules/schemas feed both server and client.
- Review cost: a future drain stays in one package and avoids e2e/scripts
  parser-profile work.

## Rule Options

Recommended initial options:

```ts
[
  {
    allowAny: false,
    allowNullableBoolean: false,
    allowNullableEnum: false,
    allowNullableNumber: false,
    allowNullableObject: true,
    allowNullableString: false,
    allowNumber: false,
    allowString: false,
  },
]
```

Justification:

| Option | Decision |
| --- | --- |
| `allowString: false` | Keep `""` checks explicit; inventory has 179 plain string findings. |
| `allowNumber: false` | Keep `0`/`NaN` checks explicit; inventory has 24 plain number findings. |
| `allowNullableString: false` | Core bug class; inventory has 342 nullable string findings. |
| `allowNullableNumber: false` | Core `0` vs nullish bug class; inventory has 10 nullable number findings. |
| `allowNullableBoolean: false` | Stricter than the common loosening; shared tri-state booleans should be explicit. |
| `allowNullableEnum: false` | Catches shared map/lookup presence; accounts for 2 shared rules findings. |
| `allowAny: false` | Shared should not grow ambiguous `any` truthiness. |
| `allowNullableObject: true` | Only loosening. Object presence has no empty-string/zero ambiguity and avoids first-ratchet churn. |

## Risks

- These options are stricter than installed plugin defaults for plain strings
  and numbers; global inventory rises from 419 default-option findings to 659.
- `allowNullableObject: true` allows optional object truthiness in the first
  scope. The bet is that string/number/enum ambiguity is the higher-value first
  guardrail.
- e2e/scripts should wait: the ratchet `type-aware-ts` profile cannot express
  their custom `project` parser overrides today.
- Future `typescript-eslint` upgrades intentionally change the third-party
  source hash and should refresh the baseline.

## Phase 2 Update

Phase 2 added the actual third-party ratchet entry:

- `lintRatchetThirdPartyPluginAllowlist` now allowlists
  `typescript-eslint` for the `@typescript-eslint` namespace with
  `pluginExport: "plugin"`.
- `ratchet/strict-boolean-expressions-shared` now runs
  `@typescript-eslint/strict-boolean-expressions` with the recommended options
  against `packages/shared/src` production TypeScript.
- The registry ignores are sorted to satisfy the ratchet registry validator;
  the semantic scope matches the inventory recommendation.
- `harness.controls.json` and `docs/generated/harness-controls.md` include the
  matching ratchet control.
- `lint-ratchet.baseline.json` includes the initial shared-only baseline.
- Ratchet and harness smoke fixtures were updated so their copied manifests and
  temp worktrees account for the live third-party type-aware ratchet.

Baseline counts:

| File | Findings |
| --- | ---: |
| `packages/shared/src/dice/dice-notation.ts` | 2 |
| `packages/shared/src/rules/character-rules.ts` | 2 |
| `packages/shared/src/schemas/inventory-inputs.ts` | 2 |

## Verification Notes

- `bun run lint:ratchet:update` wrote the initial baseline with 6 current
  findings; no `--allow-worse` flag was required for the new ratchet id.
- `bun run lint:ratchet:check-baseline` passed with 6 current findings.
- Smoke check: a temporary
  `packages/shared/src/strict-boolean-ratchet-smoke.ts` file with
  `if (someNullableString)` made `bun run lint:ratchet:check-baseline` fail for
  1 path. The detailed `bun run lint:ratchet` output named the temp file at
  line 2. The temp file was removed and check-baseline returned to green.
- Runtime after adding the type-aware shared ratchet:
  - cold `bun run lint:ratchet`: 9.50s wall-clock after removing
    `node_modules/.cache/eslint-ratchet`
  - warm `bun run lint:ratchet`: 1.92s wall-clock
- Required verification passed after fixture updates: `bash
  scripts/test-lint-ratchet.sh`, `bun run lint:ratchet`, `bun run
  lint:ratchet:check-baseline`, `bun run harness:check`, `bun run
  docs:harness-controls:check`, `bun run test:scripts:changed`, `bun run
  lint`, and `bun run typecheck`. The first `test:scripts:changed` rerun hit a
  transient `test-verify-async` timeout-status assertion; the focused
  `bash scripts/test-verify-async.sh` rerun passed, and the full
  `bun run test:scripts:changed` rerun passed.

## Review Cycle

- Codex review P2: `ratchet/strict-boolean-expressions-shared` used the
  `type-aware-ts` parser profile but still went through ESLint's per-file
  `--cache`. That cache only keys direct source bytes, so an imported type
  change could leave an unchanged consumer file with a stale clean result.
- Fix: `scripts/lint-ratchet.ts` now passes `--cache --cache-location` only
  for `minimal-ts` ratchets. `type-aware-ts` ratchets still keep the generated
  config path but run uncached and sweep any now-unused ratchet cache directory.
- Regression coverage: `scripts/test-lint-ratchet.sh` now asserts the
  `minimal-ts` fake third-party fixture creates an ESLint cache, the
  `type-aware-ts` fixture does not, stale type-aware cache dirs are swept, and
  a type-only fixture schema edit surfaces a new strict-boolean finding in an
  unchanged consumer file.
- Runtime after the cache split:
  - cold `bun run lint:ratchet`: 9.58s wall-clock after removing
    `node_modules/.cache/eslint-ratchet`
  - warm `bun run lint:ratchet`: 2.91s wall-clock

## Follow-up

Phase 3 drained the 6 baseline findings without widening the scope or loosening
the rule options.

## Phase 3: Drain

- `packages/shared/src/dice/dice-notation.ts`: changed the optional dice count
  capture and optional keep-count capture from truthiness to `!= null`
  presence checks. Empty strings are impossible for these captures because the
  regex uses `\d+`; the intended distinction was present capture vs omitted
  capture. Pre-existing `dice-notation.test.ts` coverage exercises implicit
  `d20` counts and `kh`/`kl` keep counts.
- `packages/shared/src/rules/character-rules.ts`: changed skill ability and
  unarmored-defense class map lookups from truthiness to explicit
  `!== undefined` checks. Empty strings are not valid mapped values; the
  intended distinction was known map key vs missing map key. Pre-existing
  `character-rules.test.ts` covers unknown skills, and pre-existing
  `armor-class.test.ts` covers unarmored-defense class lookup.
- `packages/shared/src/schemas/inventory-inputs.ts`: changed the homebrew
  `sourceId` and `campaignId` guards from truthiness to `== null` checks.
  `idField` already rejects empty strings, so the refinement only needs to add
  issues for nullish missing IDs. Pre-existing `inventory-inputs.test.ts`
  covers missing `sourceId`, null `sourceId`, missing `campaignId`, empty
  `sourceId`, and the accepted homebrew case.
- No `eslint-disable` comments were used.
- `bun run lint:ratchet:update` reduced
  `ratchet/strict-boolean-expressions-shared` to `items: {}` with 0 findings.
