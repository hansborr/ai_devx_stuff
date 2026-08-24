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

export const DIRECT_WRITE_REPAIR_SUGGESTIONS = new Map<string, string>([
  [
    "characterStats",
    "Route characterStats writes through updateCharacterStatsLocked or updateCharacterStatsLockedWithExpectedVersion in packages/server/src/utils/character-stats-mutations.ts; follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
  ],
  [
    "encounterParticipant",
    "Route encounterParticipant writes through updateParticipantStatsLocked, updateParticipantStatsLockedWithExpectedVersion, or blindUpdateParticipant in packages/server/src/utils/participant-stats-mutations.ts; use blindUpdateParticipant only for documented metadata, and follow docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
  ],
  [
    "encounter",
    "Route encounter writes through advanceTurnCompound, setEncounterState, setCurrentTurnIndex, assertTurnLock, or updateEncounterMeta in packages/server/src/utils/encounter-state-mutations.ts; follow docs/CONCURRENCY.md#pattern-c--compound-updatemany-with-the-precondition-in-where.",
  ],
  [
    "characterSpellSlot",
    "Use consumeSpellSlot or recoverSpellSlot from packages/server/src/utils/spell-slot-mutations.ts for characterSpellSlot writes, and use the documented slot-sync helpers for synchronization flows; follow docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
  ],
  [
    "characterClass",
    "Use spendHitDice, advanceClassLevel, or setSubclass from packages/server/src/utils/character-class-mutations.ts for characterClass writes, and use the documented rest helpers for rest flows; follow docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
  ],
]);
