// @ts-check

/**
 * Guard direct writes to Prisma delegates whose update/upsert methods are
 * concurrency-gated in `packages/server/src/utils/prisma-types.ts`.
 *
 * This intentionally mirrors the current restricted-delegate surface instead
 * of banning every Prisma write. See `docs/CONCURRENCY.md` for why ordinary
 * create/delete paths and non-gated tables stay out of scope.
 */

import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";

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

/**
 * @param {import('estree').Node} node
 * @returns {string | undefined}
 */
function gatedDelegatePropertyName(node) {
  const unwrapped = unwrapChain(node);
  if (unwrapped.type !== "MemberExpression") return undefined;

  const name = staticPropertyName(unwrapped.property);
  return name && GATED_DELEGATES.has(name) ? name : undefined;
}

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {WeakMap<import('eslint').Scope.Variable, string>} delegateAliases
 */
function delegateName(node, sourceCode, delegateAliases) {
  const unwrapped = unwrapChain(node);
  if (unwrapped.type === "Identifier") {
    if (GATED_DELEGATES.has(unwrapped.name)) return unwrapped.name;
    const variable = resolveIdentifierBinding(sourceCode, unwrapped);
    return variable === undefined ? undefined : delegateAliases.get(variable);
  }
  return gatedDelegatePropertyName(unwrapped);
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {WeakMap<import('eslint').Scope.Variable, string>} delegateAliases
 */
function directGatedWrite(node, sourceCode, delegateAliases) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;

  const method = staticPropertyName(callee.property);
  if (!method || !GATED_MUTATORS.has(method)) return undefined;

  const delegate = delegateName(callee.object, sourceCode, delegateAliases);
  if (!delegate) return undefined;

  return { delegate, method };
}

/** @param {import('estree').Pattern} pattern */
function identifierFromPattern(pattern) {
  if (pattern.type === "Identifier") return pattern;
  if (pattern.type === "AssignmentPattern" && pattern.left.type === "Identifier") {
    return pattern.left;
  }
  return undefined;
}

/** @param {import('estree').VariableDeclarator} declarator */
function isConstDeclarator(declarator) {
  const declaration = /** @type {import('estree').Node & { kind?: string } | undefined} */ (
    declarator.parent
  );
  return declaration?.type === "VariableDeclaration" && declaration.kind === "const";
}

/**
 * @param {import('estree').ObjectPattern} pattern
 * @param {(identifier: import('estree').Identifier, delegate: string) => void} recordAlias
 */
function recordDestructuredDelegateAliases(pattern, recordAlias) {
  for (const property of pattern.properties) {
    if (property.type !== "Property" || property.computed) continue;
    const delegate = staticPropertyName(property.key);
    if (!delegate || !GATED_DELEGATES.has(delegate)) continue;
    const identifier = identifierFromPattern(property.value);
    if (identifier !== undefined) recordAlias(identifier, delegate);
  }
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
        "Why: ADR-0001 requires direct {{delegate}}.{{method}} writes to use the race-sensitive helper boundary so concurrent writers cannot lose updates. How to fix: {{suggestion}} Try `bun run codemod:concurrency-guard -- <file>` first. See docs/guides/add-race-sensitive-mutation.md.",
    },
    schema: [],
  },

  create(context) {
    if (isMutationHelperPath(context.filename) || isTypeTestPath(context.filename)) {
      return {};
    }

    /** @type {WeakMap<import('eslint').Scope.Variable, string>} */
    const delegateAliases = new WeakMap();

    /**
     * @param {import('estree').Identifier} identifier
     * @param {string} delegate
     */
    function recordDelegateAlias(identifier, delegate) {
      const variable = resolveDeclaredVariable(context.sourceCode.getScope(identifier), identifier);
      if (variable !== undefined) delegateAliases.set(variable, delegate);
    }

    return {
      VariableDeclarator(node) {
        if (!isConstDeclarator(node)) return;

        const directDelegate = node.init ? gatedDelegatePropertyName(node.init) : undefined;
        if (node.id.type === "Identifier" && directDelegate !== undefined) {
          recordDelegateAlias(node.id, directDelegate);
          return;
        }

        if (node.id.type !== "ObjectPattern") return;
        recordDestructuredDelegateAliases(node.id, recordDelegateAlias);
      },

      CallExpression(node) {
        const target = directGatedWrite(node, context.sourceCode, delegateAliases);
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
