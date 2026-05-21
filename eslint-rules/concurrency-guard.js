// @ts-check

/**
 * Guard direct writes to Prisma delegates whose update/upsert methods are
 * concurrency-gated in `packages/server/src/utils/prisma-types.ts`.
 *
 * This intentionally mirrors the current restricted-delegate surface instead
 * of banning every Prisma write. See `docs/CONCURRENCY.md` for why ordinary
 * create/delete paths and non-gated tables stay out of scope.
 */

const GATED_DELEGATES = new Set([
  "characterStats",
  "encounterParticipant",
  "encounter",
  "characterSpellSlot",
  "characterClass",
]);

const GATED_MUTATORS = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);

const DIRECT_WRITE_SUGGESTIONS = new Map([
  [
    "characterStats",
    "Use updateCharacterStatsLocked/updateCharacterStatsLockedWithExpectedVersion from utils/character-stats-mutations.ts.",
  ],
  [
    "encounterParticipant",
    "Use updateParticipantStatsLocked/updateParticipantStatsLockedWithExpectedVersion, or blindUpdateParticipant for documented metadata.",
  ],
  ["encounter", "Use the encounter-state helpers in utils/encounter-state-mutations.ts."],
  [
    "characterSpellSlot",
    "Use consumeSpellSlot/recoverSpellSlot or the documented spell-slot sync helpers.",
  ],
  [
    "characterClass",
    "Use spendHitDice/advanceClassLevel/setSubclass or the documented rest helpers.",
  ],
]);

/** @param {string} filename */
function normalizedFilename(filename) {
  return filename.replaceAll("\\", "/");
}

/** @param {string} filename */
function isMutationHelperPath(filename) {
  const normalized = normalizedFilename(filename);
  return /(?:^|\/)packages\/server\/src\/utils\/[^/]+-mutations\.ts$/u.test(normalized);
}

/** @param {string} filename */
function isTypeTestPath(filename) {
  return /(?:^|\/)packages\/server\/src\/utils\/__type-tests__\//u.test(
    normalizedFilename(filename),
  );
}

/** @param {import('estree').PrivateIdentifier | import('estree').Expression} property */
function staticPropertyName(property) {
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  return undefined;
}

/** @param {import('estree').Node} node */
function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

/** @param {import('estree').Node} node */
function delegateName(node) {
  const unwrapped = unwrapChain(node);
  if (unwrapped.type === "Identifier") {
    return GATED_DELEGATES.has(unwrapped.name) ? unwrapped.name : undefined;
  }
  if (unwrapped.type !== "MemberExpression") return undefined;

  const name = staticPropertyName(unwrapped.property);
  return name && GATED_DELEGATES.has(name) ? name : undefined;
}

/** @param {import('estree').CallExpression} node */
function directGatedWrite(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;

  const method = staticPropertyName(callee.property);
  if (!method || !GATED_MUTATORS.has(method)) return undefined;

  const delegate = delegateName(callee.object);
  if (!delegate) return undefined;

  return { delegate, method };
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow direct Prisma update/upsert calls on concurrency-gated delegates",
      principle:
        "Direct writes to Prisma's concurrency-gated delegates must use documented helper boundaries to prevent lost-update races.",
      category: "behavior",
      pairedGuide: "docs/guides/add-race-sensitive-mutation.md",
      repairKind: "codemod",
      repairCommand: "bun run codemod:concurrency-guard",
    },
    messages: {
      noDirectWrite:
        "Why: Direct {{delegate}}.{{method}} bypasses the documented concurrency helper boundary. How to fix: {{suggestion}} Try `bun run codemod:concurrency-guard -- <file>` first (name-based only; aliases and destructured delegates still need a manual fix). See docs/CONCURRENCY.md.",
    },
    schema: [],
  },

  create(context) {
    if (isMutationHelperPath(context.filename) || isTypeTestPath(context.filename)) {
      return {};
    }

    return {
      CallExpression(node) {
        const target = directGatedWrite(node);
        if (!target) return;

        context.report({
          node: node.callee,
          messageId: "noDirectWrite",
          data: {
            delegate: target.delegate,
            method: target.method,
            suggestion: DIRECT_WRITE_SUGGESTIONS.get(target.delegate) ?? "Use a documented helper.",
          },
        });
      },
    };
  },
};
