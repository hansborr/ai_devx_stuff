// @ts-check

import { builtinModules } from "node:module";

import { resolveIdentifierBinding } from "./binding-resolution.js";

const bareNodeBuiltinSpecifiers = new Set(
  builtinModules.filter((specifier) => !specifier.startsWith("node:")),
);
const nodeAmbientGlobalNames = new Set(["process", "Buffer", "__dirname", "__filename", "NodeJS"]);

/** @param {unknown} value */
function isNodeBuiltinSpecifier(value) {
  return (
    typeof value === "string" && (value.startsWith("node:") || bareNodeBuiltinSpecifiers.has(value))
  );
}

/** @param {import('estree').Expression | import('estree').SpreadElement} node */
function staticSpecifierValue(node) {
  if (node.type === "Literal") return node.value;
  if (node.type !== "TemplateLiteral" || node.expressions.length !== 0) return undefined;
  return node.quasis.length === 1 ? node.quasis[0]?.value.cooked : undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Node module and ambient-global references in runtime-neutral code",
      principle:
        "Shared production modules must remain portable across browser and server consumers regardless of module-reference syntax or ambient-global type/value position.",
      category: "behavior",
      pairedGuide: "docs/adr/0006-shared-package-layering.md",
      repairKind: "manual",
    },
    schema: [],
    messages: {
      nodeBuiltinReference:
        "Why: ADR-0006 keeps packages/shared portable across browser and server consumers, so Node builtins are unavailable to production shared code. How to fix: Move Node-specific work to packages/server and pass the resolved value into shared code. See docs/adr/0006-shared-package-layering.md.",
      nodeGlobalReference:
        "Why: ADR-0006 keeps packages/shared portable across browser and server consumers, so Node ambient globals are unavailable to production shared code. How to fix: Move Node-specific work to packages/server and pass a runtime-neutral contract into shared code. See docs/adr/0006-shared-package-layering.md.",
    },
  },
  create(context) {
    /** @param {import('eslint').Rule.Node} node @param {unknown} value */
    function reportIfNodeBuiltin(node, value) {
      if (isNodeBuiltinSpecifier(value)) {
        context.report({ node, messageId: "nodeBuiltinReference" });
      }
    }

    /**
     * Report an actual identifier reference only when it resolves to an
     * ambient global (or remains unresolved). Scope resolution, rather than an
     * AST-position census, covers value expressions, direct and qualified
     * types, type queries, heritage clauses, and future TypeScript spellings
     * while allowing innocent local declarations and shadowing.
     *
     * @param {import('estree').Identifier} node
     */
    function reportIfNodeAmbientGlobal(node) {
      if (!nodeAmbientGlobalNames.has(node.name)) return;

      let reference;
      for (let scope = context.sourceCode.getScope(node); scope !== null; scope = scope.upper) {
        reference = scope.references.find((candidate) => candidate.identifier === node);
        if (reference !== undefined) break;
      }
      if (reference === undefined) return;
      if (reference.resolved !== null && reference.resolved?.defs.length > 0) return;

      context.report({ node, messageId: "nodeGlobalReference" });
    }

    return {
      Identifier: reportIfNodeAmbientGlobal,
      ImportExpression(node) {
        reportIfNodeBuiltin(node, staticSpecifierValue(node.source));
      },
      "TSImportType > Literal.source"(node) {
        reportIfNodeBuiltin(node, node.value);
      },
      "TSExternalModuleReference > Literal.expression"(node) {
        reportIfNodeBuiltin(node, node.value);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "require") return;
        const binding = resolveIdentifierBinding(context.sourceCode, node.callee);
        if (binding !== undefined && binding.defs.length > 0) return;
        const firstArgument = node.arguments[0];
        if (firstArgument === undefined) return;
        reportIfNodeBuiltin(node, staticSpecifierValue(firstArgument));
      },
    };
  },
};
