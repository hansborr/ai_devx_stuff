// @ts-check

import { resolveIdentifierBinding } from "./binding-resolution.js";

/**
 * ESLint uses `null` for `Program.parent`; normalize the root boundary so
 * ancestry walkers have one terminal value.
 *
 * @param {import('estree').Node} node
 * @returns {import('estree').Node | undefined}
 */
export function parentOf(node) {
  const parent = /** @type {import('estree').Node | null | undefined} */ (node.parent);
  return parent ?? undefined;
}

/**
 * @param {import('estree').Node | import('estree').SpreadElement | null | undefined} node
 * @returns {node is import('estree').BaseFunction}
 */
export function isFunctionNode(node) {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression"
  );
}

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

/**
 * Whether a declarator belongs to a `const` declaration. The `kind` lives on
 * the parent `VariableDeclaration`, not the declarator.
 *
 * @param {import('estree').VariableDeclarator} declarator
 */
export function isConstDeclarator(declarator) {
  const declaration = /** @type {import('estree').Node & { kind?: string } | undefined} */ (
    declarator.parent
  );
  return declaration?.type === "VariableDeclaration" && declaration.kind === "const";
}

/** @param {import('estree').VariableDeclarator} declarator @param {{ has(value: string): boolean }} known */
function knownInitializerProperty(declarator, known) {
  if (declarator.init === null) return undefined;
  const initializer = unwrapTransparent(declarator.init);
  if (initializer.type !== "MemberExpression") return undefined;
  const name = staticPropertyName(initializer);
  return name !== undefined && known.has(name) ? name : undefined;
}

/**
 * @param {import('estree').VariableDeclarator} declarator
 * @param {import('estree').Identifier} declaredIdentifier
 * @param {{ has(value: string): boolean }} known
 */
function knownDestructuredProperty(declarator, declaredIdentifier, known) {
  /** @type {import('estree').Node} */
  let current = declaredIdentifier;
  while (current !== declarator.id) {
    const parent = current.parent;
    if (parent === undefined || parent.type === "ArrayPattern") return undefined;
    if (parent.type === "Property") {
      const name = staticKeyName(parent);
      return name !== undefined && known.has(name) ? name : undefined;
    }
    current = parent;
  }
  return undefined;
}

/**
 * Resolve the known property named by a one-hop `const` binding. Scope-based
 * resolution is traversal-order independent and covers transparent
 * initializers plus nested, quoted, and for-of object destructuring. Array
 * destructuring is ignored because it encodes no property name.
 *
 * @param {import('estree').Identifier} identifier
 * @param {import('eslint').SourceCode} sourceCode
 * @param {{ has(value: string): boolean }} known
 */
export function resolvedConstPropertyName(identifier, sourceCode, known) {
  const variable = resolveIdentifierBinding(sourceCode, identifier);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "Variable") return undefined;
  const declarator = definition.node;
  if (!isConstDeclarator(declarator)) return undefined;
  if (declarator.id.type === "Identifier") return knownInitializerProperty(declarator, known);

  const [declaredIdentifier] = variable.identifiers;
  return declaredIdentifier === undefined
    ? undefined
    : knownDestructuredProperty(declarator, declaredIdentifier, known);
}

/**
 * The identifier a destructuring pattern element binds, if it binds one
 * directly (`{ a }`, `{ a: b }`, `{ a = fallback }`).
 *
 * @param {import('estree').Pattern} pattern
 */
function identifierFromPattern(pattern) {
  if (pattern.type === "Identifier") return pattern;
  if (pattern.type === "AssignmentPattern" && pattern.left.type === "Identifier") {
    return pattern.left;
  }
  return undefined;
}

/**
 * Record object-pattern bindings whose keys belong to a known property set.
 *
 * @param {import('estree').ObjectPattern} pattern
 * @param {{ has(value: string): boolean }} known
 * @param {(identifier: import('estree').Identifier, name: string) => void} recordAlias
 */
export function recordKnownDestructuredAliases(pattern, known, recordAlias) {
  for (const property of pattern.properties) {
    if (property.type !== "Property" || property.computed) continue;
    const name = staticKeyName(property);
    if (name === undefined || !known.has(name)) continue;
    const identifier = identifierFromPattern(property.value);
    if (identifier !== undefined) recordAlias(identifier, name);
  }
}

/**
 * The initializer of a one-hop `const` binding, with type-only wrappers peeled.
 *
 * @param {import('estree').Identifier} identifier
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {import('estree').Node | undefined}
 */
function constInitializer(identifier, sourceCode) {
  const variable = resolveIdentifierBinding(sourceCode, identifier);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (definition?.type !== "Variable") return undefined;
  const declarator = definition.node;
  if (!isConstDeclarator(declarator) || !declarator.init) return undefined;
  return unwrapTransparent(declarator.init);
}

/**
 * The object literal a value denotes, following a single `const` binding so
 * `const w = { update: … }; stats: w` is still seen, and seeing through
 * `satisfies`/`as`/`!` wrappers on either side of that hop. Deliberately one
 * hop: callers use this as a diagnostic, not a proof.
 *
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {import('estree').ObjectExpression | undefined}
 */
export function boundObjectLiteral(node, sourceCode) {
  const value = unwrapTransparent(node);
  if (value.type === "ObjectExpression") return value;
  if (value.type !== "Identifier") return undefined;

  const init = constInitializer(value, sourceCode);
  return init?.type === "ObjectExpression" ? init : undefined;
}

/**
 * @param {import('estree').ObjectExpression} object
 * @param {string} key
 */
export function hasStaticKey(object, key) {
  return object.properties.some(
    (property) => property.type === "Property" && staticKeyName(property) === key,
  );
}
