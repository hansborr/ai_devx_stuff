// @ts-check

/**
 * Detect nested relation writes that reach concurrency-gated Prisma delegates.
 *
 * This name-matching walk is an author-time diagnostic, not an authoritative
 * closure mechanism. Payloads assembled through helper calls or spreads can
 * escape syntax analysis; the runtime nested-write guard remains authoritative.
 */

import {
  boundObjectLiteral,
  hasStaticKey,
  isConstDeclarator,
  recordKnownDestructuredAliases,
  resolvedConstPropertyName,
  staticKeyName,
  staticPropertyName,
  unwrapChain,
  unwrapTransparent,
} from "./ast-helpers.js";
import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";
import {
  DATA_SCALAR_MODELS,
  GATED_DELEGATES,
  GATED_MUTATORS,
  PAYLOAD_ENVELOPE_KEYS,
  RELATIONS_BY_MODEL,
} from "./concurrency-guard-graph.js";

/**
 * @param {import('estree').Node} node
 * @param {{ has(value: string): boolean }} known
 * @returns {string | undefined}
 */
function knownPropertyName(node, known) {
  const unwrapped = unwrapTransparent(node);
  if (unwrapped.type !== "MemberExpression") return undefined;

  const name = staticPropertyName(unwrapped);
  return name !== undefined && known.has(name) ? name : undefined;
}

/**
 * The Prisma model a mutation call's receiver names: `tx.character` directly,
 * or an identifier bound to one by a single `const` hop.
 *
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {WeakMap<import('eslint').Scope.Variable, string>} modelAliases
 * @returns {string | undefined}
 */
function receiverModelName(node, sourceCode, modelAliases) {
  const receiver = unwrapTransparent(node);
  if (receiver.type === "MemberExpression") {
    return knownPropertyName(receiver, RELATIONS_BY_MODEL);
  }
  if (receiver.type !== "Identifier") return undefined;
  const variable = resolveIdentifierBinding(sourceCode, receiver);
  const recorded = variable === undefined ? undefined : modelAliases.get(variable);
  return recorded ?? resolvedConstPropertyName(receiver, sourceCode, RELATIONS_BY_MODEL);
}

/**
 * Every object literal a payload value can denote: the object itself, the
 * elements of an array payload (`updateMany: [{ where, data }, …]`), or the
 * object a one-hop `const` binding holds.
 *
 * Array elements get the same `const` hop the scalar form does. Without it
 * `updateMany: [reset]` was an undocumented escape from both detectors while
 * `update: reset` was caught, which is not a distinction Prisma makes.
 *
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {import('estree').ObjectExpression[]}
 */
function payloadObjects(node, sourceCode) {
  const value = unwrapTransparent(node);
  if (value.type === "ArrayExpression") {
    const objects = [];
    for (const element of value.elements) {
      const resolved = element === null ? undefined : boundObjectLiteral(element, sourceCode);
      if (resolved !== undefined) objects.push(resolved);
    }
    return objects.length === value.elements.length ? objects : [];
  }
  const single = boundObjectLiteral(value, sourceCode);
  return single === undefined ? [] : [single];
}

/**
 * Prisma's nested update payload shape: an object, or a non-empty array of
 * objects. Both forms are resolved through a one-hop binding, because
 * `update: patch` is ordinary code rather than an evasion.
 *
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function isNestedWritePayload(node, sourceCode) {
  return payloadObjects(node, sourceCode).length > 0;
}

/**
 * The argument object of a Prisma mutation call, or `undefined` if this call is
 * not one.
 *
 * Scoping the nested branch to a *resolved Prisma argument* keeps it off
 * ordinary server objects. A mutation must name a graph-known receiver model,
 * use a gated mutator, and carry a resolved argument object with `where`.
 *
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {WeakMap<import('eslint').Scope.Variable, string>} modelAliases
 * @returns {{ argument: import('estree').ObjectExpression, model: string } | undefined}
 */
function prismaMutationArgument(node, sourceCode, modelAliases) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;

  const method = staticPropertyName(callee);
  if (!method || !GATED_MUTATORS.has(method)) return undefined;

  const model = receiverModelName(callee.object, sourceCode, modelAliases);
  if (!model) return undefined;

  const [first] = node.arguments;
  if (first === undefined || first.type === "SpreadElement") return undefined;

  const argument = boundObjectLiteral(first, sourceCode);
  if (argument === undefined) return undefined;
  return hasStaticKey(argument, "where") ? { argument, model } : undefined;
}

/**
 * The gated mutator a relation envelope writes through, if any.
 *
 * @param {import('estree').ObjectExpression} envelope
 * @param {import('eslint').SourceCode} sourceCode
 */
function gatedMutatorIn(envelope, sourceCode) {
  for (const member of envelope.properties) {
    if (member.type !== "Property") continue;
    const method = staticKeyName(member);
    if (method === undefined || !GATED_MUTATORS.has(method)) continue;
    if (!isNestedWritePayload(member.value, sourceCode)) continue;
    return method;
  }
  return undefined;
}

/**
 * @typedef {{ node: import('estree').Property, delegate: string, method: string, relation: string }} NestedWrite
 * @typedef {"ambiguous" | "data" | "wrapper"} NestedWalkKind
 * @typedef {{ sourceCode: import('eslint').SourceCode, found: NestedWrite[], seen: WeakMap<import('estree').ObjectExpression, Set<string>> }} NestedWalk
 */

/**
 * @param {string | undefined} model
 * @param {string | undefined} relation
 */
function relationTarget(model, relation) {
  if (model === undefined || relation === undefined) return undefined;
  return RELATIONS_BY_MODEL.get(model)?.get(relation);
}

/** @param {string | undefined} target */
function gatedDelegate(target) {
  return target !== undefined && GATED_DELEGATES.has(target) ? target : undefined;
}

/** @param {string} key */
function envelopeValueKind(key) {
  if (key === "data" || key === "create") return "data";
  if (key === "upsert") return "wrapper";
  return "ambiguous";
}

/**
 * @param {import('estree').ObjectExpression} payload
 * @param {string} identity
 * @param {NestedWalk} walk
 */
function rememberNestedWalk(payload, identity, walk) {
  const identities = walk.seen.get(payload);
  if (identities?.has(identity) === true) return false;
  if (identities === undefined) walk.seen.set(payload, new Set([identity]));
  else identities.add(identity);
  return true;
}

/**
 * @param {import('estree').ObjectExpression} payload
 * @param {string} model
 * @param {NestedWalk} walk
 */
function collectRelationWrites(payload, model, walk) {
  for (const property of payload.properties) {
    if (property.type !== "Property") continue;
    const relation = staticKeyName(property);
    const target = relationTarget(model, relation);
    if (relation === undefined || target === undefined) continue;

    const envelopes = payloadObjects(property.value, walk.sourceCode);
    const delegate = gatedDelegate(target);
    for (const envelope of delegate === undefined ? [] : envelopes) {
      const method = gatedMutatorIn(envelope, walk.sourceCode);
      if (method === undefined) continue;
      walk.found.push({ node: property, delegate, method, relation });
      break;
    }

    for (const envelope of RELATIONS_BY_MODEL.has(target) ? envelopes : []) {
      collectNestedGatedWrites(envelope, target, "wrapper", walk);
    }
  }
}

/**
 * @param {import('estree').ObjectExpression} payload
 * @param {string} model
 */
function canFollowAmbiguousData(payload, model) {
  return hasStaticKey(payload, "where") || !DATA_SCALAR_MODELS.has(model);
}

/**
 * @param {import('estree').Property} property
 * @param {import('estree').ObjectExpression} payload
 * @param {string} model
 * @param {NestedWalkKind} kind
 */
function nestedKindForProperty(property, payload, model, kind) {
  const key = staticKeyName(property);
  if (key === undefined || !PAYLOAD_ENVELOPE_KEYS.has(key)) return undefined;
  if (kind === "ambiguous" && key !== "data") return undefined;
  if (kind === "ambiguous" && !canFollowAmbiguousData(payload, model)) return undefined;
  return envelopeValueKind(key);
}

/**
 * @param {import('estree').ObjectExpression} payload
 * @param {string} model
 * @param {NestedWalkKind} kind
 * @param {NestedWalk} walk
 */
function collectEnvelopeWrites(payload, model, kind, walk) {
  for (const property of payload.properties) {
    if (property.type !== "Property") continue;
    const nestedKind = nestedKindForProperty(property, payload, model, kind);
    if (nestedKind === undefined) continue;
    for (const nestedPayload of payloadObjects(property.value, walk.sourceCode)) {
      collectNestedGatedWrites(nestedPayload, model, nestedKind, walk);
    }
  }
}

/**
 * @param {import('estree').ObjectExpression} payload
 * @param {string} model
 * @param {NestedWalkKind} kind
 * @param {NestedWalk} walk
 */
function collectNestedGatedWrites(payload, model, kind, walk) {
  if (!rememberNestedWalk(payload, `${kind}:${model}`, walk)) return;
  if (kind !== "wrapper") collectRelationWrites(payload, model, walk);
  if (kind !== "data") collectEnvelopeWrites(payload, model, kind, walk);
}

/**
 * @param {import('eslint').SourceCode} sourceCode
 */
export function createNestedAnalyzer(sourceCode) {
  /** @type {WeakMap<import('eslint').Scope.Variable, string>} */
  const modelAliases = new WeakMap();

  /**
   * @param {import('estree').Identifier} identifier
   * @param {string} name
   */
  function recordAlias(identifier, name) {
    const variable = resolveDeclaredVariable(sourceCode.getScope(identifier), identifier);
    if (variable !== undefined) modelAliases.set(variable, name);
  }

  return {
    /** @param {import('estree').VariableDeclarator} node */
    recordAliases(node) {
      if (!isConstDeclarator(node)) return;

      if (node.id.type === "Identifier") {
        if (node.init === null || node.init === undefined) return;
        const model = knownPropertyName(node.init, RELATIONS_BY_MODEL);
        if (model !== undefined) recordAlias(node.id, model);
        return;
      }

      if (node.id.type === "ObjectPattern") {
        recordKnownDestructuredAliases(node.id, RELATIONS_BY_MODEL, recordAlias);
      }
    },

    /** @param {import('estree').CallExpression} node */
    findWrites(node) {
      const mutation = prismaMutationArgument(node, sourceCode, modelAliases);
      if (mutation === undefined) return [];

      /** @type {NestedWrite[]} */
      const found = [];
      collectNestedGatedWrites(mutation.argument, mutation.model, "wrapper", {
        sourceCode,
        found,
        seen: new WeakMap(),
      });
      return found;
    },
  };
}
