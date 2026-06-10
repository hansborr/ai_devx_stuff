import { ts } from "ts-morph";

// The code-shape gate: the snippet must parse with zero syntax diagnostics AND
// contain at least one operative statement. Prose and JSDoc fail the first half
// (`This is a note.` is not two valid statements); bare-identifier or string-only
// blocks fail the second.
export function codeShapedConstruct(snippet: string): string | undefined {
  const sourceFile = ts.createSourceFile(
    "commented-out-snippet.ts",
    snippet,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (parseDiagnosticCount(sourceFile) > 0) return undefined;
  return firstOperative(sourceFile.statements);
}

type ParsedWithDiagnostics = ts.SourceFile & {
  readonly parseDiagnostics?: readonly ts.Diagnostic[];
};

function parseDiagnosticCount(sourceFile: ts.SourceFile): number {
  // type-assertion-boundary: interop - createSourceFile records syntax errors on the internal `parseDiagnostics` field, omitted from the public SourceFile type.
  const withDiagnostics = sourceFile as ParsedWithDiagnostics;
  return withDiagnostics.parseDiagnostics?.length ?? 0;
}

// Statement kinds whose mere presence is operative code. Special-cased kinds
// (return needs a value; labeled/block/expression statements need to be unwrapped)
// are handled in operativeLabel below.
const SIMPLE_STATEMENT_LABELS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.VariableStatement, "variable"],
  [ts.SyntaxKind.FunctionDeclaration, "function"],
  [ts.SyntaxKind.ClassDeclaration, "class"],
  [ts.SyntaxKind.InterfaceDeclaration, "interface"],
  [ts.SyntaxKind.TypeAliasDeclaration, "type-alias"],
  [ts.SyntaxKind.EnumDeclaration, "enum"],
  [ts.SyntaxKind.ModuleDeclaration, "module"],
  [ts.SyntaxKind.ImportDeclaration, "import"],
  [ts.SyntaxKind.ImportEqualsDeclaration, "import"],
  [ts.SyntaxKind.ExportDeclaration, "export"],
  [ts.SyntaxKind.ExportAssignment, "export"],
  [ts.SyntaxKind.IfStatement, "if"],
  [ts.SyntaxKind.ForStatement, "for"],
  [ts.SyntaxKind.ForInStatement, "for"],
  [ts.SyntaxKind.ForOfStatement, "for"],
  [ts.SyntaxKind.WhileStatement, "while"],
  [ts.SyntaxKind.DoStatement, "while"],
  [ts.SyntaxKind.SwitchStatement, "switch"],
  [ts.SyntaxKind.TryStatement, "try"],
  [ts.SyntaxKind.ThrowStatement, "throw"],
]);

// Expression kinds that are operative on their own (a bare expression statement
// that *does* something). A lone identifier, member access, or literal is
// prose-shaped and intentionally absent. Await/delete/yield/update/assignment
// expressions are operand-aware below so keyword-led prose trios like
// `delete user` do not clear the gate merely by parsing as expression statements.
const SIMPLE_EXPRESSION_LABELS: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.CallExpression, "call"],
  [ts.SyntaxKind.NewExpression, "new"],
]);

function firstOperative(statements: ts.NodeArray<ts.Statement>): string | undefined {
  for (const statement of statements) {
    const label = operativeLabel(statement);
    if (label !== undefined) return label;
  }
  return undefined;
}

function operativeLabel(statement: ts.Statement): string | undefined {
  const simple = SIMPLE_STATEMENT_LABELS.get(statement.kind);
  if (simple !== undefined) return simple;
  if (ts.isReturnStatement(statement)) {
    // Bare `return` (a lone keyword) reads as prose; require a returned value.
    return statement.expression === undefined ? undefined : "return";
  }
  if (ts.isLabeledStatement(statement)) return operativeLabel(statement.statement);
  if (ts.isBlock(statement)) return firstOperative(statement.statements);
  if (ts.isExpressionStatement(statement)) return operativeExpressionLabel(statement.expression);
  return undefined;
}

function operativeExpressionLabel(expression: ts.Expression): string | undefined {
  const simple = SIMPLE_EXPRESSION_LABELS.get(expression.kind);
  if (simple !== undefined) return simple;
  const keyword = operativeKeywordExpressionLabel(expression);
  if (keyword !== undefined) return keyword;
  if (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) {
    return operativeUpdateExpressionLabel(expression);
  }
  if (ts.isBinaryExpression(expression)) {
    return operativeAssignmentExpressionLabel(expression);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return operativeExpressionLabel(expression.expression);
  }
  return undefined;
}

function operativeKeywordExpressionLabel(expression: ts.Expression): string | undefined {
  if (ts.isAwaitExpression(expression)) {
    return operativeOperandLabel("await", expression.expression);
  }
  if (ts.isYieldExpression(expression)) {
    const operand = expression.expression;
    return operand === undefined ? undefined : operativeOperandLabel("yield", operand);
  }
  if (ts.isDeleteExpression(expression)) {
    return operativeOperandLabel("delete", expression.expression);
  }
  return undefined;
}

function operativeOperandLabel(label: string, operand: ts.Expression): string | undefined {
  return isBareIdentifierExpression(operand) ? undefined : label;
}

function operativeUpdateExpressionLabel(
  expression: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
): string | undefined {
  if (!isIncrementDecrement(expression)) return undefined;
  return isBareIdentifierExpression(expression.operand) ? undefined : "update";
}

function operativeAssignmentExpressionLabel(expression: ts.BinaryExpression): string | undefined {
  return isAssignment(expression) && isMemberOrElementAccess(expression.left)
    ? "assignment"
    : undefined;
}

function isBareIdentifierExpression(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) {
    return isBareIdentifierExpression(expression.expression);
  }
  return ts.isIdentifier(expression);
}

function isMemberOrElementAccess(expression: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(expression)) {
    return isMemberOrElementAccess(expression.expression);
  }
  if (ts.isNonNullExpression(expression)) {
    return isMemberOrElementAccess(expression.expression);
  }
  return ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression);
}

function isAssignment(expression: ts.BinaryExpression): boolean {
  const operator = expression.operatorToken.kind;
  return operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment;
}

function isIncrementDecrement(
  expression: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
): boolean {
  return (
    expression.operator === ts.SyntaxKind.PlusPlusToken ||
    expression.operator === ts.SyntaxKind.MinusMinusToken
  );
}
