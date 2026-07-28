// @ts-check

import { staticKeyName, staticPropertyName, unwrapChain } from "./ast-helpers.js";

const ARBITRARY_VALUE_RE = /^!?-?(?<utility>[a-z][\w/-]*)-\[[^\]]+\](?:\/\S+)?!?$/iu;
const CLASS_ATTRIBUTE_NAMES = new Set(["class", "className"]);
const CLASS_COMPOSITION_CALLEES = new Set(["clsx", "cn", "cva", "twMerge", "tv"]);

const SIZE_UTILITY_SUGGESTIONS = new Map([
  ["w", "the closest width scale step, such as `w-96`"],
  ["min-w", "the closest min-width scale step, such as `min-w-0`"],
  ["max-w", "the closest max-width scale step, such as `max-w-lg`"],
  ["h", "the closest height scale step, such as `h-96`"],
  ["min-h", "the closest min-height scale step, such as `min-h-96`"],
  ["max-h", "the closest max-height scale step, such as `max-h-screen`"],
  ["size", "the closest size scale step, such as `size-4`"],
]);

const UTILITY_SUGGESTIONS = new Map([
  ["bg", "an @theme color class, such as `bg-primary` or `bg-surface`"],
  ["border", "an @theme border color class, such as `border-border`"],
  ["grid-cols", "a standard grid template utility or named layout token"],
  ["rounded", "the radius token utility, such as `rounded`"],
  ["shadow", "a named shadow or elevation token"],
  ["text", "`text-xs` or another text scale step"],
  ...SIZE_UTILITY_SUGGESTIONS,
]);

/**
 * @param {string} token
 */
function utilitySegment(token) {
  let depth = 0;
  let segmentStart = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[") depth += 1;
    else if (char === "]") depth = Math.max(0, depth - 1);
    else if (char === ":" && depth === 0) segmentStart = index + 1;
  }
  return token.slice(segmentStart);
}

/**
 * @param {string} utility
 */
function suggestionForUtility(utility) {
  return (
    UTILITY_SUGGESTIONS.get(utility) ?? "the closest Tailwind scale step or a named @theme token"
  );
}

/**
 * @param {string} token
 */
function arbitraryValueFindingForToken(token) {
  const segment = utilitySegment(token);
  if (segment.startsWith("[")) return undefined;

  const match = ARBITRARY_VALUE_RE.exec(segment);
  if (!match?.groups) return undefined;

  return {
    suggestion: suggestionForUtility(match.groups.utility),
    token,
  };
}

/**
 * @param {string} text
 */
function arbitraryValueFindings(text) {
  return text
    .split(/\s+/u)
    .filter(Boolean)
    .map(arbitraryValueFindingForToken)
    .filter((finding) => finding !== undefined);
}

/**
 * @param {import('estree').TemplateLiteral} node
 */
function templateLiteralText(node) {
  return node.quasis
    .map((quasi, index) => {
      const text = quasi.value.cooked ?? quasi.value.raw;
      return index < node.expressions.length ? `${text} ` : text;
    })
    .join("");
}

/** @param {import('estree').Node} node */
function parentOf(node) {
  return /** @type {import('estree').Node & { parent?: import('estree').Node }} */ (node).parent;
}

/** @param {import('estree').Node} node */
function isFunctionBoundary(node) {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

/** @param {import('estree').Node} node */
function isClassJsxAttribute(node) {
  return (
    node.type === "JSXAttribute" &&
    node.name.type === "JSXIdentifier" &&
    CLASS_ATTRIBUTE_NAMES.has(node.name.name)
  );
}

/**
 * @param {import('estree').Node} parent
 * @param {import('estree').Node} child
 */
function isClassNamePropertyValue(parent, child) {
  return (
    parent.type === "Property" && parent.value === child && staticKeyName(parent) === "className"
  );
}

/** @param {import('estree').CallExpression} node */
function classCompositionCalleeName(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type === "Identifier") return callee.name;
  if (callee.type !== "MemberExpression") return undefined;
  return staticPropertyName(callee);
}

/**
 * @param {import('estree').CallExpression} parent
 * @param {import('estree').Node} child
 */
function isClassCompositionArgument(parent, child) {
  const calleeName = classCompositionCalleeName(parent);
  return (
    calleeName !== undefined &&
    CLASS_COMPOSITION_CALLEES.has(calleeName) &&
    parent.arguments.includes(child)
  );
}

/**
 * Walk the literal's own AST ancestry looking for a class context. Stops at the
 * nearest function boundary so a string nested inside an unrelated callback is
 * not mistaken for a class string.
 *
 * @param {import('estree').Node} node
 */
function isDirectClassStringContext(node) {
  let child = node;
  let parent = parentOf(child);

  while (parent) {
    if (isClassJsxAttribute(parent)) return true;
    if (isClassNamePropertyValue(parent, child)) return true;
    if (parent.type === "CallExpression" && isClassCompositionArgument(parent, child)) return true;
    if (isFunctionBoundary(parent)) return false;

    child = parent;
    parent = parentOf(child);
  }

  return false;
}

/**
 * When a string literal is the initializer of a `const`/`let` declarator, the
 * declared variable is the unit that carries the class string. Return that
 * variable's identifier node so its references can be inspected, or undefined
 * when the literal is not a simple single-name variable initializer.
 *
 * @param {import('estree').Node} node
 * @returns {(import('estree').Identifier) | undefined}
 */
function declaratorIdentifierForInitializer(node) {
  const declarator = parentOf(node);
  if (declarator?.type !== "VariableDeclarator" || declarator.init !== node) return undefined;
  const declaration = parentOf(declarator);
  if (declaration?.type !== "VariableDeclaration") return undefined;
  if (declaration.kind !== "const" && declaration.kind !== "let") return undefined;
  if (declarator.id.type !== "Identifier") return undefined;
  return declarator.id;
}

/**
 * A reference is in a class context when the referencing identifier (or a
 * binary `+` concatenation built from it) flows into a className/class
 * attribute, a className property, or a class-composition call argument. Reuse
 * the same ancestry walk used for direct literals, but treat the chain of
 * enclosing `+` concatenations as transparent so `base + " extra"` passed to
 * `cn()` still counts.
 *
 * @param {import('estree').Identifier} identifier
 */
function isReferenceInClassContext(identifier) {
  /** @type {import('estree').Node} */
  let current = identifier;
  let parent = parentOf(current);

  // Climb through any chain of string concatenations so the identifier's
  // effective value is still treated as the class string carrier.
  while (parent?.type === "BinaryExpression" && parent.operator === "+") {
    current = parent;
    parent = parentOf(current);
  }

  return isDirectClassStringContext(current);
}

/**
 * Resolve the scope `Variable` that the given declarator identifier defines by
 * searching the identifier's scope and its ancestors. Scope analysis records a
 * variable in the scope where it is declared, which for a module-level
 * `const`/`let` is an ancestor of the scope `getScope` returns for the
 * identifier node.
 *
 * @param {import('eslint').Scope.Scope | null} scope
 * @param {import('estree').Identifier} identifier
 * @returns {import('eslint').Scope.Variable | undefined}
 */
function resolveDeclaredVariable(scope, identifier) {
  for (let current = scope; current !== null; current = current.upper) {
    const variable = current.variables.find((candidate) =>
      candidate.identifiers.includes(identifier),
    );
    if (variable !== undefined) return variable;
  }
  return undefined;
}

/**
 * @param {import('estree').Node} node
 * @param {import('eslint').Rule.RuleContext} context
 */
function isClassStringContext(node, context) {
  if (isDirectClassStringContext(node)) return true;

  const identifier = declaratorIdentifierForInitializer(node);
  if (identifier === undefined) return false;

  const variable = resolveDeclaredVariable(context.sourceCode.getScope(identifier), identifier);
  if (variable === undefined) return false;

  return variable.references.some((reference) => isReferenceInClassContext(reference.identifier));
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow arbitrary Tailwind bracket values in client class strings",
      principle:
        "Client styling should reuse DESIGN.md and packages/client/src/app.css @theme tokens instead of introducing one-off Tailwind bracket values.",
      category: "maintainability",
      pairedGuide: "DESIGN.md",
      repairKind: "manual",
    },
    messages: {
      noArbitraryValue:
        "Why: Arbitrary Tailwind value `{{token}}` bypasses Musi's @theme tokens in packages/client/src/app.css. How to fix: Replace it with {{suggestion}} or add a named @theme token before using a custom value.",
    },
    schema: [],
  },

  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {string} text
     */
    function reportFindings(node, text) {
      for (const finding of arbitraryValueFindings(text)) {
        context.report({
          node,
          messageId: "noArbitraryValue",
          data: finding,
        });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string" && isClassStringContext(node, context)) {
          reportFindings(node, node.value);
        }
      },

      TemplateLiteral(node) {
        if (isClassStringContext(node, context)) reportFindings(node, templateLiteralText(node));
      },
    };
  },
};
