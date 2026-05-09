# VTT Drawer Follow-ups

Deferred VTT drawer work. Keep these parked until schema work is worth
promoting; do not reopen the legacy combat dialogs.

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
