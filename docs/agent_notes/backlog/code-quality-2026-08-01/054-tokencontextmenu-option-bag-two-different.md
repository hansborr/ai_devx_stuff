# 54. TokenContextMenu's props type admits combat mode without the combat callbacks it needs

Status: Not started
Theme: discriminated component contracts · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

One context-menu component serves two different surfaces — base map editing and
active combat — through a single flat option bag. `TokenContextMenuProps` has
thirteen props: seven required base props and six optional combat props
(`isInCombat`, `participantId`, `onAdjustHp`, `onLinkParticipant`,
`onUnlinkParticipant`, `unlinkedParticipants`) whose meaning is coordinated by
`isInCombat`. Nothing ties the six together: the type happily accepts
`isInCombat: true` with none of the combat callbacks, and the sub-components
paper over that hole by invoking every callback with `?.` — so a
mis-configured caller renders enabled "Adjust HP" / "Link to Participant"
menu items whose handlers do nothing but close the menu. A contributor adding
a third surface, or trimming props from an existing one, gets no compiler
signal about which of the six travel together; they must reverse-engineer the
mode from the render-time boolean/null checks instead of reading it off the
type.

## Evidence

- `packages/client/src/components/campaign/tokens/token-context-menu.tsx:72-86` —
  `TokenContextMenuProps`: 7 required base props (`token`, `position`, `isDm`,
  `onEdit`, `onRemove`, `onToggleVisibility`, `onClose`) followed by 6
  independently-optional combat props at `:80-85`.
- `token-context-menu.tsx:102`, `:134`, `:162` — `onAdjustHp?.(participantId)`,
  `onUnlinkParticipant?.(participantId)`, `onLinkParticipant?.(token.id, p.id)`:
  each combat handler is optional-chained, so a combat branch can render with
  its callback absent and silently no-op.
- `token-context-menu.tsx:245` and `:274` — the modes are reconstructed at
  render time from loose checks: `isInCombat === true && participantId != null
  && isDm` gates Adjust HP, `isDm && isInCombat` gates link/unlink.
- Exactly two production call sites plus one test:
  `packages/client/src/components/campaign/maps/map-detail-content.tsx:156-172`
  passes only the seven base props;
  `packages/client/src/components/campaign/combat/combat-map-content.tsx:185-207`
  passes all thirteen, with `isInCombat={encounter.state === "active"}` at
  `:201` and a nullable `participantId` (`token.encounterParticipantId`) at
  `:202`.
- `packages/client/src/components/campaign/tokens/token-context-menu.test.tsx:13-26`
  — the test's `renderMenu` builds props as
  `Partial<Parameters<typeof TokenContextMenu>[0]>` over base-only defaults, so
  it needs the same variant-aware update as the call sites.

## Proposed direction

Split `TokenContextMenuProps` into a discriminated map/combat props union so
combat mode statically requires `participantId`, HP, and link/unlink
callbacks, updating the two call sites (`map-detail-content.tsx`,
`combat-map-content.tsx`) and the component test while keeping shared menu
items local.

Mechanics: the map variant is the seven base props with no combat fields; the
combat variant adds all six combat fields as required — `participantId` stays
`string | null` (unlinked tokens are legal, `:128` branches on it) and
`isInCombat` stays `boolean` *inside* the variant (combat toggles items by
encounter state at `combat-map-content.tsx:201`; the union discriminates on
which surface is rendering, not on that runtime boolean). With the callbacks
required, drop the `?.` at `:102`, `:134`, `:162` and the `?? []` fallback at
`:279`. Single-commit change; verify with
`bun run test -- packages/client/src/components/campaign/tokens/token-context-menu.test.tsx`.

## Scope / caveats

- **Keep the shared menu items local to this file.** `OpenSheetMenuItem`,
  `DmMenuItems`, and the header stay as module-private pieces both variants
  render; this leaf does not split the component into two files or extract any
  shared shell.
- **Type-level change only, plus the dead-fallback deletions it makes
  provable.** The render conditions at `:245`/`:258`/`:274`/`:287` and every
  menu behavior stay as they are.
- Prior pack: the 2026-07-25 pack's
  [13-client-shell-duplication.md](../code-quality-2026-07-25/13-client-shell-duplication.md)
  recorded this same 7+6 prop split, landed only the `useTokenContextMenu`
  state protocol (slice O1, merge `6cf8c78d5`), and ruled that two call sites
  do not earn a *configurable shell*. That ruling refused adding new
  option-bag units; it did not rule out narrowing this existing component's
  unsafe props contract — this leaf moves in the opposite direction, removing
  optionality rather than adding it. Do not reopen the dropped shell
  extractions while here.
- The test helper's `Partial<...>` override pattern
  (`token-context-menu.test.tsx:13`) does not distribute cleanly over a
  union; give the test explicit map-variant and combat-variant default bags
  rather than casting past the union.
- Soft sequencing edge with
  [179-turn-disabled-stat-block-placeholder-party.md](./179-turn-disabled-stat-block-placeholder-party.md):
  both change TokenContextMenu's combat contract, combat-map-content.tsx, and
  variant tests; whichever lands second must carry the reveal-aware open-sheet
  input through the discriminated combat props and explicit combat test bag.
- Soft sequencing edge with
  [215-converge-destructive-client-actions-on-one.md](./215-converge-destructive-client-actions-on-one.md):
  both change TokenContextMenu, its onRemove caller semantics, and its test
  helper; whichever lands second must preserve the discriminated map/combat
  bags while carrying the confirmation-owner and user-level dialog coverage
  changes.
