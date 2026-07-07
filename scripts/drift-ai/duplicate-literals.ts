// duplicate-literals extractor: surface string/number literals that appear in many
// DISTINCT files (a cross-file `no-duplicate-string`). Each literal occurrence is a
// shape entry keyed by its kind+value (so the string "5" never groups with the
// number 5); the shared core then groups by value and the check requires the group
// to span at least N distinct files.
//
// The guards here are NOISE FILTERING, not adjudication: import/require module
// specifiers are skipped (they are not magic values), short/trivial strings are
// skipped below a configurable min length, raw numbers are opt-in with a digit
// floor, and (optionally) strings in a test-title call position
// (describe/it/test) are skipped. drift:ai does not decide which occurrence is
// "wrong"; it surfaces the group as evidence.

import { ts } from "ts-morph";

import type { ShapeEntry } from "./duplicate-shapes.js";
import { hasMinNumericLiteralDigits } from "./numeric-literal-text.js";
import { scriptKindFor } from "./ts-source-util.js";

export type ExtractLiteralShapesOptions = {
  readonly minLength: number;
  readonly includeNumbers: boolean;
  readonly minNumberDigits: number;
  readonly skipTestTitleStrings: boolean;
};
export type LiteralShapeExtra = {
  readonly literalKind: "string" | "number";
  readonly value: string;
};

const TEST_TITLE_CALLEES: ReadonlySet<string> = new Set(["describe", "it", "test", "bench"]);

export function extractLiteralShapes(
  filePath: string,
  source: string,
  options: ExtractLiteralShapesOptions,
): ShapeEntry<LiteralShapeExtra>[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  return extractLiteralShapesFrom(filePath, sourceFile, options);
}

export function extractLiteralShapesFrom(
  filePath: string,
  sourceFile: ts.SourceFile,
  options: ExtractLiteralShapesOptions,
): ShapeEntry<LiteralShapeExtra>[] {
  const entries: ShapeEntry<LiteralShapeExtra>[] = [];
  const visit = (node: ts.Node): void => {
    const entry = literalShape(node, sourceFile, filePath, options);
    if (entry !== null) entries.push(entry);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return entries;
}

function literalShape(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  options: ExtractLiteralShapesOptions,
): ShapeEntry<LiteralShapeExtra> | null {
  const literal = literalValue(node, sourceFile);
  if (literal === null) return null;
  if (isModuleSpecifier(node)) return null;
  if (!passesLiteralTrivialityFilter(literal, options)) return null;
  if (literal.kind === "string" && options.skipTestTitleStrings && isTestTitlePosition(node)) {
    return null;
  }
  return shapeEntry(filePath, sourceFile, node, literal);
}

type LiteralValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: string; readonly sourceText: string };

function literalValue(node: ts.Node, sourceFile: ts.SourceFile): LiteralValue | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: "string", value: node.text };
  }
  if (ts.isNumericLiteral(node)) {
    // A numeric literal that is the operand of a unary +/- is recorded by that
    // parent (with the sign), so skip it here to avoid double-counting it as an
    // unsigned value.
    if (isSignedUnaryOperand(node)) return null;
    return { kind: "number", value: node.text, sourceText: node.getText(sourceFile) };
  }
  if (ts.isPrefixUnaryExpression(node)) return signedNumberValue(node, sourceFile);
  return null;
}

function passesLiteralTrivialityFilter(
  literal: LiteralValue,
  options: ExtractLiteralShapesOptions,
): boolean {
  if (literal.kind === "string") return literal.value.length >= options.minLength;
  if (!options.includeNumbers) return false;
  return hasMinNumericLiteralDigits(literal.sourceText, options.minNumberDigits);
}

// `-1` / `+1` over a numeric literal -> the signed value, so `-1` never groups with
// `1`. Other prefix-unary forms (e.g. `!x`, `~bits`, unary over a non-literal) are
// not literals and are skipped.
function signedNumberValue(
  node: ts.PrefixUnaryExpression,
  sourceFile: ts.SourceFile,
): LiteralValue | null {
  if (!ts.isNumericLiteral(node.operand)) return null;
  if (node.operator === ts.SyntaxKind.MinusToken) {
    return { kind: "number", value: `-${node.operand.text}`, sourceText: node.getText(sourceFile) };
  }
  if (node.operator === ts.SyntaxKind.PlusToken) {
    return {
      kind: "number",
      value: node.operand.text,
      sourceText: node.getText(sourceFile),
    };
  }
  return null;
}

function isSignedUnaryOperand(node: ts.NumericLiteral): boolean {
  const parent = node.parent;
  if (!ts.isPrefixUnaryExpression(parent) || parent.operand !== node) return false;
  return (
    parent.operator === ts.SyntaxKind.MinusToken || parent.operator === ts.SyntaxKind.PlusToken
  );
}

// import/require/export module specifiers are not magic values worth deduping. This
// covers static `import`/`export ... from`, `require(...)`, dynamic `import(...)`,
// and `import Foo = require(...)` (the import-equals-require form).
function isModuleSpecifier(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isImportDeclaration(parent) && parent.moduleSpecifier === node) return true;
  if (ts.isExportDeclaration(parent) && parent.moduleSpecifier === node) return true;
  if (ts.isExternalModuleReference(parent) && parent.expression === node) return true;
  if (
    ts.isCallExpression(parent) &&
    isRequireOrImportCall(parent) &&
    parent.arguments[0] === node
  ) {
    return true;
  }
  return false;
}

function isRequireOrImportCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(callee) && callee.text === "require";
}

// A string sitting in the first argument of a describe/it/test/bench call is a test
// title, not a shared constant. Best-effort by callee name (we do not type-check).
function isTestTitlePosition(node: ts.Node): boolean {
  const parent = node.parent;
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) return false;
  const callee = parent.expression;
  if (ts.isIdentifier(callee)) return TEST_TITLE_CALLEES.has(callee.text);
  // describe.each / it.skip style: callee is a property access on the title fn.
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    return TEST_TITLE_CALLEES.has(callee.expression.text);
  }
  return false;
}

function shapeEntry(
  filePath: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  literal: LiteralValue,
): ShapeEntry<LiteralShapeExtra> {
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return {
    canonicalKey: `literal:${literal.kind}:${literal.value}`,
    label: literal.kind === "string" ? JSON.stringify(literal.value) : literal.value,
    filePath,
    startLine,
    endLine,
    extra: { literalKind: literal.kind, value: literal.value },
  };
}
