// @ts-check

/**
 * Registry-owned server-to-client socket events must be emitted through
 * `broadcast-registry.ts` helpers so payload validation and broadcast logging
 * stay centralized.
 */

const BROADCAST_REGISTRY_FILE = "packages/server/src/socket/broadcast-registry.ts";

export const REGISTRY_OWNED_EVENT_HELPERS = [
  ["campaign:updated", "broadcastCampaignUpdate(...)"],
  ["character:updated", "broadcastCharacterUpdate(...)"],
  ["chat:newMessage", "broadcastChatMessage(...)"],
  ["encounter:updated", "broadcastEncounterUpdate(...)"],
  ["map:layerUpdated", "broadcastMapLayerUpdate(...)"],
  ["map:tokenUpdated", "broadcastMapTokenUpdate(...)"],
  ["notification:new", 'broadcastToUsers(..., "notification:new", ...)'],
];

const REGISTRY_OWNED_EVENTS = new Map(REGISTRY_OWNED_EVENT_HELPERS);

/** @param {string} filename */
function isBroadcastRegistryFile(filename) {
  return filename.replaceAll("\\", "/").endsWith(BROADCAST_REGISTRY_FILE);
}

/** @param {import('estree').MemberExpression} callee */
function isEmitMember(callee) {
  if (callee.computed) {
    return callee.property.type === "Literal" && callee.property.value === "emit";
  }
  return callee.property.type === "Identifier" && callee.property.name === "emit";
}

/** @param {import('estree').Node | import('estree').SpreadElement | undefined} node */
function getStringLiteralValue(node) {
  if (!node || node.type !== "Literal" || typeof node.value !== "string") {
    return undefined;
  }
  return node.value;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require registry-owned socket events to use broadcast helpers instead of direct emit calls",
      principle:
        "Registry-owned server-to-client socket events must be emitted through broadcast helpers to keep payload validation and logging centralized.",
      category: "behavior",
      pairedGuide: "docs/guides/add-socket-broadcast.md",
      repairKind: "manual",
    },
    messages: {
      noDirectEmit:
        'Use {{helper}} instead of emitting "{{eventName}}" directly. Registry-owned socket events are payload-validated and logged in broadcast-registry.ts.',
    },
    schema: [],
  },

  create(context) {
    if (isBroadcastRegistryFile(context.filename)) {
      return {};
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || !isEmitMember(node.callee)) {
          return;
        }

        const eventName = getStringLiteralValue(node.arguments[0]);
        if (!eventName) return;

        const helper = REGISTRY_OWNED_EVENTS.get(eventName);
        if (!helper) return;

        context.report({
          node: node.arguments[0],
          messageId: "noDirectEmit",
          data: { eventName, helper },
        });
      },
    };
  },
};
