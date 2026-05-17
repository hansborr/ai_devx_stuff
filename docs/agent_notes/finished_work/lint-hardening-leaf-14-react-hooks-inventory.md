# Lint Hardening Leaf 14: React Hooks Broadened Inventory (Pass 1)

Date: 2026-05-16
Branch: `feat/lint-hardening-leaf-14`

## Scope

This was an inventory-only pass for `eslint-plugin-react-hooks` v7 rules beyond
the two already configured in `eslint.config.js`.

- Plugin version: `react-hooks@7.0.1` (`eslint-plugin-react-hooks`)
- Probe command: `bun run lint 2>&1 | tee /tmp/leaf14-pass1-lint.log`
- Probe scope: temporary `packages/client/**/*.{ts,tsx}` block
- Probe rules: every exposed `react-hooks/*` rule except
  `react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`
- Temporary ESLint config block was reverted after capture.
- Post-revert `git diff -- eslint.config.js` produced no output.

Note: the current repo config has `react-hooks/exhaustive-deps` at `warn`, not
`error`. This pass left that unchanged.

## Full Plugin Rule List

`eslint-plugin-react-hooks@7.0.1` exposes both
`reactHooks.configs.flat["recommended-latest"]` and
`reactHooks.configs.flat.recommended`. The table records each rule exposed by
`Object.keys(reactHooks.rules)` and the severity from those flat configs when
present.

| Rule | recommended-latest | recommended | Probe status |
| --- | --- | --- | --- |
| `react-hooks/exhaustive-deps` | `warn` | `warn` | excluded, already configured |
| `react-hooks/rules-of-hooks` | `error` | `error` | excluded, already configured |
| `react-hooks/hooks` | not listed | not listed | probed at `warn` |
| `react-hooks/capitalized-calls` | not listed | not listed | probed at `warn` |
| `react-hooks/static-components` | `error` | `error` | probed at `warn` |
| `react-hooks/use-memo` | `error` | `error` | probed at `warn` |
| `react-hooks/void-use-memo` | `error` | not listed | probed at `warn` |
| `react-hooks/component-hook-factories` | `error` | `error` | probed at `warn` |
| `react-hooks/preserve-manual-memoization` | `error` | `error` | probed at `warn` |
| `react-hooks/incompatible-library` | `warn` | `warn` | probed at `warn` |
| `react-hooks/immutability` | `error` | `error` | probed at `warn` |
| `react-hooks/globals` | `error` | `error` | probed at `warn` |
| `react-hooks/refs` | `error` | `error` | probed at `warn` |
| `react-hooks/memoized-effect-dependencies` | not listed | not listed | probed at `warn` |
| `react-hooks/set-state-in-effect` | `error` | `error` | probed at `warn` |
| `react-hooks/no-deriving-state-in-effects` | not listed | not listed | probed at `warn` |
| `react-hooks/error-boundaries` | `error` | `error` | probed at `warn` |
| `react-hooks/purity` | `error` | `error` | probed at `warn` |
| `react-hooks/set-state-in-render` | `error` | `error` | probed at `warn` |
| `react-hooks/invariant` | not listed | not listed | probed at `warn` |
| `react-hooks/todo` | not listed | not listed | probed at `warn` |
| `react-hooks/syntax` | not listed | not listed | probed at `warn` |
| `react-hooks/unsupported-syntax` | `warn` | `warn` | probed at `warn` |
| `react-hooks/config` | `error` | `error` | probed at `warn` |
| `react-hooks/gating` | `error` | `error` | probed at `warn` |
| `react-hooks/rule-suppression` | not listed | not listed | probed at `warn` |
| `react-hooks/automatic-effect-dependencies` | not listed | not listed | probed at `warn` |
| `react-hooks/fire` | not listed | not listed | probed at `warn` |
| `react-hooks/fbt` | not listed | not listed | probed at `warn` |

## Warning Summary

Total warning count: 40

| Rule | Count | Triage hint |
| --- | ---: | --- |
| `react-hooks/set-state-in-effect` | 23 | (d) too noisy / structural mismatch - defer; broad prop-to-local-state, reset, and external-system synchronization patterns need design review before promotion |
| `react-hooks/refs` | 5 | (b) modest fixes; promote after cleanup |
| `react-hooks/rule-suppression` | 5 | (c) per-site investigation needed |
| `react-hooks/hooks` | 3 | (c) per-site investigation needed |
| `react-hooks/todo` | 3 | (d) too noisy / structural mismatch - defer; non-preset compiler TODO diagnostics on supported TypeScript patterns |
| `react-hooks/static-components` | 1 | (b) modest fixes; promote after cleanup |

## Per-Rule Findings

### `react-hooks/set-state-in-effect` - 23 warnings

Triage hint: (d) too noisy / structural mismatch - recommend deferring. The
findings are spread across combat, map dialogs, homebrew dialogs, sheet
dialogs, socket setup, background image loading, and pagination hooks. Most are
not isolated bugs; they are established patterns for copying props into editable
local form state, resetting dialog state on open/close, or syncing external
resources.

Representative offenders:

- `packages/client/src/components/campaign/combat/combat-map-bridges.ts:16` -
  clears turn tracking state synchronously inside an effect when the encounter
  or map is inactive.
- `packages/client/src/components/campaign/maps/create-map-dialog.tsx:216` -
  derives a preview URL from the selected image file inside an effect and stores
  it in React state.
- `packages/client/src/components/campaign/maps/edit-map-dialog.tsx:83` -
  copies the selected map's fields into editable dialog state inside an effect.
- `packages/client/src/components/campaign/notes/note-editor.tsx:150` - copies
  selected note fields into local editor state inside an effect.
- `packages/client/src/hooks/socket-context.tsx:47` - clears socket and
  connection state synchronously during socket lifecycle cleanup.

### `react-hooks/refs` - 5 warnings

Triage hint: (b) modest fixes; promote after cleanup. The warnings are limited
to render-time `.current` assignment patterns used to keep callbacks stable.

Representative offenders:

- `packages/client/src/components/campaign/members/join-campaign-dialog.tsx:86`
  - writes `joinMutation` into a ref during render so an effect can call
  `reset()`.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:138` -
  writes `updateMutation.mutate` into a ref during render.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:140` -
  writes `updateMutation.mutateAsync` into a ref during render.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:142` -
  writes `adjustMutation.mutate` into a ref during render.
- `packages/client/src/hooks/character-sheet/use-character-stats.ts:144` -
  writes `adjustMutation.mutateAsync` into a ref during render.

### `react-hooks/rule-suppression` - 5 warnings

Triage hint: (c) per-site investigation needed. This rule is not in either flat
recommended preset. It flags existing, documented `react-hooks/exhaustive-deps`
disable comments because React Compiler skips components with React rule
suppressions.

Representative offenders:

- `packages/client/src/hooks/auth-context.tsx:66` - mount-only refresh effect
  suppresses `exhaustive-deps` to avoid double refresh-token rotation.
- `packages/client/src/hooks/auth-context.tsx:88` - login callback suppresses
  `exhaustive-deps` around TanStack Query `mutateAsync` stability.
- `packages/client/src/hooks/auth-context.tsx:96` - register callback suppresses
  `exhaustive-deps` around TanStack Query `mutateAsync` stability.
- `packages/client/src/hooks/auth-context.tsx:105` - logout callback suppresses
  `exhaustive-deps` around TanStack Query `mutateAsync` stability.
- `packages/client/src/pages/join-page.tsx:38` - join page suppresses
  `exhaustive-deps` for a one-shot join mutation after user and code are ready.

### `react-hooks/hooks` - 3 warnings

Triage hint: (c) per-site investigation needed. This rule is not in either flat
recommended preset and appears sensitive to values or procedure names that look
like hooks but are not necessarily called as hooks at the flagged site.

Representative offenders:

- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:161`
  - treats the Zustand-style `useCombatStore` function as a normal store value
  for `getState()`.
- `packages/client/src/components/campaign/encounters/encounter-detail-view.tsx:182`
  - includes that store function in a callback dependency list.
- `packages/client/src/hooks/vtt-drawer/use-feature-use.ts:32` - flags the
  `trpc.character.useFeature.mutationOptions(...)` property chain as a
  hook-like value that may change identity.

### `react-hooks/todo` - 3 warnings

Triage hint: (d) too noisy / structural mismatch - recommend deferring. This is
not in either flat recommended preset and reports compiler implementation TODOs
rather than clear application-level React issues.

Representative offenders:

- `packages/client/src/components/common/form-field.tsx:34` - reports a compiler
  TODO for ternaries inside an array used to build `aria-describedby`.
- `packages/client/src/components/homebrew/collections/collection-card.tsx:49`
  - reports a compiler TODO for `try`/`finally` in an async export handler.
- `packages/client/src/hooks/use-map-image-upload.ts:50` - reports a compiler
  TODO for `try` without `catch` in an async upload callback.

### `react-hooks/static-components` - 1 warning

Triage hint: (b) modest fixes; promote after cleanup. The finding is isolated.

Representative offender:

- `packages/client/src/components/notifications/notification-item.tsx:56` -
  renders a dynamically selected `Icon` component returned by
  `getNotificationIcon(notification.type)` inside the component render.

## Rules With 0 Warnings

These rules fired 0 times under the temporary client probe. They are clean from
a current-warning-count perspective. The rules that are not in
`recommended-latest` still need an explicit adoption decision before promotion.

- `react-hooks/automatic-effect-dependencies`
- `react-hooks/capitalized-calls`
- `react-hooks/component-hook-factories`
- `react-hooks/config`
- `react-hooks/error-boundaries`
- `react-hooks/fbt`
- `react-hooks/fire`
- `react-hooks/gating`
- `react-hooks/globals`
- `react-hooks/immutability`
- `react-hooks/incompatible-library`
- `react-hooks/invariant`
- `react-hooks/memoized-effect-dependencies`
- `react-hooks/no-deriving-state-in-effects`
- `react-hooks/preserve-manual-memoization`
- `react-hooks/purity`
- `react-hooks/set-state-in-render`
- `react-hooks/syntax`
- `react-hooks/unsupported-syntax`
- `react-hooks/use-memo`
- `react-hooks/void-use-memo`

## Cross-Rule Overlap

No two probed React hooks rules reported the same `file:line:column` location
in the JSON lint report. Several areas would still be touched by separate
cleanup workstreams, especially dialog state reset effects and TanStack
mutation callback/ref stability patterns, but there was no exact same-location
overlap among `set-state-in-effect`, `refs`, `static-components`,
`rule-suppression`, `hooks`, and `todo`.

## Probe Notes

- No probed rule threw on Musi's code.
- `recommended-latest` differs from `recommended` by adding
  `react-hooks/void-use-memo`.
- The installed plugin exposes additional non-preset rules that the Leaf 14
  backlog did not name directly: `automatic-effect-dependencies`,
  `capitalized-calls`, `fbt`, `fire`, `hooks`, `invariant`,
  `memoized-effect-dependencies`, `no-deriving-state-in-effects`,
  `rule-suppression`, `syntax`, and `todo`.

## Implementation Result

Pass 2 adopted `reactHooks.configs.flat["recommended-latest"]` for
`packages/client/**/*.{ts,tsx}` with one override:
`react-hooks/set-state-in-effect` is off. That rule produced 23 findings in
established props-to-local-state, dialog reset, and external-system sync
patterns; promoting it needs a UI-wide state/effect refactor rather than a
small lint-hardening cleanup.

The five `react-hooks/refs` findings were fixed by removing render-time ref
writes:

- `packages/client/src/hooks/character-sheet/use-character-stats.ts` now
  destructures the stable TanStack mutation members (`mutate` /
  `mutateAsync`) and uses them directly in callbacks.
- `packages/client/src/components/campaign/members/join-campaign-dialog.tsx`
  now destructures the stable `reset` member from the join mutation and uses it
  directly in the close/reset effect.

The one `react-hooks/static-components` finding was fixed in
`packages/client/src/components/notifications/notification-item.tsx` by
replacing the dynamic icon factory/render variable with a small
`NotificationIcon` component that switches on `notification.type`.

The non-preset rules were not enabled: `react-hooks/hooks`,
`react-hooks/todo`, `react-hooks/rule-suppression`,
`react-hooks/automatic-effect-dependencies`, `react-hooks/fbt`,
`react-hooks/fire`, `react-hooks/invariant`,
`react-hooks/memoized-effect-dependencies`,
`react-hooks/no-deriving-state-in-effects`, `react-hooks/syntax`, and
`react-hooks/capitalized-calls`.
