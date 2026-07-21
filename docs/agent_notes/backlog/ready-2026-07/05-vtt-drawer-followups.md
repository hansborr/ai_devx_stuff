# VTT Drawer Follow-ups

Status: Done — implemented 2026-07-20 in the C6 structured-combat series.
Structured spell metadata and conservative SRD backfills now drive atomic
multi-target combat resolution from the drawer, while unsupported or
ambiguous casts retain the ordinary cast path. Structured monster actions use
one accessible `Attack` control; ambiguous actions remain prose-only. Browser
coverage pins the attack, save, area, cast-only, and monster-action routes.
Date: 2026-06-14 (completed 2026-07-20)

## Combat-spell resolution through the drawer

Completed state:

- Executable class-sourced spells with persisted combat metadata use
  `encounterCombat.castCombatSpell` with server-derived attack/save values and
  plural participant-attributed results.
- Unsupported, non-class, ambiguous-class, ritual, and out-of-encounter casts
  use `castSpell.cast`, preserving slot, concentration, and chat behavior.
- Area damage resolves every unique linked participant overlapped by the
  template, consumes one slot, and commits HP/log changes atomically.

Implemented shape:

- Extended the spell schema with structured damage dice, damage type, save /
  attack metadata, and target fan-out semantics.
- Extended `useConfirmCast` rather than reviving `SpellCastDialog`.
- Preserved the out-of-encounter path for slot drain + chat + template
  placement when damage resolution does not apply.
- Added server, hook/component, and E2E coverage for an attack spell,
  one save spell, and one AoE spell with multiple overlapped targets.

## Monster action Atk / Dmg buttons

Completed state:

- Conservatively parsed SRD actions carry complete structured attack fields.
- Complete actions render one accessible `Attack with <action>` button and
  resolve through `encounterCombat.attemptAttack`.
- Ambiguous, legacy, inline, and homebrew actions remain prose-only.

Implemented shape:

- Extended `monsterActionSchema` with optional structured attack fields:
  `attackBonus`, `damageDice`, `damageBonus`, and `damageType`.
- Backfilled data via SRD ingest where the action prose is unambiguous.
- Wired the single monster `Attack` control through
  `encounterCombat.attemptAttack` with `mode: "custom"` from the drawer.
- Kept malformed or ambiguous actions display-only rather than guessing.

## Verification

- 2026-07-20 follow-up: `. ./.env && bun run --filter @musi/server
  backfill:monster-actions` completed with `updated: 329`, `structured: 244`,
  and `rejected: 0`. The structured count decreased from 253 after actions
  with unrepresented secondary or alternate damage were made display-only.
