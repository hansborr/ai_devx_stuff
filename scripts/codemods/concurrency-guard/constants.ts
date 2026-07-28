import path from "node:path";

import type {
  HandledHelperMutator,
  NonCasHelperShape,
  PatternAConfig,
  PatternBConfig,
} from "./types.js";

export const CODEMOD_NAME = "concurrency-guard";
export const SERVER_SRC_ROOT = path.join("packages", "server", "src");
export const UTILS_ROOT = path.join(SERVER_SRC_ROOT, "utils");
export const PRISMA_TYPES_RELATIVE = path.join(UTILS_ROOT, "prisma-types.ts");
export const GATED_DELEGATES = new Set([
  "characterStats",
  "encounterParticipant",
  "encounter",
  "characterSpellSlot",
  "characterClass",
]);
// Prisma also exposes create/delete variants on these delegates. They are
// outside the current concurrency gate; this checker mirrors the restricted
// update/upsert surface in packages/server/src/utils/prisma-types.ts.
export const GATED_MUTATORS = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);

// `<parent delegate>.<relation field>` -> the gated delegate a nested write
// through it reaches. Prisma reaches every gated table as a relation of a
// non-gated one, and a nested `{ stats: { update: ... } }` payload never
// touches the gated delegate, so neither the branded types in prisma-types.ts
// nor the direct-call check above can see it.
//
// Not a policy list: it is every relation field in schema.prisma whose target
// is one of the five gated models, qualified by the model that declares it.
// concurrency-guard-drift.test.ts re-derives it from the schema, so a new
// relation to a gated model fails the guard rather than silently widening the
// escape. Qualifying by the parent is what makes the match sound: relation
// names collide across models (`classes` is a CharacterClass[] relation on
// Character and a Json scalar on Spell).
export const GATED_RELATION_FIELDS = new Map<string, string>([
  ["campaign.encounters", "encounter"],
  ["character.classes", "characterClass"],
  ["character.encounterParticipants", "encounterParticipant"],
  ["character.spellSlots", "characterSpellSlot"],
  ["character.stats", "characterStats"],
  ["class.characterClasses", "characterClass"],
  ["combatLog.encounter", "encounter"],
  ["combatLog.participant", "encounterParticipant"],
  ["encounter.participants", "encounterParticipant"],
  ["encounterParticipant.encounter", "encounter"],
  ["map.encounters", "encounter"],
  ["mapToken.encounterParticipant", "encounterParticipant"],
  ["monster.participants", "encounterParticipant"],
  ["subclass.characterClasses", "characterClass"],
]);

// Payload keys that wrap a nested write without changing which model the
// surrounding object describes. Mirrors PAYLOAD_ENVELOPE_KEYS in
// eslint-rules/concurrency-guard.js.
export const PAYLOAD_ENVELOPE_KEYS = new Set([
  "create",
  "data",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "where",
]);
export const HANDLED_HELPER_MUTATOR: HandledHelperMutator = "handled-helper-mutator";

export const PATTERN_A_BY_FILE = new Map<string, PatternAConfig>([
  [
    "character-stats-mutations.ts",
    {
      checkedFunctions: new Set([
        "updateCharacterStatsLocked",
        "updateCharacterStatsLockedWithExpectedVersion",
      ]),
      delegate: "characterStats",
      rowKey: "characterId",
    },
  ],
  [
    "participant-stats-mutations.ts",
    {
      checkedFunctions: new Set([
        "updateParticipantStatsLocked",
        "updateParticipantStatsLockedWithExpectedVersion",
      ]),
      delegate: "encounterParticipant",
      rowKey: "id",
    },
  ],
]);

export const PATTERN_B_BY_FILE = new Map<string, PatternBConfig>([
  [
    "spell-slot-mutations.ts",
    {
      countersByFunction: new Map([
        ["consumeSpellSlot", "used"],
        ["recoverSpellSlot", "used"],
      ]),
      delegate: "characterSpellSlot",
    },
  ],
  [
    "character-class-mutations.ts",
    {
      countersByFunction: new Map([
        ["spendHitDice", "hitDiceUsed"],
        ["advanceClassLevel", "level"],
        ["setSubclass", "subclassId"],
      ]),
      delegate: "characterClass",
    },
  ],
]);

export const ENCOUNTER_STATE_FILE = "encounter-state-mutations.ts";

export const NON_CAS_HELPER_SHAPES: NonCasHelperShape[] = [
  {
    dataPropertyRequired: true,
    delegate: "encounterParticipant",
    functionName: "blindUpdateParticipant",
    method: "updateMany",
    whereFields: ["id"],
  },
  {
    dataFields: ["used"],
    delegate: "characterSpellSlot",
    functionName: "resetAllSpellSlots",
    method: "updateMany",
    whereFields: ["characterId"],
  },
  {
    delegate: "characterSpellSlot",
    functionName: "setSpellSlotTotal",
    method: "upsert",
    updateFields: ["total"],
    upsertCreateFields: ["characterId", "spellLevel", "total", "used"],
    whereFields: ["characterId_spellLevel"],
  },
  {
    delegate: "characterSpellSlot",
    functionName: "grantTemporarySlot",
    method: "upsert",
    updateFields: ["total"],
    upsertCreateFields: ["characterId", "spellLevel", "total", "used"],
    whereFields: ["characterId_spellLevel"],
  },
  {
    dataFields: ["hitDiceUsed"],
    delegate: "characterClass",
    functionName: "resetAllHitDice",
    method: "updateMany",
    whereFields: ["characterId"],
  },
];

export const DIRECT_WRITE_SUGGESTIONS = new Map<string, string>([
  [
    "characterStats",
    "Use updateCharacterStatsLocked/updateCharacterStatsLockedWithExpectedVersion; see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
  ],
  [
    "encounterParticipant",
    "Use updateParticipantStatsLocked/updateParticipantStatsLockedWithExpectedVersion or blindUpdateParticipant for documented metadata; see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
  ],
  [
    "encounter",
    "Use the encounter-state helpers in packages/server/src/utils/encounter-state-mutations.ts; see docs/CONCURRENCY.md#pattern-c--compound-updatemany-for-encounter-state.",
  ],
  [
    "characterSpellSlot",
    "Use consumeSpellSlot/recoverSpellSlot or documented slot sync helpers; see docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
  ],
  [
    "characterClass",
    "Use spendHitDice/advanceClassLevel/setSubclass or documented rest helpers; see docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
  ],
]);
