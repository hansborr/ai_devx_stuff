# Leaf 5 jsx-a11y Inventory

Date: 2026-05-16
Branch: feat/lint-hardening-leaf-5
Package: eslint-plugin-jsx-a11y 6.10.2

## Command

`bunx eslint "packages/client/**/*.tsx" --format=json --output-file=/tmp/musi-jsx-a11y-inventory.json`

Exit code: 0

## Config Diff Summary

Temporary inventory-only `eslint.config.js` changes:

- Imported `eslint-plugin-jsx-a11y`.
- Added a scoped flat config block for `packages/client/**/*.tsx`.
- Spread `jsxA11y.flatConfigs.recommended`.
- Demoted enabled recommended rules from `error` to `warn` while preserving recommended `off` entries.
- Added `settings["jsx-a11y"].components` for Musi UI primitives.

The temporary config was reverted before commit. No committed jsx-a11y warn rules or config block should remain after this pass.

## Component Mapping Used

```js
{
  Button: "button",
  Input: "input",
  Label: "label",
  Link: "a",
  SelectTrigger: "button",
  TabsTrigger: "button",
  Textarea: "textarea",
}
```

Notes:

- `IconButton` does not exist as a separate primitive; icon buttons use `Button size="icon"`.
- `Button` defaults to `button`, but `Button asChild` renders a Radix `Slot`; Pass 2 should keep that ambiguity in mind.
- No anchor/link primitive exists under `packages/client/src/components/ui/`.
- App-level wrappers `MobileNavLink` and `SheetBackLink` were found but not included in the final mapping. Mapping them as anchors creates wrapper false positives because they render internal links rather than receiving accessible link text at the call site.

## Pass 1 Counts

- Total jsx-a11y findings: 58
- Errors: 0
- Warnings: 58

Recommended `off` rules remained off. In particular, the deprecated `jsx-a11y/label-has-for` and the disabled `jsx-a11y/control-has-associated-label` are not part of this count.

## Per-Rule Findings

| Rule | Count | Sample file paths |
| --- | ---: | --- |
| `jsx-a11y/anchor-is-valid` | 24 | packages/client/src/components/app-header.tsx (5)<br>packages/client/src/pages/dashboard-page.tsx (3)<br>packages/client/src/pages/campaign-detail-page.tsx (2)<br>packages/client/src/pages/character-sheet/sheet-sections.tsx (2)<br>packages/client/src/components/campaign/members/members-panel.tsx (1) |
| `jsx-a11y/no-autofocus` | 11 | packages/client/src/components/campaign/combat/initiative-tracker/initiative-row-info.tsx (1)<br>packages/client/src/components/campaign/encounters/create-encounter-dialog.tsx (1)<br>packages/client/src/components/campaign/maps/create-map-dialog.tsx (1)<br>packages/client/src/components/campaign/maps/edit-map-dialog.tsx (1)<br>packages/client/src/components/campaign/notes/note-editor.tsx (1) |
| `jsx-a11y/label-has-associated-control` | 8 | packages/client/src/components/character-create/steps/ability-score-card.tsx (2)<br>packages/client/src/components/homebrew/spell/spell-form-fields.tsx (2)<br>packages/client/src/components/campaign/maps/map-image-field.tsx (1)<br>packages/client/src/components/campaign/tokens/token-form-fields.tsx (1)<br>packages/client/src/components/character-create/steps/personality-step.tsx (1) |
| `jsx-a11y/click-events-have-key-events` | 5 | packages/client/src/components/app-header.tsx (1)<br>packages/client/src/components/campaign/combat/initiative-tracker/initiative-row.tsx (1)<br>packages/client/src/components/sheet/dm-editable-score.tsx (1)<br>packages/client/src/components/vtt/target-pick-overlay.test.tsx (1)<br>packages/client/src/test/mock-react-konva.tsx (1) |
| `jsx-a11y/no-static-element-interactions` | 4 | packages/client/src/components/app-header.tsx (1)<br>packages/client/src/components/sheet/dm-editable-score.tsx (1)<br>packages/client/src/components/vtt/target-pick-overlay.test.tsx (1)<br>packages/client/src/test/mock-react-konva.tsx (1) |
| `jsx-a11y/no-redundant-roles` | 2 | packages/client/src/components/campaign/combat/condition-toggle-popover.tsx (1)<br>packages/client/src/components/notifications/notification-popover.tsx (1) |
| `jsx-a11y/anchor-has-content` | 1 | packages/client/src/components/campaign/tokens/token-context-menu.tsx (1) |
| `jsx-a11y/heading-has-content` | 1 | packages/client/src/components/ui/card.tsx (1) |
| `jsx-a11y/interactive-supports-focus` | 1 | packages/client/src/components/sheet/roll-context-menu.tsx (1) |
| `jsx-a11y/no-noninteractive-element-interactions` | 1 | packages/client/src/components/campaign/combat/initiative-tracker/initiative-row.tsx (1) |

## Notable Patterns

- The finding set is moderate, not tiny: 58 total. Pass 2 likely needs a short triage/fix slice rather than a single quick enable.
- `anchor-is-valid` is the largest bucket. Most findings are TanStack Router `Link` components that use `to` instead of `href`; the recommended rule does not know that `to` is a navigation prop.
- The global `Link -> a` mapping also catches `lucide-react`'s `Link` icon in `token-context-menu.tsx`, producing both `anchor-is-valid` and `anchor-has-content` noise there.
- `no-autofocus` points at real autofocus use in dialog/form flows across campaign, map, notes, NPC, token, and settings surfaces.
- `label-has-associated-control` mostly catches labels without an explicit `htmlFor` or nested control, especially compact character creation and homebrew form rows.
- Interaction rules find clickable non-native elements in app chrome, initiative rows, inline score editing, VTT/test overlays, and the React Konva test mock.
- `heading-has-content` fires on the `CardTitle` primitive implementation because `card.tsx` renders `<h3 {...props} />`; the rule cannot see that `children` arrive through props.

## Rule-Fit Issues To Decide In Pass 2

- `jsx-a11y/anchor-is-valid`: likely needs TanStack Router-aware configuration such as `specialLink: ["to"]`, a narrower `Link` mapping, or import alias cleanup for lucide icons before adoption.
- App-level `MobileNavLink` / `SheetBackLink`: these are link-like wrappers, but global component mapping treats their call sites as anchors and can produce false `anchor-has-content` / missing-`href` reports.
- `Button`: mapping the default element is useful, but `asChild` means some `Button` call sites render anchors or Radix trigger children. Watch for rule misfires in Pass 2.
- `jsx-a11y/heading-has-content`: the one finding is a primitive implementation/static-analysis issue, not a user-facing empty heading.

## Pass 2 Result

Pass 2 adopted `eslint-plugin-jsx-a11y` recommended for
`packages/client/**/*.tsx` at `error`.

Final config:

- `settings["jsx-a11y"].components`: `Button`, `Input`, `Label`,
  `SelectTrigger`, `TabsTrigger`, and `Textarea`. `Link`,
  `MobileNavLink`, and `SheetBackLink` are intentionally not mapped as global
  components.
- `settings["jsx-a11y"].linkComponents`: records TanStack Router `Link` with
  `to`. `eslint-plugin-jsx-a11y` 6.10.2 does not read this setting, so
  `jsx-a11y/anchor-is-valid` also uses the equivalent rule option
  `{ components: ["Link"], specialLink: ["to"] }`.
- Recommended rules stayed enabled; no recommended jsx-a11y rule was dropped.

Cleanup landed:

- TanStack Router `Link` findings were cleared by config; the lucide
  `Link` icon import in `token-context-menu.tsx` was renamed to `LinkIcon`.
- Form/group labels were associated through `htmlFor`, `fieldset`/`legend`,
  labelled groups, or targeted `aria-label` attributes.
- Clickable/static interaction findings were fixed with native/event-aware
  controls or keyboard/focus support. Initiative rows use native `ul`/`li`
  semantics with an overlay select button instead of a `role="button"` row.
- Redundant native roles were removed except the notification popover
  `role="list"` restoration, which keeps list semantics with
  `list-style: none` for Safari/VoiceOver and has a scoped line disable.
- Non-modal `autoFocus` sites were removed; the initiative inline editor now
  focuses and then selects its input in an effect, while modal primary-field
  autofocus kept targeted line disables with reasons.
- Test-only canvas DOM stand-ins and the notification list workaround use
  targeted line disables with reasons. `CardTitle` now renders `children`
  explicitly and no longer needs a disable.

Final finding count: 0 jsx-a11y findings.

Resolution split from the 58-finding Pass 1 inventory:

- 26 findings cleared by config/component mapping.
- 21 findings fixed in client source/tests.
- 11 findings covered by 9 targeted per-line disable directives.

Verification:

- `bunx eslint "packages/client/**/*.tsx" --format=json --output-file=/tmp/musi-jsx-a11y-pass2-after-fixes2.json`
- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run test:client`
- `bash scripts/eslint-disable-register.sh /workspace`

Note: the requested `bun run --filter @musi/client test` command reported
`No packages matched the filter` in this checkout, so the root `test:client`
script was used for the client Vitest project.
