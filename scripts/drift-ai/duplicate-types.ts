// duplicate-types extractor: canonicalize each `interface` and object-literal
// `type` alias to a SORTED bag of `[propName, typeText]` plus its sorted `extends`
// heritage, and emit it as a shape entry, so two agents defining the same DTO (even
// with the props in a different order, or one as `interface` and one as `type`)
// group together — but two interfaces with identical local members and DIFFERENT
// heritage do not.
//
// Text-structural by design: the type text and heritage are the printed
// annotations, so it will NOT unify `string` with an alias of `string`, nor resolve
// what an `extends Base` actually contains. The resulting group is evidence the
// human reads — drift:ai does not adjudicate which declaration is canonical. Guard:
// a minimum prop count keeps tiny incidental shapes (`{ x; y }`) out.

import { ts } from "ts-morph";

import type { ShapeEntry } from "./duplicate-shapes.js";

export { DEFAULT_DUPLICATE_TYPES_MIN_PROPS } from "./duplicate-shapes-config-values.js";

export type ExtractTypeShapesOptions = { readonly minProps: number };
export type TypeShapeExtra = {
  readonly name: string;
  readonly propCount: number;
  readonly extends?: readonly string[];
};

export function extractTypeShapes(
  filePath: string,
  source: string,
  options: ExtractTypeShapesOptions,
): ShapeEntry<TypeShapeExtra>[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  return extractTypeShapesFrom(filePath, sourceFile, options);
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

// The shared-core entry point: extract from an already-parsed source file (so the
// duplicate-types check pays for a single parse per file).
export function extractTypeShapesFrom(
  filePath: string,
  sourceFile: ts.SourceFile,
  options: ExtractTypeShapesOptions,
): ShapeEntry<TypeShapeExtra>[] {
  const entries: ShapeEntry<TypeShapeExtra>[] = [];
  const visit = (node: ts.Node): void => {
    const shape = shapeForDeclaration(node, sourceFile, filePath, options);
    if (shape !== null) entries.push(shape);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return entries;
}

function shapeForDeclaration(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  options: ExtractTypeShapesOptions,
): ShapeEntry<TypeShapeExtra> | null {
  const found = declarationShape(node);
  if (found === null) return null;
  const props = canonicalProps(found.members);
  if (props.length < options.minProps) return null;
  return shapeEntry(filePath, sourceFile, found.nameNode, found.label, props, found.heritage);
}

type DeclarationShape = {
  readonly nameNode: ts.Node;
  readonly label: string;
  readonly members: readonly ts.TypeElement[];
  // Sorted `extends`/heritage type-texts (interfaces only). Folded into the
  // canonical key so two interfaces group only when both their local members AND
  // their heritage match. Text-structural: it does not resolve what a base contains.
  readonly heritage: readonly string[];
};

// An interface declaration, or a `type X = { ... }` alias over a single object type
// literal. Mapped types, unions, intersections, and non-object aliases are skipped
// (they have no flat prop bag to canonicalize).
function declarationShape(node: ts.Node): DeclarationShape | null {
  if (ts.isInterfaceDeclaration(node)) {
    return {
      nameNode: node.name,
      label: node.name.text,
      members: node.members,
      heritage: heritageTypeTexts(node.heritageClauses),
    };
  }
  if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
    return { nameNode: node.name, label: node.name.text, members: node.type.members, heritage: [] };
  }
  return null;
}

// The sorted printed text of every heritage type (`extends A, B<T>` -> ["A", "B<T>"]).
function heritageTypeTexts(
  clauses: ts.NodeArray<ts.HeritageClause> | undefined,
): readonly string[] {
  if (clauses === undefined) return [];
  const texts: string[] = [];
  for (const clause of clauses) {
    for (const type of clause.types) texts.push(normalizeTypeText(type.getText()));
  }
  return texts.sort((left, right) => left.localeCompare(right, "en"));
}

// Build the sorted `name=typeText` bag. Returns [] when any member is not a plain
// property signature (call/index/method signatures make the shape non-DTO-like, so
// we decline to canonicalize rather than emit a misleading partial key).
function canonicalProps(members: readonly ts.TypeElement[]): string[] {
  const props: string[] = [];
  for (const member of members) {
    const prop = propSignature(member);
    if (prop === null) return [];
    props.push(prop);
  }
  return props.sort((left, right) => left.localeCompare(right, "en"));
}

function propSignature(member: ts.TypeElement): string | null {
  if (!ts.isPropertySignature(member)) return null;
  const name = propertyName(member.name);
  if (name === null) return null;
  const optional = member.questionToken === undefined ? "" : "?";
  const typeText = member.type === undefined ? "any" : normalizeTypeText(member.type.getText());
  return `${name}${optional}=${typeText}`;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function normalizeTypeText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function shapeEntry(
  filePath: string,
  sourceFile: ts.SourceFile,
  nameNode: ts.Node,
  label: string,
  props: readonly string[],
  heritage: readonly string[],
): ShapeEntry<TypeShapeExtra> {
  const startLine =
    sourceFile.getLineAndCharacterOfPosition(nameNode.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(nameNode.parent.getEnd()).line + 1;
  return {
    // The prefix namespaces the key so a type bag can never collide with a schema
    // or literal key. Heritage (`extends ...`) is folded in so interfaces group only
    // when both local members AND heritage match (text-structural, not resolved).
    canonicalKey: `type:extends[${heritage.join(",")}]:{${props.join(";")}}`,
    label,
    filePath,
    startLine,
    endLine,
    extra:
      heritage.length === 0
        ? { name: label, propCount: props.length }
        : { name: label, propCount: props.length, extends: heritage },
  };
}
