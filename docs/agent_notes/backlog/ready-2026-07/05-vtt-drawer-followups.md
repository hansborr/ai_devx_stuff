# VTT Drawer Follow-ups

Status: Ready — design-then-implement (largest ready item; L). The schema
work IS the task: extend `spellSchema`/`monsterActionSchema` with structured
damage/attack fields, backfill from SRD ingest, then wire `useConfirmCast`'s
combat path and the inert monster Atk/Dmg buttons. Re-verified 2026-07-19:
both sub-items fully open (`monster-stat-block-actions.tsx` buttons still
`console.log` placeholders; `encounterCombat.castCombatSpell` has no client
surface). Do not reopen the legacy combat dialogs.
Date: 2026-06-14 (re-verified 2026-07-19)

## Combat-spell resolution through the drawer

Current state:

- Drawer spell casting uses `castSpell.cast` for slot drain, concentration
  replacement, and campaign chat in and out of encounters.
- `encounterCombat.castCombatSpell` still exists on the server, but no longer
  has a client UI surface after the legacy `SpellCastDialog` removal.
- This is deliberate: the shared `Spell` contract does not yet carry enough
  structured damage / save / target fan-out data for a faithful drawer combat
  resolution flow.

Promotion shape:

- Extend the spell schema with structured damage dice, damage type, save /
  attack metadata, and target fan-out semantics.
- Extend `useConfirmCast` rather than reviving `SpellCastDialog`.
- Preserve the current out-of-encounter path for slot drain + chat + template
  placement when damage resolution does not apply.
- Add server, hook/component, and E2E coverage for at least one attack spell,
  one save spell, and one AoE spell with multiple overlapped targets.

## Monster action Atk / Dmg buttons

Current state:

- Monster stat blocks render `Atk` / `Dmg` buttons as inert drawer controls.
- Monster action resolution was intentionally split out because the SRD monster
  action schema only has prose today.

Promotion shape:

- Extend `monsterActionSchema` with optional structured attack fields:
  `attackBonus`, `damageDice`, `damageBonus`, `damageType`, and optional crit
  overrides if the existing combat mutation needs them.
- Backfill data via SRD ingest where the action prose is unambiguous.
- Wire monster `Atk` / `Dmg` through `encounterCombat.attemptAttack` with
  `mode: "custom"` from the drawer.
- Keep malformed or ambiguous actions display-only rather than guessing.
