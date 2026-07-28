// @ts-check

/**
 * Exported Zod object schemas must declare unknown-key behavior explicitly:
 * either `.strict()` (reject unknown keys — recommended for API inputs) or
 * `.passthrough()` (preserve them — for forward-compat or proxy schemas).
 *
 * Targets `export const NameSchema = z.object(...)...` shapes. Schemas built
 * via `.extend()` on an identifier, unions, discriminated unions, arrays,
 * etc. are out of scope — those inherit behavior from their parent or
 * don't have the strict/passthrough toggle.
 *
 * `z.strictObject(...)` counts as already-strict.
 *
 * If a schema is intentionally permissive (e.g., a generic base reused in
 * multiple places) use `// eslint-disable-next-line local/strict-shared-schemas`.
 */

import { staticPropertyName } from "./ast-helpers.js";

const UNKNOWN_KEY_MODES = new Set(["strict", "passthrough", "strip", "catchall"]);

/** @param {import('estree').Node} node */
function parentOf(node) {
  return /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (node).parent;
}

/**
 * @param {import('estree').CallExpression} node
 * @param {string} name
 */
function isZCall(node, name) {
  return (
    node.callee.type === "MemberExpression" &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "z" &&
    staticPropertyName(node.callee) === name
  );
}

/**
 * Walk down to the inner-most call in a method chain and return it if it is
 * `z.object(...)`. Used by the autofix to know where to insert `.strict()`.
 *
 * @param {import('estree').Node} arg
 * @returns {import('estree').CallExpression | null}
 */
function findZObjectCall(arg) {
  let cur = arg;
  while (cur.type === "CallExpression" && cur.callee.type === "MemberExpression") {
    if (cur.callee.object.type !== "CallExpression") break;
    cur = cur.callee.object;
  }
  if (cur.type === "CallExpression" && isZCall(cur, "object")) {
    return cur;
  }
  return null;
}

/**
 * Returns the outermost unknown-key mode call in the chain, since later
 * (outer) calls override earlier ones — `.strict().strip()` resolves to
 * "strip", not "strict".
 *
 * @param {import('estree').Node} arg
 */
function analyzeChain(arg) {
  /** @type {"strict" | "passthrough" | "strip" | "catchall" | null} */
  let outermostMode = null;
  let cur = arg;
  while (cur.type === "CallExpression" && cur.callee.type === "MemberExpression") {
    const name = staticPropertyName(cur.callee);
    if (name !== undefined) {
      if (outermostMode === null && UNKNOWN_KEY_MODES.has(name)) {
        outermostMode = name;
      }
    }
    if (cur.callee.object.type !== "CallExpression") break;
    cur = cur.callee.object;
  }
  /** @param {string} name */
  const rootIsZCall = (name) => cur.type === "CallExpression" && isZCall(cur, name);
  return {
    rootIsZObject: rootIsZCall("object"),
    rootIsStrictObject: rootIsZCall("strictObject"),
    outermostMode,
  };
}

/** @param {import('estree').VariableDeclarator} declarator */
function isModuleScopeConstDeclarator(declarator) {
  const declaration = parentOf(declarator);
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") return false;
  const declarationParent = parentOf(declaration);
  if (declarationParent?.type === "Program") return true;
  return (
    declarationParent?.type === "ExportNamedDeclaration" &&
    parentOf(declarationParent)?.type === "Program"
  );
}

/**
 * @param {import('estree').ImportDeclaration} node
 * @returns {import('estree').Identifier[]}
 */
function zodAliasSpecifiers(node) {
  if (node.source.value !== "zod") return [];
  const aliases = [];
  for (const specifier of node.specifiers) {
    if (
      specifier.type === "ImportDefaultSpecifier" ||
      specifier.type === "ImportNamespaceSpecifier"
    ) {
      aliases.push(specifier.local);
      continue;
    }
    if (specifier.type !== "ImportSpecifier") continue;
    if (specifier.imported.type !== "Identifier" || specifier.imported.name !== "z") continue;
    if (specifier.local.name !== "z") aliases.push(specifier.local);
  }
  return aliases;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Exported z.object schemas must call .strict() or .passthrough() to be explicit about unknown keys",
      principle:
        "Exported z.object schemas must declare unknown-key behavior explicitly ('.strict()' or '.passthrough()') for clear API contracts.",
      category: "architecture-fitness",
      pairedGuide: "docs/guides/add-trpc-procedure.md",
      repairKind: "autofix",
    },
    messages: {
      needsExplicit:
        "Why: Exported `*InputSchema` z.objects without an explicit unknown-key mode silently accept extra keys across the client/server contract. How to fix: Add `.strict()`, or `.passthrough()` only for intentional extra keys. See docs/guides/add-trpc-procedure.md.",
      zodAlias:
        'Why: Aliasing Zod\'s runtime import disables sibling shared-schema rules that match the literal `z` identifier, so the file can silently skip schema/input coverage. How to fix: Use `import { z } from "zod"` without aliasing.',
    },
    schema: [],
  },

  create(context) {
    /** @param {import('estree').VariableDeclarator} declarator */
    function checkDeclarator(declarator) {
      if (!declarator.init) return;
      // Only fire on schemas named *InputSchema — those are the unambiguous
      // tRPC inputs. Output/result schemas (back .output(...)) need to stay
      // permissive so Prisma's extra fields get stripped, not rejected.
      if (declarator.id.type !== "Identifier") return;
      if (!declarator.id.name.endsWith("InputSchema")) return;
      const { rootIsZObject, rootIsStrictObject, outermostMode } = analyzeChain(declarator.init);
      if (rootIsStrictObject) return;
      if (!rootIsZObject) return;
      if (outermostMode === "strict" || outermostMode === "passthrough") return;
      const zObjectCall = findZObjectCall(declarator.init);
      context.report({
        node: declarator.init,
        messageId: "needsExplicit",
        // Only autofix when no mode is set at all. If the chain already ends in
        // .strip() or .catchall(), inserting .strict() up-chain wouldn't change
        // the resolved behavior — the trailing call still wins. Author intent
        // is ambiguous, so leave it for a human.
        fix(fixer) {
          if (!zObjectCall) return null;
          if (outermostMode !== null) return null;
          return fixer.insertTextAfter(zObjectCall, ".strict()");
        },
      });
    }

    return {
      ImportDeclaration(node) {
        for (const alias of zodAliasSpecifiers(node)) {
          context.report({ node: alias, messageId: "zodAlias" });
        }
      },

      VariableDeclarator(node) {
        if (!isModuleScopeConstDeclarator(node)) return;
        checkDeclarator(node);
      },
    };
  },
};
