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
          // An outer-client call in a declaration outside a transaction is
          // ordinary code and must remain outside this rule's scope.
          code: [
            "async function writeOutsideTransaction() {",
            "  await prisma.character.update({ where: { id }, data });",
            "}",
            "await writeOutsideTransaction();",
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
          code: "await prisma.$transaction();",
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
        {
          code: [
            "await prisma.$transaction(async (prisma) => {",
            "  await write(prisma);",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  await write({ prisma: tx });",
            "  await write(...[tx]);",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  const db = tx;",
            "  await write(db);",
            "});",
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
          // A nested declaration inherits the transaction state explicitly in
          // this rule; the shared tracker must preserve that behavior.
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
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  async function write(prisma) {",
            "    await prisma.character.update({ where: { id }, data });",
            "  }",
            "  await write(prisma);",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  await write(ctx.prisma);",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  await write({ prisma });",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  await write(...[prisma]);",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "const db = prisma;",
            "await prisma.$transaction(async (tx) => {",
            "  await write(db);",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
        {
          code: [
            "await prisma.$transaction(async (tx) => {",
            "  const db = prisma;",
            "  await write(db);",
            "});",
          ].join("\n"),
          errors: [{ messageId: "outerClientInTransaction" }],
        },
      ],
    });
  });
});
