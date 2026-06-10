// duplicate-constants extractor: module-level `const X = <literal>` declarations
// whose initializer is the SAME non-trivial literal value across files — a missed
// shared constant (two agents each hard-coded `const TIMEOUT_MS = 30000`). Keyed on
// the const VALUE and reported with the const names/locations, so it is distinct
// from duplicate-literals (which keys raw literal occurrences anywhere).
//
// Only top-level (module-scope) const declarations with a direct literal (or
// negative-number) initializer are considered; locals, `let`/`var`, and computed
// initializers are out of scope. The same min-length trivial-string filter as
// duplicate-literals applies; numeric constants also use a configurable source
// digit floor (noise filters, not adjudication).

import { ts } from "ts-morph";

import type { ShapeEntry } from "./duplicate-shapes.js";
import { hasMinNumericLiteralDigits } from "./numeric-literal-text.js";
import { scriptKindFor } from "./ts-source-util.js";

export {
  DEFAULT_DUPLICATE_CONSTANTS_MIN_DISTINCT_FILES,
  DEFAULT_DUPLICATE_CONSTANTS_MIN_LENGTH,
  DEFAULT_DUPLICATE_CONSTANTS_MIN_NUMBER_DIGITS,
} from "./duplicate-shapes-config-values.js";

export type ExtractConstantShapesOptions = {
  readonly minLength: number;
  readonly minNumberDigits: number;
};
export type ConstantShapeExtra = {
  readonly constName: string;
  readonly literalKind: "string" | "number";
  readonly value: string;
};

export function extractConstantShapes(
  filePath: string,
  source: string,
  options: ExtractConstantShapesOptions,
): ShapeEntry<ConstantShapeExtra>[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  return extractConstantShapesFrom(filePath, sourceFile, options);
}

export function extractConstantShapesFrom(
  filePath: string,
  sourceFile: ts.SourceFile,
  options: ExtractConstantShapesOptions,
): ShapeEntry<ConstantShapeExtra>[] {
  const entries: ShapeEntry<ConstantShapeExtra>[] = [];
  for (const statement of sourceFile.statements) {
    if (!isModuleLevelConst(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const entry = constantShape(declaration, sourceFile, filePath, options);
      if (entry !== null) entries.push(entry);
    }
  }
  return entries;
}

function isModuleLevelConst(statement: ts.Statement): statement is ts.VariableStatement {
  if (!ts.isVariableStatement(statement)) return false;
  return (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
}

function constantShape(
  declaration: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  filePath: string,
  options: ExtractConstantShapesOptions,
): ShapeEntry<ConstantShapeExtra> | null {
  if (!ts.isIdentifier(declaration.name)) return null;
  const initializer = declaration.initializer;
  if (initializer === undefined) return null;
  const literal = literalValue(initializer, sourceFile);
  if (literal === null) return null;
  if (literal.kind === "string" && literal.value.length < options.minLength) return null;
  if (
    literal.kind === "number" &&
    !hasMinNumericLiteralDigits(literal.sourceText, options.minNumberDigits)
  ) {
    return null;
  }
  return shapeEntry(filePath, sourceFile, declaration, declaration.name.text, literal);
}

type LiteralValue =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: string; readonly sourceText: string };

// A direct literal initializer, or a negated numeric literal (`-1`). Anything else
// (calls, identifiers, objects, template strings with substitutions) is not a flat
// literal constant and is skipped.
function literalValue(node: ts.Expression, sourceFile: ts.SourceFile): LiteralValue | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: "string", value: node.text };
  }
  if (ts.isNumericLiteral(node)) {
    return { kind: "number", value: node.text, sourceText: node.getText(sourceFile) };
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return { kind: "number", value: `-${node.operand.text}`, sourceText: node.getText(sourceFile) };
  }
  return null;
}

function shapeEntry(
  filePath: string,
  sourceFile: ts.SourceFile,
  declaration: ts.VariableDeclaration,
  name: string,
  literal: LiteralValue,
): ShapeEntry<ConstantShapeExtra> {
  const startLine =
    sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(declaration.getEnd()).line + 1;
  return {
    canonicalKey: `const:${literal.kind}:${literal.value}`,
    label: name,
    filePath,
    startLine,
    endLine,
    extra: {
      constName: name,
      literalKind: literal.kind,
      value: literal.value,
    },
  };
}
