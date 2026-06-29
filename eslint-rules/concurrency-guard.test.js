// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./concurrency-guard.js";

const ruleTester = makeRuleTester();

describe("concurrency-guard", () => {
  it("blocks direct writes to gated Prisma delegates outside mutation helpers", () => {
    ruleTester.run("concurrency-guard", rule, {
      valid: [
        {
          filename: "packages/server/src/routers/auth.ts",
          code: "await ctx.prisma.user.update({ where: { id }, data });",
        },
        {
          filename: "packages/server/src/routers/encounter.ts",
          code: "await ctx.prisma.encounterParticipant.create({ data });",
        },
        {
          filename: "packages/server/src/routers/encounter.ts",
          code: "await tx.encounterParticipant.delete({ where: { id } });",
        },
        {
          filename: "packages/server/src/utils/character-stats-mutations.ts",
          code: "await raw.characterStats.updateMany({ where: { characterId, version }, data });",
        },
        {
          filename: "packages/server/src/utils/__type-tests__/character-stats-restrictions.ts",
          code: "await tx.characterStats.update({ where: { characterId }, data });",
        },
      ],
      invalid: [
        {
          filename: "packages/server/src/routers/character.ts",
          code: "await ctx.prisma.characterStats.update({ where: { characterId }, data });",
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "characterStats",
                method: "update",
                suggestion:
                  "Use updateCharacterStatsLocked/updateCharacterStatsLockedWithExpectedVersion from utils/character-stats-mutations.ts.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/encounter.ts",
          code: "await ctx.prisma.encounterParticipant.update({ where: { id }, data });",
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "encounterParticipant",
                method: "update",
                suggestion:
                  "Use updateParticipantStatsLocked/updateParticipantStatsLockedWithExpectedVersion, or blindUpdateParticipant for documented metadata.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/services/rest-service.ts",
          code: "await tx.encounter.updateMany({ where: { id }, data });",
          // Pin the map-selected {{suggestion}} so a mis-edited
          // DIRECT_WRITE_SUGGESTIONS["encounter"] entry fails this case.
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "encounter",
                method: "updateMany",
                suggestion:
                  "Use the encounter-state helpers in utils/encounter-state-mutations.ts.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/spell-slot.ts",
          code: 'await raw["characterSpellSlot"].upsert({ where, create, update });',
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "characterSpellSlot",
                method: "upsert",
                suggestion:
                  "Use consumeSpellSlot/recoverSpellSlot or the documented spell-slot sync helpers.",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/services/level-up/core.ts",
          code: [
            "const { characterClass } = tx;",
            "await characterClass.update({ where: { id }, data });",
          ].join("\n"),
          errors: [
            {
              messageId: "noDirectWrite",
              data: {
                delegate: "characterClass",
                method: "update",
                suggestion:
                  "Use spendHitDice/advanceClassLevel/setSubclass or the documented rest helpers.",
              },
            },
          ],
        },
      ],
    });
  });
});
