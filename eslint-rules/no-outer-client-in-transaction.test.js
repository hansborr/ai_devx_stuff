// @ts-check
import { describe, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./no-outer-client-in-transaction.js";

const ruleTester = makeRuleTester();

describe("no-outer-client-in-transaction", () => {
  it("blocks outer Prisma client calls inside interactive transaction callbacks", () => {
    ruleTester.run("no-outer-client-in-transaction", rule, {
      valid: [
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  await tx.character.update({ where: { id }, data });",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  const updateCharacter = async () => tx.character.update({ where: { id }, data });",
            "  await updateCharacter();",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "await prisma.$transaction(function (tx) {",
            "  return tx.character.update({ where: { id }, data });",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  async function write(prisma) {",
            "    await prisma.character.update({ where: { id }, data });",
            "  }",
            "  await write(tx);",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "await ctx.prisma.$transaction([",
            "  ctx.prisma.session.delete({ where: { id } }),",
            "  ctx.prisma.session.create({ data }),",
            "]);",
          ].join("\n"),
        },
        {
          code: [
            "await prisma.character.findUnique({ where: { id } });",
            "await prisma.$transaction(async (tx) => {",
            "  await tx.character.update({ where: { id }, data });",
            "});",
            "await prisma.character.findUnique({ where: { id } });",
          ].join("\n"),
        },
      ],
      invalid: [
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  await ctx.prisma.character.update({ where: { id }, data });",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  await prisma.character.update({ where: { id }, data });",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  await ctx.prisma?.character.update({ where: { id }, data });",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  await ctx['prisma'].character.update({ where: { id }, data });",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(function (tx) {",
            "  return ctx.prisma.character.update({ where: { id }, data });",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  async function writeOutsideTx() {",
            "    await ctx.prisma.character.update({ where: { id }, data });",
            "  }",
            "  await writeOutsideTx();",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
      ],
    });
  });
});
