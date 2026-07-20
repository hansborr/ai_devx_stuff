// @ts-check
import { describe, expect, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule from "./no-broadcast-in-transaction.js";

const ruleTester = makeRuleTester();

describe("no-broadcast-in-transaction", () => {
  it("names the post-commit architecture decision", () => {
    expect(rule.meta.messages.noBroadcastInTransaction).toContain("ADR-0003");
  });

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
        {
          code: [
            "await ctx.prisma.$transaction(async (tx) => {",
            "  await tx.encounter.update({ where: { id }, data });",
            "});",
            'io.to(room).emit("encounter:updated", payload);',
          ].join("\n"),
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            "  domainEvents.emit(eventName, payload);",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            "  eventBus.except(room).emit(eventName, payload);",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            "  eventBus.broadcast.emit(eventName, payload);",
            "  eventBus.local.emit(eventName, payload);",
            "  eventBus.timeout(5000).emit(eventName, payload);",
            "  eventBus.compress(true).emit(eventName, payload);",
            "});",
          ].join("\n"),
        },
        {
          code: [
            "socketServer.on('connection', () => {",
            '  io.to(room).emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
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
          errors: [{ messageId: "noBroadcastInTransaction" }],
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
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  io.to(room).emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  io.in(room).volatile.emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  getSocketIO(server).to(room).emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  ctx.req.server.io.to(room).emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  io.to(room).except(excludedRoom).emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  socket.broadcast.emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  io.timeout(5000).emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  io.local.emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
        {
          code: [
            "await ctx.prisma.$transaction(async () => {",
            '  io.compress(true).emit("encounter:updated", payload);',
            "});",
          ].join("\n"),
          errors: [{ messageId: "noBroadcastInTransaction" }],
        },
      ],
    });
  });
});
