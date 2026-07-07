// @ts-check
import { describe, it } from "vitest";

import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";
import { makeRuleTester } from "./rule-tester.js";

const ruleTester = makeRuleTester();

/** @param {import('estree').Pattern} pattern */
function identifiersInPattern(pattern) {
  if (pattern.type === "Identifier") return [pattern];
  if (pattern.type === "AssignmentPattern") return identifiersInPattern(pattern.left);
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.flatMap((property) =>
      property.type === "Property" ? identifiersInPattern(property.value) : [],
    );
  }
  if (pattern.type === "ArrayPattern") {
    return pattern.elements.flatMap((element) =>
      element === null ? [] : identifiersInPattern(element),
    );
  }
  return [];
}

/**
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Identifier} identifier
 */
function nearestVariableNamed(sourceCode, identifier) {
  for (let scope = sourceCode.getScope(identifier); scope !== null; scope = scope.upper) {
    const variable = scope.variables.find((candidate) => candidate.name === identifier.name);
    if (variable !== undefined) return variable;
  }
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
const probeRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Probe binding-resolution helpers in tests",
      principle: "Test-only probe rule.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    },
    messages: {
      declared: "declared binding resolved",
      nearest: "nearest binding resolved",
      upper: "upper binding resolved",
    },
    schema: [],
  },

  create(context) {
    /** @param {import('estree').Identifier} identifier */
    function reportDeclared(identifier) {
      const variable = resolveDeclaredVariable(context.sourceCode.getScope(identifier), identifier);
      if (variable?.identifiers.includes(identifier) === true) {
        context.report({ node: identifier, messageId: "declared" });
      }
    }

    /** @param {import('estree').Identifier} identifier */
    function reportNearest(identifier) {
      const variable = resolveIdentifierBinding(context.sourceCode, identifier);
      if (
        variable !== undefined &&
        variable === nearestVariableNamed(context.sourceCode, identifier)
      ) {
        context.report({ node: identifier, messageId: "nearest" });
      }
    }

    /** @param {import('estree').Identifier} identifier */
    function reportUpper(identifier) {
      const variable = resolveIdentifierBinding(context.sourceCode, identifier);
      if (variable !== undefined && variable.scope !== context.sourceCode.getScope(identifier)) {
        context.report({ node: identifier, messageId: "upper" });
      }
    }

    return {
      VariableDeclarator(node) {
        for (const identifier of identifiersInPattern(node.id)) {
          if (identifier.name.startsWith("declared")) reportDeclared(identifier);
        }
      },

      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        const argument = node.arguments[0];
        if (argument?.type !== "Identifier") return;
        if (node.callee.name === "expectNearest") reportNearest(argument);
        if (node.callee.name === "expectUpper") reportUpper(argument);
      },
    };
  },
};

describe("binding-resolution", () => {
  it("resolves declarations, shadowed references, upper scopes, and destructuring", () => {
    ruleTester.run("binding-resolution-probe", probeRule, {
      valid: [],
      invalid: [
        {
          code: "const declaredValue = source;",
          errors: [{ messageId: "declared" }],
        },
        {
          code: [
            "const item = 'outer';",
            "{",
            "  const item = 'inner';",
            "  expectNearest(item);",
            "}",
          ].join("\n"),
          errors: [{ messageId: "nearest" }],
        },
        {
          code: [
            "const target = 'outer';",
            "function outer() {",
            "  function inner() {",
            "    expectUpper(target);",
            "  }",
            "}",
          ].join("\n"),
          errors: [{ messageId: "upper" }],
        },
        {
          code: [
            "const { value: declaredDestructured } = source;",
            "function reader() {",
            "  expectUpper(declaredDestructured);",
            "}",
          ].join("\n"),
          errors: [{ messageId: "declared" }, { messageId: "upper" }],
        },
      ],
    });
  });
});
