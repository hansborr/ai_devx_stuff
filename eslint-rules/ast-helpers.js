// @ts-check

/** @param {import('estree').ImportSpecifier} specifier */
export function importSpecifierName(specifier) {
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

/** @param {import('estree').MemberExpression} member */
export function staticPropertyName(member) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (
    member.computed &&
    member.property.type === "Literal" &&
    typeof member.property.value === "string"
  ) {
    return member.property.value;
  }
  return undefined;
}

/**
 * Static name of an object-literal or object-pattern key.
 *
 * `Property` nodes carry `key` rather than `property`, and — unlike a member
 * access — a *non-computed* key may legitimately be a string literal
 * (`{ "post": value }`), so this cannot be expressed in terms of
 * `staticPropertyName`. A computed key is never a static name.
 *
 * @param {import('estree').Property | import('estree').AssignmentProperty} property
 */
export function staticKeyName(property) {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return undefined;
}

/** @param {import('estree').Node} node */
export function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

/**
 * Type-only and grouping wrappers that do not change the value an expression
 * denotes. `satisfies` in particular is the house style for Prisma payloads
 * (AGENTS.md pushes authors to it over `as`), so a checker that inspects
 * payload shape must see through it or the idiomatic spelling silently opts
 * out.
 */
const TRANSPARENT_EXPRESSIONS = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSInstantiationExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
]);

/**
 * @param {import('estree').Node} node
 * @returns {import('estree').Node}
 */
export function unwrapTransparent(node) {
  let current = node;
  while (TRANSPARENT_EXPRESSIONS.has(current.type)) {
    const inner = /** @type {{ expression?: import('estree').Node }} */ (current).expression;
    if (inner === undefined) break;
    current = inner;
  }
  return current;
}
