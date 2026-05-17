# Leaf 9 Pass 1: typescript-eslint stricter opt-ins inventory

Date: 2026-05-16

Probe: temporarily enabled these rules at `warn` in `eslint.config.js` for
`**/*.{ts,tsx}`:

- `@typescript-eslint/switch-exhaustiveness-check`
- `@typescript-eslint/strict-boolean-expressions`
- `@typescript-eslint/prefer-readonly`
- `@typescript-eslint/consistent-type-exports`
- `@typescript-eslint/promise-function-async`

The probe was reverted after inventory. The final commit must not include
`eslint.config.js` changes.

## Summary

Command:

```bash
bun run lint 2>&1 | tee /tmp/leaf9-pass1-lint.log
```

Result: 791 warnings, 0 errors. The lint script reported exit code 1 in the
log because `bun run lint` includes `--max-warnings=0`; all findings were
warnings from the temporary probe.

| Rule | Total | server | shared | client | scripts | e2e | packages-shared-rules |
|---|---:|---:|---:|---:|---:|---:|---:|
| `switch-exhaustiveness-check` | 2 | 1 | 0 | 1 | 0 | 0 | 0 |
| `strict-boolean-expressions` | 423 | 139 | 4 | 212 | 45 | 23 | 0 |
| `prefer-readonly` | 17 | 0 | 0 | 1 | 0 | 16 | 0 |
| `consistent-type-exports` | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `promise-function-async` | 349 | 194 | 0 | 153 | 2 | 0 | 0 |

## `@typescript-eslint/switch-exhaustiveness-check`

Total: 2.

Distribution: server 1, shared 0, client 1, scripts 0, e2e 0,
packages-shared-rules 0.

Representative offenders:

- `packages/client/src/components/character-create/wizard-state.ts:231`: the
  top-level wizard reducer handles navigation actions and sends the remaining
  action union through `default` to `handleStepData`.
- `packages/server/scripts/pgexec.ts:30`: `switch (typeof value)` covers
  string, number, bigint, and boolean, while default handles object, function,
  symbol, and undefined by `JSON.stringify`.

Triage hint: (d) per-site investigation needed. The raw count is low, but both
findings are worth reviewing because they are default-backed switches whose
current behavior is intentional but not type-exhaustive.

Special note:

- The prompt expected this rule not to fire when a switch has a `default`
  branch. In this installed plugin/version and default option set, both probe
  warnings above were on switches that already have `default`. Treat that as a
  rule-behavior caveat for Pass 2.
- `packages/{shared,server,client}/src` contains 10 `switch` statements.
- 4 of those 10 have a `default:` branch.
- 6 have no `default:` branch. They appear to be intentional exhaustive union
  switches, but none use an explicit `assertNever` style guard.
- `rg -n "assertNever|never.*=.*x" packages/shared/src packages/server/src packages/client/src`
  returned no matches.

Default-bearing switches in `src`:

- `packages/shared/src/map/area-template.ts:116`: numeric direction fallback.
- `packages/server/src/services/upload-service.ts:30`: MIME-to-extension
  runtime catch-all.
- `packages/server/src/services/upload-service.ts:59`: MIME support check
  runtime catch-all.
- `packages/client/src/components/character-create/wizard-state.ts:231`:
  reducer default delegates non-navigation wizard actions.

Obvious no-default union switches in `src`:

- `packages/shared/src/map/area-template.ts:269`
- `packages/shared/src/rules/character-rules.ts:214`
- `packages/server/src/services/spell-casting/resolve-spell.ts:314`
- `packages/client/src/components/campaign/maps/drawing-overlay.tsx:109`
- `packages/client/src/components/character-create/wizard-state.ts:188`
- `packages/client/src/components/vtt/drawer/monster-stat-block-drawer.tsx:35`

## `@typescript-eslint/strict-boolean-expressions`

Total: 423.

Distribution: server 139, shared 4, client 212, scripts 45, e2e 23,
packages-shared-rules 0.

Representative offenders:

- `e2e/global-setup.ts:13`: environment variable string is used directly as a
  truthy condition.
- `packages/client/src/components/campaign/chat/chat-panel.tsx:218`: nullable
  `compact` boolean controls class selection without an explicit nullish case.
- `packages/server/prisma/seed-template.ts:14`: `DATABASE_URL` string is
  checked with truthiness instead of explicit undefined/empty handling.
- `packages/shared/src/dice/dice-notation.ts:124`: optional regex capture is
  used as a truthy condition before numeric conversion.
- `scripts/code-intel/cli-args.ts:51`: optional CLI command argument is checked
  by falsiness.

Triage hint: (c) per-package roll-out, starting with `shared` first. Shared has
only 4 findings and no rules-subpackage hits. Follow with e2e/scripts, then
server/client in smaller slices because the main app surface is broad.

## `@typescript-eslint/prefer-readonly`

Total: 17.

Distribution: server 0, shared 0, client 1, scripts 0, e2e 16,
packages-shared-rules 0.

Representative offenders:

- `e2e/page-objects/campaign-chat.po.ts:6`: constructor parameter property
  `page` is never reassigned.
- `e2e/page-objects/campaign-detail.po.ts:15`: page object `page` field is
  never reassigned.
- `e2e/page-objects/character-sheet.po.ts:7`: page object `page` field is
  never reassigned.
- `e2e/page-objects/encounter.po.ts:10`: page object `page` field is never
  reassigned.
- `packages/client/src/components/common/error-boundary.tsx:29`: class field
  `handleRetry` is never reassigned.

Triage hint: (b) enable at error after auto-fix pass. The fix is mechanical:
add `readonly` to stable class fields and constructor parameter properties.

Auto-fix preview: running a temporary real `--fix` with the three non-preview
probe rules disabled at the CLI touched 17 files with 17 insertions and 17
deletions. All changes were `prefer-readonly`; `consistent-type-exports` had no
fix surface.

## `@typescript-eslint/consistent-type-exports`

Total: 0.

Distribution: server 0, shared 0, client 0, scripts 0, e2e 0,
packages-shared-rules 0.

Representative offenders: none.

Triage hint: (a) enable at error, modest fix burden. The probe found no
offenders, so this rule is a candidate for direct adoption if the team wants
the convention.

Auto-fix preview: no files touched.

## `@typescript-eslint/promise-function-async`

Total: 349.

Distribution: server 194, shared 0, client 153, scripts 2, e2e 0,
packages-shared-rules 0.

Representative offenders:

- `packages/client/src/components/app-header.test.tsx:97`: `vi.fn(() =>
  Promise.resolve())` returns a promise from a non-async mock implementation.
- `packages/client/src/components/campaign/homebrew-link/campaign-homebrew-section.test.tsx:38`:
  test mock returns a promise from a non-async callback.
- `packages/client/src/components/campaign/npcs/homebrew-monster-tab.test.tsx:68`:
  test mock returns a promise from a non-async callback.
- `packages/server/src/app.test.ts:51`: `Array.from` callback returns
  `rateLimitApp.inject(...)` promises later collected by `Promise.all`.
- `scripts/code-intel/daemon-client.ts:154`: `defaultDaemonTransport` returns a
  manually constructed `Promise` from a non-async function expression.

Triage hint: (c) per-package roll-out, starting with `scripts` first because it
has only 2 findings. Client and server are both large, test-heavy surfaces and
should be split rather than adopted in one pass.

Cross-rule overlap notes:

- The probe log had no `@typescript-eslint/no-floating-promises` or
  `@typescript-eslint/no-misused-promises` findings.
- Spot checks show different concerns: promise-returning callbacks are either
  mocks, values collected into `Promise.all`, or functions whose declared
  contract returns a promise. They are not floating promises or misused promise
  conditionals.

## Auto-fix Preview Notes

`--fix-dry-run` is accepted by this ESLint version, but it behaved strangely
with the type-aware project config: on a single page-object file it reported
strict-null and unsafe type errors that normal lint did not report. The
inventory therefore used the fallback requested in the prompt:

1. Run a real temporary `--fix` with only `prefer-readonly` and
   `consistent-type-exports` active from the probe set.
2. Capture `git diff --stat`.
3. Restore the temporary edits.

Observed fix surface:

```text
17 files changed, 17 insertions(+), 17 deletions(-)
```

Files touched by the preview:

- 16 `e2e/page-objects/*.po.ts` files.
- `packages/client/src/components/common/error-boundary.tsx`.

## Verification Targets

After reverting the probe config, run:

```bash
git diff eslint.config.js
bun run lint -- --max-warnings=0
bun run typecheck
git diff HEAD~1 -- eslint.config.js
git status --short
```

## Implementation Result

Leaf 9 Pass 2 partially landed the tractable `typescript-eslint` opt-ins:

- `@typescript-eslint/consistent-type-exports`: enabled at `error`; 0 findings.
- `@typescript-eslint/prefer-readonly`: enabled at `error`; 17 findings fixed
  mechanically by `eslint --fix` across 16 e2e page objects and
  `ErrorBoundary.handleRetry`.
- `@typescript-eslint/switch-exhaustiveness-check`: enabled at `error`; 2
  findings fixed.

Switch fixes:

- `packages/server/scripts/pgexec.ts`: enumerated all eight `typeof` results;
  `symbol`, `function`, `object`, and the unreachable `undefined` case preserve
  the previous JSON/string-empty behavior, with the defensive `default` kept.
- `packages/client/src/components/character-create/wizard-state.ts`: replaced
  the partial top-level reducer switch with a `NavigationAction` type guard so
  navigation actions still route to `handleNavigation` and all step-data
  actions continue through the existing exhaustive `handleStepData` switch.

Deferred rules:

- `@typescript-eslint/strict-boolean-expressions`: deferred after 423 findings;
  each truthy check needs intent review, with a future rollout recommended from
  shared, then e2e/scripts, then server/client slices.
- `@typescript-eslint/promise-function-async`: deferred after 349 findings;
  test mocks dominate the inventory and production overlap with existing promise
  safety lint was zero, so future rollout should start with scripts before
  larger test-heavy client/server slices.
