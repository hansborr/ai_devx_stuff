// duplicate-schemas extractor: object schemas are call expressions
// `<receiver>.object({ ... })`. The canonical identity is the SORTED KEY NAMES of
// the schema's object shape, hashed and grouped cross-file — so the same schema
// written twice with the fields in a different order, or with equivalent validators
// written differently (`.min(1)` vs `.nonempty()`), groups together. Validator text
// is deliberately NOT part of the grouping key; it is carried in `extra.fields` as
// evidence so a human can see whether grouped schemas truly match or only share key
// names.
//
// `.extend({...})` / `.merge({...})` chain links fold their literal keys into the
// set, while simple literal `.pick({ key: true })` / `.omit({ key: true })` masks
// transform that set. If a key-affecting chain link is non-literal or ambiguous
// (e.g. `.merge(BaseSchema)`, `.pick(mask)`, or a base that is an identifier rather
// than a `.object({...})`), the schema is SKIPPED rather than emitted as a
// misleading partial — the same decline-don't-guess posture duplicate-types takes
// on non-property members.
//
// Matching is intentionally broad: any `<receiver>.object({...})` matches, not just
// `z`. The spec calls for "Zod (and similar)" — Joi, yup, and friends also use
// `.object({...})`, so for this opt-in candidate check the broad match is intended;
// a non-zod `.object({...})` with >= minKeys identical keys across two files is still
// a real cross-file duplicate worth surfacing as evidence.

import { ts } from "ts-morph";

import type { ShapeEntry } from "./duplicate-shapes.js";
import { scriptKindFor } from "./ts-source-util.js";

export { DEFAULT_DUPLICATE_SCHEMAS_MIN_KEYS } from "./duplicate-shapes-config-values.js";

export type ExtractSchemaShapesOptions = { readonly minKeys: number };
export type SchemaShapeExtra = {
  readonly keyCount: number;
  readonly fields: readonly string[];
};

// Chain methods whose single object-literal argument contributes additional keys to
// the schema shape (zod's structural composition operators).
const KEY_CONTRIBUTING_METHODS: ReadonlySet<string> = new Set(["extend", "merge"]);

// Known invoked links that do not add/remove explicit object keys. They may affect
// validation or wrapper semantics, but this detector's canonical identity is the
// declared key set; validator differences are carried only as human evidence.
const KEY_PRESERVING_METHODS: ReadonlySet<string> = new Set([
  "brand",
  "catchall",
  "describe",
  "partial",
  "passthrough",
  "readonly",
  "refine",
  "required",
  "strip",
  "strict",
  "superRefine",
]);

export function extractSchemaShapes(
  filePath: string,
  source: string,
  options: ExtractSchemaShapesOptions,
): ShapeEntry<SchemaShapeExtra>[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  return extractSchemaShapesFrom(filePath, sourceFile, options);
}

export function extractSchemaShapesFrom(
  filePath: string,
  sourceFile: ts.SourceFile,
  options: ExtractSchemaShapesOptions,
): ShapeEntry<SchemaShapeExtra>[] {
  const entries: ShapeEntry<SchemaShapeExtra>[] = [];
  const visit = (node: ts.Node): void => {
    const shape = schemaShape(node, sourceFile, filePath, options);
    if (shape !== null) entries.push(shape);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return entries;
}

type SchemaField = { readonly name: string; readonly valueText: string };

function schemaShape(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  options: ExtractSchemaShapesOptions,
): ShapeEntry<SchemaShapeExtra> | null {
  const objectLiteral = baseObjectArgument(node);
  if (objectLiteral === null) return null;
  const baseFields = objectFields(objectLiteral);
  if (baseFields === null) return null;
  const fields = foldChainKeys(node, baseFields);
  // A null fold means a chain link contributed a non-literal (e.g. `.merge(Base)`):
  // decline rather than emit a misleading partial shape.
  if (fields === null) return null;
  if (fields.length < options.minKeys) return null;
  return shapeEntry(filePath, sourceFile, chainEnd(node), fields);
}

// A base `<x>.object({ ... })` call: a call whose callee is a property access ending
// in `.object` with a single object-literal argument. We anchor on the base so the
// whole `.object(...).extend(...).merge(...)` chain is captured exactly once.
function baseObjectArgument(node: ts.Node): ts.ObjectLiteralExpression | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "object") return null;
  const [firstArg] = node.arguments;
  if (firstArg === undefined || !ts.isObjectLiteralExpression(firstArg)) return null;
  return firstArg;
}

// Walk UP the call chain from the base `.object(...)` call through known links,
// folding each literal structural transform into the key set. Returns null if a
// key-affecting link is ambiguous or an invoked link is not known to preserve keys.
// Type/property accesses that are not invoked stop the fold.
function foldChainKeys(
  baseCall: ts.Node,
  baseFields: readonly SchemaField[],
): SchemaField[] | null {
  let fields = [...baseFields];
  let current: ts.Node = baseCall;
  for (;;) {
    const access = current.parent;
    if (!ts.isPropertyAccessExpression(access) || access.expression !== current) break;
    const call = access.parent;
    if (!ts.isCallExpression(call) || call.expression !== access) {
      // A property access that is not itself invoked (e.g. `.shape`); stop folding.
      break;
    }
    const nextFields = foldChainLink(access.name.text, call, fields);
    if (nextFields === null) return null;
    fields = nextFields;
    current = call;
  }
  return fields;
}

function foldChainLink(
  methodName: string,
  call: ts.CallExpression,
  fields: SchemaField[],
): SchemaField[] | null {
  if (KEY_CONTRIBUTING_METHODS.has(methodName)) return appendChainLinkFields(fields, call);
  if (methodName === "pick") return transformMaskedFields(fields, call, "pick");
  if (methodName === "omit") return transformMaskedFields(fields, call, "omit");
  if (KEY_PRESERVING_METHODS.has(methodName)) return fields;
  return null;
}

function appendChainLinkFields(
  fields: readonly SchemaField[],
  call: ts.CallExpression,
): SchemaField[] | null {
  const linkFields = chainLinkFields(call);
  if (linkFields === null) return null;
  return [...fields, ...linkFields];
}

function chainLinkFields(call: ts.CallExpression): readonly SchemaField[] | null {
  const [arg] = call.arguments;
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return null;
  return objectFields(arg);
}

function transformMaskedFields(
  fields: readonly SchemaField[],
  call: ts.CallExpression,
  transform: "omit" | "pick",
): SchemaField[] | null {
  const mask = keyMask(call);
  if (mask === null) return null;
  return transform === "pick" ? pickFields(fields, mask) : omitFields(fields, mask);
}

function keyMask(call: ts.CallExpression): ReadonlySet<string> | null {
  const [arg] = call.arguments;
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return null;
  const names: string[] = [];
  for (const property of arg.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = propertyName(property.name);
    if (name === null || property.initializer.kind !== ts.SyntaxKind.TrueKeyword) return null;
    names.push(name);
  }
  const uniqueNames = new Set(names);
  if (uniqueNames.size !== names.length) return null;
  return uniqueNames;
}

function pickFields(
  fields: readonly SchemaField[],
  mask: ReadonlySet<string>,
): SchemaField[] | null {
  if (!maskKeysExist(fields, mask)) return null;
  return fields.filter((field) => mask.has(field.name));
}

function omitFields(
  fields: readonly SchemaField[],
  mask: ReadonlySet<string>,
): SchemaField[] | null {
  if (!maskKeysExist(fields, mask)) return null;
  return fields.filter((field) => !mask.has(field.name));
}

function maskKeysExist(fields: readonly SchemaField[], mask: ReadonlySet<string>): boolean {
  const fieldNames = new Set(fields.map((field) => field.name));
  return [...mask].every((key) => fieldNames.has(key));
}

// The outermost node of the schema chain, used to anchor the reported range.
function chainEnd(baseCall: ts.Node): ts.Node {
  let current: ts.Node = baseCall;
  while (ts.isPropertyAccessExpression(current.parent) || ts.isCallExpression(current.parent)) {
    current = current.parent;
  }
  return current;
}

// The `name`/`valueText` pairs for an object literal. Returns null when the literal
// contains a spread or a shorthand/computed/method member, since those make the key
// set ambiguous and we decline to emit a misleading partial.
function objectFields(objectLiteral: ts.ObjectLiteralExpression): SchemaField[] | null {
  const fields: SchemaField[] = [];
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = propertyName(property.name);
    if (name === null) return null;
    fields.push({ name, valueText: normalizeText(property.initializer.getText()) });
  }
  return fields;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function shapeEntry(
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  fields: readonly SchemaField[],
): ShapeEntry<SchemaShapeExtra> {
  const sortedNames = [...fields]
    .map((field) => field.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  const fieldEvidence = [...fields]
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .map((field) => `${field.name}=${field.valueText}`);
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return {
    // Grouping identity = sorted KEY NAMES only (lossy on validator text by design).
    canonicalKey: `schema:{${sortedNames.join(";")}}`,
    label: schemaLabel(node),
    filePath,
    startLine,
    endLine,
    // Validator/value text is evidence, NOT part of the grouping key.
    extra: { keyCount: sortedNames.length, fields: fieldEvidence },
  };
}

// A readable label: the name of the variable/property the schema is assigned to,
// else "<schema>". `node` is already the chain end, so its parent is the assignment.
function schemaLabel(node: ts.Node): string {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  return "<schema>";
}
