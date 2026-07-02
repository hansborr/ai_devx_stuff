// @ts-check

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import rule from "./trpc-auth-before-persistence-rule.mjs";

RuleTester.describe = (_name, run) => run();
RuleTester.it = (_name, run) => run();
RuleTester.itOnly = (_name, run) => run();

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

ruleTester.run("leaf40/trpc-auth-before-persistence", rule, {
  valid: [
    {
      code: [
        "const get = protectedProcedure.query(async ({ ctx, input }) => {",
        "  await assertCampaignMember(ctx, input.campaignId);",
        "  return ctx.prisma.encounter.findMany({ where: { campaignId: input.campaignId } });",
        "});",
      ].join("\n"),
    },
    {
      code: [
        "const create = protectedProcedure.mutation(async ({ ctx }) => {",
        "  return serviceCreateThing(ctx);",
        "});",
      ].join("\n"),
    },
    {
      code: [
        "const list = publicProcedure.query(async ({ ctx }) => {",
        "  return ctx.prisma.magicItem.findMany();",
        "});",
      ].join("\n"),
      options: [
        {
          procedureAllowlist: ["<input>:list"],
        },
      ],
    },
  ],
  invalid: [
    {
      code: [
        "const get = protectedProcedure.query(async ({ ctx, input }) => {",
        "  const encounter = await ctx.prisma.encounter.findUnique({ where: { id: input.id } });",
        "  await assertCampaignMember(ctx, encounter.campaignId);",
        "  return encounter;",
        "});",
      ].join("\n"),
      errors: [{ messageId: "prismaBeforeAuth", line: 2 }],
    },
    {
      code: [
        "const update = protectedProcedure.mutation(async ({ ctx, input }) => {",
        "  const encounter = await ctx.prisma.encounter.findUnique({ where: { id: input.id } });",
        "  await assertEncounterDm(ctx, encounter.id);",
        "  return ctx.prisma.encounter.update({ where: { id: input.id }, data: input.data });",
        "});",
      ].join("\n"),
      options: [{ boundaryNames: ["assertCampaignMember"] }],
      errors: [
        { messageId: "prismaBeforeAuth", line: 2 },
        { messageId: "prismaBeforeAuth", line: 4 },
      ],
    },
    {
      code: [
        "const update = protectedProcedure.mutation(async ({ ctx, input }) => {",
        "  await assertEncounterDm(ctx, input.encounterId);",
        "  return ctx.prisma.encounter.update({ where: { id: input.encounterId }, data: input.data });",
        "});",
      ].join("\n"),
      options: [{ boundaryNames: ["assertCampaignMember"] }],
      errors: [{ messageId: "prismaBeforeAuth", line: 3 }],
    },
  ],
});

console.log("leaf 40 RuleTester fixtures passed");
