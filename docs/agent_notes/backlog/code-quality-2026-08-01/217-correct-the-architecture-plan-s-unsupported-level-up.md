# 217. Correct the architecture plan's unsupported level-up rollback claim

Status: Landed on fix/cq-094
Theme: Architecture plan overstates level-choice audit rows as rollback support · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The architecture plan describes persisted level-choice rows as sufficient for
rollback without full character snapshots. Those rows are useful partial
history, but they are not a reversible mutation manifest: they do not capture
the complete prior state or inverse operations for every write in a level-up.

Because this statement appears in the stable architecture guide, contributors
can treat rollback as an available data-model capability and design UI or
service work around an inverse workflow that the router and transaction do not
provide.

## Evidence

- `docs/architecture-plan.md:73-77` — the plan says
  `CharacterLevelChoice` records player-facing choices so recent decisions can
  be reviewed and rolled back without full snapshot versioning.
- `packages/shared/src/schemas/character.ts:190-219` — the typed history
  payloads cover ASI, feat, metamagic, level/class and HP, and subclass
  selections.
- `packages/shared/src/schemas/character.ts:206-213` — the generic level-up
  payload stores HP method, HP gain, optional roll, and class ID, with no
  before-state or inverse-operation data.
- `packages/server/src/services/level-up/asi.ts:123-145`,
  `packages/server/src/services/level-up/subclass.ts:135-149`, and
  `packages/server/src/services/level-up/sorcerer.ts:88-104` — the transaction
  records several concrete choice categories as audit rows alongside their
  corresponding character mutations.
- `packages/server/src/services/level-up/apply-level-up.ts:16-26` — the
  orchestrator documents ten classes of writes spanning stats, class and
  character levels, feats and features, sorcery and metamagic state, subclass
  state, and spell slots before reloading the character. Reproduce the ten write
  steps with
  `sed -n '16,25p' packages/server/src/services/level-up/apply-level-up.ts | rg -c '^ \*   [0-9]+\.'`,
  which returns `10`.
- `packages/server/src/services/level-up/apply-level-up.ts:50-93` — the
  implementation applies those mutations while choice rows capture only
  selected decisions made during the transaction.
- `packages/server/src/routers/character.ts:121-149` — the exported character
  router includes `levelUp` but no undo, downgrade, or rollback mutation.

## Proposed direction

Rewrite the complete “Level-Up Choice Tracking” paragraph, not merely the word
“rollback.” Describe `CharacterLevelChoice` as partial audit/history data for
the choices actually recorded by the current writers: level/class and HP,
ASI or feat, subclass, and metamagic selections. Characterize those rows as
read-only history after application, not as complete character snapshots or
inverse-operation records.

State explicitly that rollback or downgrade would require a separate product
decision and a dedicated design for data capture, authorization, conflicts,
and inverse operations. Do not imply that the current rows make such a feature
mechanically available.

Review every retained example and capability claim in the rewritten paragraph
against the shared schemas, level-up writers, transaction orchestrator, and
router cited above. This documentation-only correction needs no product or
schema test.

## Scope / caveats

- Do not add a rollback, undo, or downgrade feature as part of this correction.
  No router, service, schema, Prisma, or client work belongs in this leaf.
- Preserve the accurate part of the architecture rationale:
  `CharacterLevelChoice` does retain useful partial history. The correction is
  the unsupported reversibility claim, not removal of the model's audit value.
- Do not convert the architecture plan into a delivery-status document. Phrase
  the replacement as a current data-boundary statement.
- [192-expose-level-up-history-already-returned.md](./192-expose-level-up-history-already-returned.md)
  owns presentation of the already-returned history and states its read-only
  limitation at lines 10-12. It expressly leaves this architecture wording
  correction separate at line 56; either leaf may land first.
