# 62. The two client saving-throw readers each hand-roll ability identity, so they disagree with the server on alias spellings

Status: **Done 2026-07-30** on branch
`fix/cq-62-67-identity-and-docs`, commit `e0651d774`. Both client
saving-throw readers now use the shared ability-identity contract, with
component regressions for full-name and whitespace/case variants on each
surface. The whole-client sweep found no third production reader.
Theme: Ability-identity contract drift · Area: client (+ shared) · Severity: low · Size: XS

Source: the four-model merge panel on `fix/saving-throw-proficiency-identity`,
2026-07-28 — all four reviewers independently recommended keeping this out of
that branch and filing it separately · Confidence: high — the divergence was
verified against the live tree by four reviewers

## Problem

[Leaf 61](./61-saving-throw-proficiency-identity.md) gave the server one shared
ability-identity helper, `hasSavingThrowProficiency`, and made server reads
tolerant of the six full ability names plus case and whitespace variants. It
deliberately did not touch the client.

So the two client readers still build their own uppercased `Set` and compare it
against `SAVE_ABILITIES`, with no `.trim()` and no alias table. A `savingThrow`
proficiency stored as `"Constitution"` — or `" CON "` — now:

- **grants** the proficiency bonus on every server-resolved save (spell saves,
  concentration), and
- **renders as not proficient** on the character sheet and in the VTT stats tab,
  where a player-initiated manual roll also uses the un-bonused modifier.

That is the same class of defect leaf 61 fixed, one layer up and much narrower.

## Why this is small, and why it is not nothing

It predates leaf 61 at identical severity — a `"Constitution"` row was already
proficient server-side and non-proficient client-side before that branch — and
leaf 61 strictly reduced total client/server disagreement rather than widening
it. It is also only reachable for rows written through the free-form
`CreateCharacterInput.proficiencies[].name`, never through `deriveProficiencies`,
which writes abbreviations the client already handles.

What keeps it worth filing is that the duplicated comparison is now duplicated
*against an existing shared helper*, which is the state the pack's own rules
treat as debt rather than as a tolerable copy.

## Evidence

- Client sheet reader, hand-rolled set, no trim:
  `packages/client/src/components/sheet/saving-throws.tsx:65-75`.
- VTT drawer reader, same shape:
  `packages/client/src/components/vtt/drawer/tabs/stats-tab-rolls.tsx:115-128`.
- The shared helper they should use, already exported and already
  alias-tolerant: `packages/shared/src/rules/character-rules.ts`
  (`normalizeAbilityIdentity`, `hasSavingThrowProficiency`).
- The write path that keeps non-canonical spellings reachable:
  `packages/shared/src/schemas/character-inputs.ts:72-79`.

## Proposed direction

1. Replace both hand-rolled `Set` comparisons with `hasSavingThrowProficiency`.
2. Add component tests covering a full-name row and a whitespace/case variant on
   each surface — the assertions that would have caught this.
3. Check no other client surface compares proficiency names to ability
   identities; leaf 61's sweep found none server-side, but it did not audit the
   client beyond these two files.

Interaction worth noting before scheduling: if
[leaf 61's other follow-up](./61-saving-throw-proficiency-identity.md) — tightening
`savingThrow` writes to `abilityAbbreviationSchema` — is done first, alias
tolerance could be dropped on both sides at once instead of added to the client.
Doing this leaf first is still safe; it just means the eventual tightening
removes code from three places rather than two.

## Verify

```
bun run test -- --project client src/components/sheet/saving-throws.test.tsx
bun run test -- --project client src/components/vtt/drawer/tabs/stats-tab-rolls.test.tsx
bun run test -- --project shared src/rules/character-rules.test.ts
```
