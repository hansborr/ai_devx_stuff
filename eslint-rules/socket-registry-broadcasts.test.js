// @ts-check
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { makeRuleTester } from "./rule-tester.js";
import rule, { REGISTRY_OWNED_EVENT_HELPERS } from "./socket-registry-broadcasts.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const ruleTester = makeRuleTester();

function propertyNameText(name) {
  if (ts.isStringLiteral(name) || ts.isIdentifier(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function collectObjectKeys(node) {
  return node.properties
    .filter(ts.isPropertyAssignment)
    .map((property) => propertyNameText(property.name))
    .filter((name) => name !== undefined);
}

function registryEventNames() {
  const registryPath = join(repoRoot, "packages/server/src/socket/broadcast-registry.ts");
  const sourceText = readFileSync(registryPath, "utf8");
  const sourceFile = ts.createSourceFile(registryPath, sourceText, ts.ScriptTarget.Latest, true);
  const names = [];

  ts.forEachChild(sourceFile, function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "BROADCAST_REGISTRY" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      names.push(...collectObjectKeys(node.initializer));
      return;
    }
    ts.forEachChild(node, visit);
  });

  return names.sort();
}

describe("socket-registry-broadcasts", () => {
  it("names the registry architecture decision", () => {
    expect(rule.meta.messages.noDirectEmit).toContain("ADR-0003");
  });

  it("tracks every broadcast registry event", () => {
    const ruleEvents = REGISTRY_OWNED_EVENT_HELPERS.map(([eventName]) => eventName).sort();

    expect(ruleEvents).toEqual(registryEventNames());
  });

  it("runs", () => {
    ruleTester.run("socket-registry-broadcasts", rule, {
      valid: [
        // The registry owns literal emit calls for registered events.
        {
          filename: "packages/server/src/socket/broadcast-registry.ts",
          code: 'io.to(room).emit("encounter:updated", payload); socket.emit("notification:new", payload);',
        },
        // Helpers and registry functions are the allowed call surface.
        {
          filename: "packages/server/src/routers/encounter.ts",
          code: "broadcastEncounterUpdate(io, campaignId, encounterId, logger);",
        },
        {
          filename: "packages/server/src/services/notification-service.ts",
          code: 'broadcastToUsers(io, "notification:new", notification, { userIds, logger });',
        },
        // Non-registry events stay out of scope.
        {
          filename: "packages/server/src/socket/index.ts",
          code: 'socket.emit("connect_error", payload);',
        },
        // Dynamic event names are out of scope; this rule guards the low-risk
        // direct literal shape.
        {
          filename: "packages/server/src/socket/index.ts",
          code: "socket.emit(eventName, payload);",
        },
      ],
      invalid: [
        // Each invalid case pins the map-selected {{helper}} so a mis-edited
        // REGISTRY_OWNED_EVENT_HELPERS pair (event -> wrong helper) fails here.
        {
          filename: "packages/server/src/routers/campaign.ts",
          code: 'io.to(room).emit("campaign:updated", payload);',
          errors: [
            {
              messageId: "noDirectEmit",
              data: {
                eventName: "campaign:updated",
                helper: "broadcastCampaignUpdate(...)",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/encounter.ts",
          code: 'io.to(room).emit("encounter:updated", payload);',
          errors: [
            {
              messageId: "noDirectEmit",
              data: {
                eventName: "encounter:updated",
                helper: "broadcastEncounterUpdate(...)",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/utils/character-campaign.ts",
          code: 'socket.emit("character:updated", payload);',
          errors: [
            {
              messageId: "noDirectEmit",
              data: {
                eventName: "character:updated",
                helper: "broadcastCharacterUpdate(...)",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/chat.ts",
          code: 'socket.emit("chat:newMessage", payload);',
          errors: [
            {
              messageId: "noDirectEmit",
              data: {
                eventName: "chat:newMessage",
                helper: "broadcastChatMessage(...)",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/map-token.ts",
          code: 'io.to(room)["emit"]("map:tokenUpdated", payload);',
          errors: [
            {
              messageId: "noDirectEmit",
              data: {
                eventName: "map:tokenUpdated",
                helper: "broadcastMapTokenUpdate(...)",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/routers/map-layer.ts",
          code: 'io.to(room).emit("map:layerUpdated", payload);',
          errors: [
            {
              messageId: "noDirectEmit",
              data: {
                eventName: "map:layerUpdated",
                helper: "broadcastMapLayerUpdate(...)",
              },
            },
          ],
        },
        {
          filename: "packages/server/src/services/notification-service.ts",
          code: 'socket.emit("notification:new", payload);',
          errors: [
            {
              messageId: "noDirectEmit",
              data: {
                eventName: "notification:new",
                helper: 'broadcastToUsers(..., "notification:new", ...)',
              },
            },
          ],
        },
      ],
    });
  });
});
