// @ts-check

/**
 * Require tRPC router procedures to declare `.output(...)` before `.query(...)`
 * or `.mutation(...)`. The app-router output coverage test enforces this at
 * runtime; this lint rule gives the editor a line-local repair message.
 */

const RESOLVER_METHODS = new Set(["query", "mutation"]);

/** @param {import('estree').Node} node */
function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

/** @param {import('estree').PrivateIdentifier | import('estree').Expression} property */
function propertyName(property) {
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  return undefined;
}

/** @param {string} name */
function isProcedureRootName(name) {
  return name === "publicProcedure" || name === "protectedProcedure" || name.endsWith("Procedure");
}

/** @param {import('estree').Node} node */
function analyzeProcedureChain(node) {
  let current = unwrapChain(node);
  let hasOutput = false;

  while (true) {
    if (current.type === "Identifier") {
      return { hasOutput, isProcedure: isProcedureRootName(current.name) };
    }

    if (current.type === "CallExpression") {
      const callee = unwrapChain(current.callee);
      if (callee.type !== "MemberExpression") return { hasOutput, isProcedure: false };

      if (propertyName(callee.property) === "output") hasOutput = true;
      current = unwrapChain(callee.object);
      continue;
    }

    if (current.type === "MemberExpression") {
      if (propertyName(current.property) === "output") hasOutput = true;
      current = unwrapChain(current.object);
      continue;
    }

    return { hasOutput, isProcedure: false };
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require tRPC router procedures to declare output schemas",
      principle:
        "Every tRPC router query and mutation must validate its response with a shared output schema.",
      category: "architecture-fitness",
      pairedGuide: "docs/guides/add-trpc-procedure.md",
      repairKind: "manual",
    },
    messages: {
      missingOutput:
        "Add `.output(<sharedSchema>)` before `.{{method}}(...)`. Every router query and mutation must validate its response with a shared output schema.",
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = unwrapChain(node.callee);
        if (callee.type !== "MemberExpression") return;

        const method = propertyName(callee.property);
        if (!method || !RESOLVER_METHODS.has(method)) return;

        const chain = analyzeProcedureChain(callee.object);
        if (!chain.isProcedure || chain.hasOutput) return;

        context.report({
          node: callee.property,
          messageId: "missingOutput",
          data: { method },
        });
      },
    };
  },
};
