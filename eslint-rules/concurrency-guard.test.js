// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./concurrency-guard.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

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
          errors: [{ messageId: "noDirectWrite" }],
        },
        {
          filename: "packages/server/src/services/rest-service.ts",
          code: "await tx.encounter.updateMany({ where: { id }, data });",
          errors: [{ messageId: "noDirectWrite" }],
        },
        {
          filename: "packages/server/src/routers/spell-slot.ts",
          code: 'await raw["characterSpellSlot"].upsert({ where, create, update });',
          errors: [{ messageId: "noDirectWrite" }],
        },
        {
          filename: "packages/server/src/services/level-up/core.ts",
          code: [
            "const { characterClass } = tx;",
            "await characterClass.update({ where: { id }, data });",
          ].join("\n"),
          errors: [{ messageId: "noDirectWrite" }],
        },
      ],
    });
  });
});
