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

/**
 * Every declaration in `broadcast-registry.ts` that holds a delivery-policy
 * registry object literal. The registry is split by delivery policy (room vs.
 * user-targeted), and `chat:newMessage` is deliberately registered in both, so
 * the inventory is the deduplicated union of their keys.
 *
 * Adding a third delivery policy means adding its declaration name here. The
 * scanner discovers every `*_BROADCAST_REGISTRY` declaration independently,
 * so the `finds every declared registry` test makes forgetting to update this
 * list a failure rather than a silently shrinking inventory.
 */
const REGISTRY_DECLARATION_NAMES = ["ROOM_BROADCAST_REGISTRY", "USER_TARGETED_BROADCAST_REGISTRY"];
const REGISTRY_DECLARATION_PATTERN = /_BROADCAST_REGISTRY$/u;

/**
 * Scans the registry source for every conventionally named declaration and
 * returns the keys each one contributed. Returning per-declaration results
 * (rather than a flat name list) is what lets the callers below distinguish
 * "this registry is empty" from "this registry was renamed and the scanner
 * found nothing" — a scanner that can only report an empty list can never fail
 * loudly when the source it scans changes shape.
 */
function scanRegistryDeclarations() {
  const registryPath = join(repoRoot, "packages/server/src/socket/broadcast-registry.ts");
  const sourceText = readFileSync(registryPath, "utf8");
  const sourceFile = ts.createSourceFile(registryPath, sourceText, ts.ScriptTarget.Latest, true);
  /** @type {Map<string, string[]>} */
  const found = new Map();

  ts.forEachChild(sourceFile, function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      REGISTRY_DECLARATION_PATTERN.test(node.name.text) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found.set(node.name.text, collectObjectKeys(node.initializer));
      return;
    }
    ts.forEachChild(node, visit);
  });

  return found;
}

function registryEventNames() {
  const found = scanRegistryDeclarations();
  const names = new Set();

  for (const keys of found.values()) {
    for (const key of keys) names.add(key);
  }

  return [...names].sort();
}

describe("socket-registry-broadcasts", () => {
  it("names the registry architecture decision", () => {
    expect(rule.meta.messages.noDirectEmit).toContain("ADR-0003");
  });

  // The inventory comparison below only detects drift while the scanner still
  // resolves the registry declarations. When S4 split `BROADCAST_REGISTRY` into
  // two policy-keyed registries the scanner silently found nothing, so this
  // asserts the scan itself before anything is compared against its output.
  it("finds every declared registry", () => {
    const found = scanRegistryDeclarations();

    expect([...found.keys()].sort()).toEqual([...REGISTRY_DECLARATION_NAMES].sort());
    for (const [name, keys] of found) {
      expect(keys, `${name} contributed no event keys`).not.toHaveLength(0);
    }
  });

  it("tracks every broadcast registry event", () => {
    const ruleEvents = REGISTRY_OWNED_EVENT_HELPERS.map(([eventName]) => eventName).sort();
    const registryEvents = registryEventNames();

    expect(registryEvents).not.toHaveLength(0);
    expect(ruleEvents).toEqual(registryEvents);
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
