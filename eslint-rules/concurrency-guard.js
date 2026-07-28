// @ts-check

/**
 * Guard direct writes to Prisma delegates whose update/upsert methods are
 * concurrency-gated in `packages/server/src/utils/prisma-types.ts`.
 *
 * This intentionally mirrors the current restricted-delegate surface instead
 * of banning every Prisma write. See `docs/CONCURRENCY.md` for why ordinary
 * create/delete paths and non-gated tables stay out of scope.
 *
 * Client laundering is a type-boundary concern: `DbClient` deliberately omits
 * Prisma's raw-returning `$extends`, and `TxClient` makes its raw-callback
 * `$transaction` non-callable, in `utils/prisma-types.ts`.
 *
 * Two branches, and they close different holes:
 *
 * 1. **Direct writes** — `tx.characterStats.update(...)` and its local
 *    aliases. Backed by the branded delegate types; this branch is the
 *    diagnostic, not the guarantee.
 * 2. **Nested relation writes** — `tx.character.update({ data: { stats: {
 *    update: … } } })`. The type gate CANNOT see these: `RestrictedDelegates`
 *    narrows delegate *properties* on the client, while a nested write goes
 *    through `Prisma.CharacterUpdateInput`, a generated type with its own
 *    `update`/`updateMany`/`upsert` members and no seam to intercept. This
 *    branch is therefore the ONLY enforcement on that path, which makes it
 *    weaker than the type gate rather than equivalent to it: a name-matching
 *    lint is escapable, e.g. by a payload assembled through a helper call or
 *    spread rather than an object literal. It follows a one-hop `const`
 *    binding for the call argument, the relation envelope, and the mutator
 *    value alike — the same way the direct branch follows delegate aliases —
 *    but it does not claim closure. See `docs/CONCURRENCY.md`.
 *
 *    It fires only inside a **resolved Prisma mutation argument** (a
 *    `GATED_MUTATORS` call whose argument object carries `where`). Matching
 *    bare object literals anywhere in server source would make any unrelated
 *    `{ stats: { update: … } }` a hard lint error, which is not a trade this
 *    rule is entitled to make without a ratchet.
 *
 * Unlike branch 1, branch 2 stays live in `utils/*-mutations.ts`. Those files
 * are exempt from the direct ban because they own the `RawTxClient` boundary
 * for a single table; a nested write reaches a *different* table through a
 * non-gated parent, which is outside that boundary rather than inside it.
 *
 * `create` stays out of both branches on purpose: nested `stats: { create: … }`
 * is ordinary character creation, and `GATED_MUTATORS` mirrors the restricted
 * update/upsert surface only.
 */

import {
  staticKeyName,
  staticPropertyName,
  unwrapChain,
  unwrapTransparent,
} from "./ast-helpers.js";
import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";

const GATED_DELEGATES = new Set([
  "characterStats",
  "encounterParticipant",
  "encounter",
  "characterSpellSlot",
  "characterClass",
]);

const GATED_MUTATORS = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);

/**
 * `<parent delegate>.<relation field>` -> the gated delegate a nested write
 * through it reaches.
 *
 * Not a policy list: it is every relation field in `schema.prisma` whose target
 * is one of the five gated models, qualified by the model that declares it.
 * `concurrency-guard-drift.test.ts` re-derives it from the schema and fails if
 * this drifts, so a new relation to a gated model cannot silently widen the
 * escape.
 *
 * Qualifying by the parent is what makes the match sound. Relation *names*
 * collide across models — `classes` is a `CharacterClass[]` relation on
 * `Character` and a `Json` scalar on `Spell` — so key-only matching turned a
 * type-valid `spell.update({ data: { classes: { update: … } } })` into a hard
 * error. It also fired on any non-Prisma `.update({ where, … })` receiver.
 */
const GATED_RELATION_FIELDS = new Map([
  ["campaign.encounters", "encounter"],
  ["character.classes", "characterClass"],
  ["character.encounterParticipants", "encounterParticipant"],
  ["character.spellSlots", "characterSpellSlot"],
  ["character.stats", "characterStats"],
  ["class.characterClasses", "characterClass"],
  ["combatLog.encounter", "encounter"],
  ["combatLog.participant", "encounterParticipant"],
  ["encounter.participants", "encounterParticipant"],
  ["encounterParticipant.encounter", "encounter"],
  ["map.encounters", "encounter"],
  ["mapToken.encounterParticipant", "encounterParticipant"],
  ["monster.participants", "encounterParticipant"],
  ["subclass.characterClasses", "characterClass"],
]);

/**
 * Payload keys that wrap a nested write without changing which model the
 * surrounding object describes. Descending through one of these keeps the
 * parent model known; descending through anything else (a scalar field, an
 * unrecognised relation) drops it, and a dropped model stops the nested match
 * rather than guessing — the documented cost of rooting on the parent.
 */
const PAYLOAD_ENVELOPE_KEYS = new Set([
  "create",
  "data",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "where",
]);

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

/**
 * @param {import('estree').Node} node
 * @returns {string | undefined}
 */
function gatedDelegatePropertyName(node) {
  const unwrapped = unwrapChain(node);
  if (unwrapped.type !== "MemberExpression") return undefined;

  const name = staticPropertyName(unwrapped);
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

  const method = staticPropertyName(callee);
  if (!method || !GATED_MUTATORS.has(method)) return undefined;

  const delegate = delegateName(callee.object, sourceCode, delegateAliases);
  if (!delegate) return undefined;

  return { delegate, method };
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
 * The object literal a payload value denotes, following a single `const`
 * binding so `const w = { update: … }; data: { stats: w }` is still seen, and
 * seeing through `satisfies`/`as`/`!` wrappers on either side of that hop.
 * Deliberately one hop: this is a diagnostic, not a proof.
 *
 * @param {import('estree').Node} node
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {import('estree').ObjectExpression | undefined}
 */
function payloadObject(node, sourceCode) {
  const value = unwrapTransparent(node);
  if (value.type === "ObjectExpression") return value;
  if (value.type !== "Identifier") return undefined;

  const init = constInitializer(value, sourceCode);
  return init?.type === "ObjectExpression" ? init : undefined;
}

/**
 * Every object literal a payload value can denote: the object itself, the
 * elements of an array payload (`updateMany: [{ where, data }, …]`), or the
 * object a one-hop `const` binding holds.
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
      const unwrapped = element === null ? undefined : unwrapTransparent(element);
      if (unwrapped?.type === "ObjectExpression") objects.push(unwrapped);
    }
    return objects.length === value.elements.length ? objects : [];
  }
  const single = payloadObject(value, sourceCode);
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

/** @param {import('estree').ObjectExpression} object @param {string} key */
function hasStaticKey(object, key) {
  return object.properties.some(
    (property) => property.type === "Property" && staticKeyName(property) === key,
  );
}

/**
 * The argument object of a Prisma mutation call, or `undefined` if this call is
 * not one.
 *
 * Scoping the nested branch to a *resolved Prisma argument* is what keeps it
 * off ordinary server objects: without it, any `{ stats: { update: … } }`
 * literal anywhere in server source is a hard lint error, which is too broad
 * for an unratcheted rule. A Prisma `update`/`updateMany`/`updateManyAndReturn`
 * /`upsert` argument always carries `where`, and that pair — a gated mutator
 * method name plus a `where` key — is the cheapest reliable signal available
 * without type information.
 *
 * Nested `create` payloads stay out of scope by construction: `create` is not
 * in `GATED_MUTATORS`, so neither the call nor the nested key matches.
 *
 * The receiver must also name a model (`<client>.<model>.<mutator>(…)`), which
 * is what roots the relation lookup: without a parent model there is nothing to
 * check `stats`/`classes` against, and a bare `store.update({ where, … })` is
 * not a Prisma call at all.
 *
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @returns {{ argument: import('estree').ObjectExpression, model: string } | undefined}
 */
function prismaMutationArgument(node, sourceCode) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;

  const method = staticPropertyName(callee);
  if (!method || !GATED_MUTATORS.has(method)) return undefined;

  const receiver = unwrapChain(callee.object);
  if (receiver.type !== "MemberExpression") return undefined;
  const model = staticPropertyName(receiver);
  if (!model) return undefined;

  const [first] = node.arguments;
  if (first === undefined || first.type === "SpreadElement") return undefined;

  const argument = payloadObject(first, sourceCode);
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
 */

/**
 * Collect every `<gatedRelation>: { <gatedMutator>: … }` property reachable
 * inside a Prisma mutation argument, at any depth — a gated relation can sit
 * under another nested write.
 *
 * `model` is the Prisma model the surrounding object describes, carried down
 * so each relation key is checked against the model that actually declares it.
 * It survives envelope keys (`data`, `update`, …) and steps to the target model
 * when the walk crosses a gated relation; crossing anything else drops it, and
 * a dropped model ends the match for that subtree.
 *
 * @typedef {{ sourceCode: import('eslint').SourceCode, found: NestedWrite[], seen: Set<import('estree').ObjectExpression> }} NestedWalk
 */

/**
 * The gated delegate `<model>.<relation>` reaches, if both are known.
 *
 * @param {string | undefined} model
 * @param {string | undefined} relation
 */
function gatedRelationTarget(model, relation) {
  if (model === undefined || relation === undefined) return undefined;
  return GATED_RELATION_FIELDS.get(`${model}.${relation}`);
}

/**
 * The model the envelopes under this property describe: the relation's target
 * when the walk crosses a gated relation, the unchanged model across a payload
 * envelope key, and unknown otherwise.
 *
 * @param {string | undefined} model
 * @param {string | undefined} relation
 * @param {string | undefined} delegate
 */
function modelForNested(model, relation, delegate) {
  if (delegate !== undefined) return delegate;
  if (relation !== undefined && PAYLOAD_ENVELOPE_KEYS.has(relation)) return model;
  return undefined;
}

/**
 * @param {import('estree').ObjectExpression} payload
 * @param {string | undefined} model
 * @param {NestedWalk} walk
 */
function collectNestedGatedWrites(payload, model, walk) {
  if (walk.seen.has(payload)) return;
  walk.seen.add(payload);

  for (const property of payload.properties) {
    if (property.type !== "Property") continue;

    const relation = staticKeyName(property);
    const envelopes = payloadObjects(property.value, walk.sourceCode);
    const delegate = gatedRelationTarget(model, relation);

    if (relation !== undefined && delegate !== undefined) {
      for (const envelope of envelopes) {
        const method = gatedMutatorIn(envelope, walk.sourceCode);
        if (method !== undefined) {
          walk.found.push({ node: property, delegate, method, relation });
          break;
        }
      }
    }

    const nested = modelForNested(model, relation, delegate);
    for (const envelope of envelopes) collectNestedGatedWrites(envelope, nested, walk);
  }
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
    const delegate = staticKeyName(property);
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
      description:
        "Disallow direct Prisma update/upsert calls on concurrency-gated delegates, and nested relation writes that reach them through a non-gated parent",
      principle:
        "Every write to a concurrency-gated table must go through a documented helper boundary, whether it is spelled as a direct delegate call or as a nested relation payload the branded delegate types cannot see.",
      category: "behavior",
      pairedGuide: "docs/guides/add-race-sensitive-mutation.md",
      // The codemod repairs the direct branch. A nested finding has no
      // mechanical fix — splitting the parent write from the gated write is a
      // judgement call about transaction boundaries — so the repair is manual
      // and the message says so instead of pointing at the codemod.
      repairKind: "manual",
    },
    messages: {
      noDirectWrite:
        "Why: ADR-0001 requires direct {{delegate}}.{{method}} writes to use the race-sensitive helper boundary so concurrent writers cannot lose updates. How to fix: {{suggestion}} Try `bun run codemod:concurrency-guard -- <file>` first. See docs/guides/add-race-sensitive-mutation.md.",
      noNestedWrite:
        "Why: this nested `{{relation}}: {{{method}}: ...}` payload writes {{delegate}} through a non-gated parent delegate, skipping the CAS machinery ADR-0001 requires — and the branded delegate types cannot see it, because a nested write goes through the generated update-input type rather than the delegate. How to fix: Split the parent write and the gated write into separate statements. {{suggestion}} See docs/guides/add-race-sensitive-mutation.md.",
    },
    schema: [],
  },

  create(context) {
    if (isTypeTestPath(context.filename)) return {};

    // `utils/*-mutations.ts` owns the `RawTxClient` boundary for one table, so
    // its direct writes are expected. Nested writes are not: reaching a gated
    // table through a non-gated parent leaves the helper's own single-table
    // boundary, so that branch stays live here.
    const skipDirect = isMutationHelperPath(context.filename);

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
        const direct = skipDirect
          ? undefined
          : directGatedWrite(node, context.sourceCode, delegateAliases);
        if (direct !== undefined) {
          context.report({
            node: node.callee,
            messageId: "noDirectWrite",
            data: {
              delegate: direct.delegate,
              method: direct.method,
              suggestion:
                DIRECT_WRITE_SUGGESTIONS.get(direct.delegate) ?? "Use a documented helper.",
            },
          });
        }

        const mutation = prismaMutationArgument(node, context.sourceCode);
        if (mutation === undefined) return;

        /** @type {NestedWrite[]} */
        const nested = [];
        collectNestedGatedWrites(mutation.argument, mutation.model, {
          sourceCode: context.sourceCode,
          found: nested,
          seen: new Set(),
        });
        for (const target of nested) {
          context.report({
            node: target.node,
            messageId: "noNestedWrite",
            data: {
              delegate: target.delegate,
              method: target.method,
              relation: target.relation,
              suggestion:
                DIRECT_WRITE_SUGGESTIONS.get(target.delegate) ?? "Use a documented helper.",
            },
          });
        }
      },
    };
  },
};
