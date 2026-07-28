/**
 * Nested relation writes: the half of the concurrency gate that neither the
 * branded delegate types nor the direct-call check can see.
 *
 * Kept behaviourally identical to the nested branch of
 * `eslint-rules/concurrency-guard.js`. `eslint-rules/concurrency-guard-nested-corpus.json`
 * is run through both detectors by `concurrency-guard-drift.test.ts`, so "identical"
 * is a checked claim rather than a comment.
 */
import {
  type CallExpression,
  Node,
  type ObjectLiteralExpression,
  type SourceFile,
  SyntaxKind,
  VariableDeclarationKind,
} from "ts-morph";

import { GATED_MUTATORS, GATED_RELATION_FIELDS, PAYLOAD_ENVELOPE_KEYS } from "./constants.js";
import type { NestedRelationWrite } from "./types.js";

/**
 * Peel type-only and grouping wrappers that do not change the value an
 * expression denotes. Mirrors `unwrapTransparent` in
 * `eslint-rules/ast-helpers.js`: `satisfies` is the house spelling for Prisma
 * payloads, so a checker that cannot see through it misses the idiomatic form.
 */
function unwrapTransparent(node: Node | undefined): Node | undefined {
  let current = node;
  while (
    current !== undefined &&
    (Node.isAsExpression(current) ||
      Node.isSatisfiesExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isParenthesizedExpression(current))
  ) {
    current = current.getExpression();
  }
  return current;
}

/**
 * The object a value denotes, following a single `const` binding so
 * `const w = { update: ... }; data: { stats: w }` is still seen. One hop, and
 * `const` only — the same rule `eslint-rules/concurrency-guard.js` follows, so
 * the two detectors accept the same programs.
 */
function constDeclarationObjectFor(
  declaration: Node | undefined,
): ObjectLiteralExpression | undefined {
  if (!declaration || !Node.isVariableDeclaration(declaration)) return undefined;
  const kind = declaration.getVariableStatement()?.getDeclarationKind();
  if (kind !== VariableDeclarationKind.Const) return undefined;
  const initializer = unwrapTransparent(declaration.getInitializer());
  return initializer && Node.isObjectLiteralExpression(initializer) ? initializer : undefined;
}

function constDeclarationObject(identifier: Node): ObjectLiteralExpression | undefined {
  return constDeclarationObjectFor(identifier.getSymbol()?.getValueDeclaration());
}

function boundObject(node: Node | undefined): ObjectLiteralExpression | undefined {
  const value = unwrapTransparent(node);
  if (!value) return undefined;
  if (Node.isObjectLiteralExpression(value)) return value;
  return Node.isIdentifier(value) ? constDeclarationObject(value) : undefined;
}

/**
 * Prisma's nested payload shape: an object, or a non-empty array of objects
 * (`updateMany: [{ where, data }, ...]`), each resolved through one `const`
 * hop. Requiring that shape keeps ordinary objects that happen to pair a
 * relation name with an `update` key out of the finding.
 */
function payloadObjects(node: Node | undefined): ObjectLiteralExpression[] {
  const value = unwrapTransparent(node);
  if (!value) return [];
  if (Node.isArrayLiteralExpression(value)) {
    const elements = value.getElements().map((element) => unwrapTransparent(element));
    const objects = elements.filter(
      (element) => element !== undefined && Node.isObjectLiteralExpression(element),
    );
    return objects.length === elements.length ? objects : [];
  }
  const single = boundObject(value);
  return single === undefined ? [] : [single];
}

/**
 * A property's static name and the object literals its value denotes.
 *
 * `{ stats }` is `{ stats: stats }`, and the ESLint rule's ESTree `Property`
 * node represents both spellings identically. Gating on `PropertyAssignment`
 * alone made the codemod blind to the shorthand form while the rule still saw
 * it — a divergence the shared corpus did not cover until now. A shorthand's
 * name node resolves to the *property* symbol, so its binding has to come from
 * `getValueSymbol()` rather than the usual identifier lookup.
 */
function propertyEntry(
  property: Node,
): { name: string; objects: ObjectLiteralExpression[] } | undefined {
  if (Node.isPropertyAssignment(property)) {
    return { name: property.getName(), objects: payloadObjects(property.getInitializer()) };
  }
  if (Node.isShorthandPropertyAssignment(property)) {
    const bound = constDeclarationObjectFor(property.getValueSymbol()?.getValueDeclaration());
    return { name: property.getName(), objects: bound === undefined ? [] : [bound] };
  }
  return undefined;
}

function gatedMutatorInPayload(payload: ObjectLiteralExpression): string | undefined {
  for (const member of payload.getProperties()) {
    const entry = propertyEntry(member);
    if (entry === undefined) continue;
    if (GATED_MUTATORS.has(entry.name) && entry.objects.length > 0) {
      return entry.name;
    }
  }
  return undefined;
}

function hasProperty(object: ObjectLiteralExpression, name: string): boolean {
  return object.getProperties().some((property) => propertyEntry(property)?.name === name);
}

interface PrismaMutation {
  argument: ObjectLiteralExpression;
  model: string;
}

/**
 * The argument object of a Prisma mutation call, if this call is one.
 *
 * Mirrors `prismaMutationArgument` in `eslint-rules/concurrency-guard.js`: a
 * gated-mutator method whose receiver names a model and whose argument object
 * carries `where`. Rooting there is what keeps an ordinary
 * `{ stats: { update: ... } }` object — and any non-Prisma `.update({ where })`
 * receiver — out of the finding.
 */
function prismaMutationArgument(call: CallExpression): PrismaMutation | undefined {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  if (!GATED_MUTATORS.has(expression.getName())) return undefined;

  const receiver = expression.getExpression();
  if (!Node.isPropertyAccessExpression(receiver)) return undefined;
  const model = receiver.getName();

  const [first] = call.getArguments();
  const argument = boundObject(first);
  if (argument === undefined) return undefined;
  return hasProperty(argument, "where") ? { argument, model } : undefined;
}

/**
 * The model the envelopes under this property describe. Mirrors
 * `modelForNested` in the ESLint rule: the relation's target across a gated
 * relation, the unchanged model across a payload envelope key, unknown
 * otherwise.
 */
function modelForNested(
  model: string | undefined,
  relation: string,
  delegate: string | undefined,
): string | undefined {
  if (delegate !== undefined) return delegate;
  return PAYLOAD_ENVELOPE_KEYS.has(relation) ? model : undefined;
}

function collectNested(
  payload: ObjectLiteralExpression,
  model: string | undefined,
  writes: NestedRelationWrite[],
  seen: Set<ObjectLiteralExpression>,
): void {
  if (seen.has(payload)) return;
  seen.add(payload);

  for (const property of payload.getProperties()) {
    const entry = propertyEntry(property);
    if (entry === undefined) continue;
    const relation = entry.name;
    const envelopes = entry.objects;
    const delegate =
      model === undefined ? undefined : GATED_RELATION_FIELDS.get(`${model}.${relation}`);

    if (delegate !== undefined) {
      for (const envelope of envelopes) {
        const method = gatedMutatorInPayload(envelope);
        if (method !== undefined) {
          writes.push({ delegate, line: property.getStartLineNumber(), method, relation });
          break;
        }
      }
    }

    const nested = modelForNested(model, relation, delegate);
    for (const envelope of envelopes) collectNested(envelope, nested, writes, seen);
  }
}

/**
 * Nested relation writes to gated tables: `{ stats: { update: ... } }` inside a
 * payload passed to a NON-gated parent delegate. Prisma routes these through
 * the parent's generated update-input type, so they touch neither the branded
 * delegate types in prisma-types.ts nor `delegateCall` in ast.ts.
 *
 * Kept behaviourally identical to the ESLint rule's nested branch — same
 * rooting, same one-hop binding resolution, same depth.
 * `eslint-rules/concurrency-guard-nested-corpus.json`
 * is run through both detectors by `concurrency-guard-drift.test.ts`, so this
 * is a checked claim rather than a comment. A payload assembled through a
 * helper call or spread is outside both, as the finding message says.
 */
export function nestedRelationWrites(sourceFile: SourceFile): NestedRelationWrite[] {
  const writes: NestedRelationWrite[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const mutation = prismaMutationArgument(call);
    if (mutation === undefined) continue;
    // A fresh `seen` per call, as the ESLint rule does: one `const` payload
    // passed to two mutations is two findings, not one.
    collectNested(mutation.argument, mutation.model, writes, new Set());
  }
  return writes;
}
