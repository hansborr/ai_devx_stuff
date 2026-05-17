// @ts-check
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";

import rule from "./no-broadcast-in-transaction.js";

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

describe("no-broadcast-in-transaction", () => {
  it("blocks socket broadcasts inside Prisma transaction callbacks", () => {
    ruleTester.run("no-broadcast-in-transaction", rule, {
      valid: [
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  await tx.user.update({ where: { id }, data });",
            "});",
            "broadcastCampaignUpdate(io, campaignId, logger);",
          ].join("\n"),
        },
        {
          code: [
            "broadcastEncounterUpdate(io, campaignId, encounterId, logger);",
            "await ctx.prisma.$transaction([writeOne, writeTwo]);",
          ].join("\n"),
        },
        {
          code: "await ctx.prisma.$transaction(async () => sendEmail(user));",
        },
      ],
      invalid: [
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  await tx.encounter.update({ where: { id }, data });",
            "  broadcastEncounterUpdate(io, campaignId, encounterId, logger);",
            "});",
          ].join("\n"),
          errors: [{ message: /docs\/guides\/add-socket-broadcast\.md/u }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            "  await broadcastChatMessage(io, room, message, { logger });",
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  broadcast(io, "encounter:updated", payload, { logger });',
            '  await broadcastToUsers(io, "notification:new", notification, { userIds, logger });',
            "});",
          ].join("\n"),
          errors: [
            { messageId: "noBroadcastInTransaction" },
            { messageId: "noBroadcastInTransaction" },
          ],
        },
      ],
    });
  });
});
