// Deterministic, parser-only branch-point metric for the birth/current size lens
// (backlog task 45b). It counts AST decision points so the birth-size-delta lens can
// say whether a file arrived branchy or grew branchy over time. It is INTENTIONALLY
// NOT ESLint cyclomatic complexity: there is no `+1` base, no type information, and no
// ESLint run. It is a raw count of control-flow forks reached by walking the syntax
// tree once, so the same source always yields the same number on any machine.
//
// Counted decision points (each adds one to the enclosing scope):
//   - `if` (an `else if` is itself an `IfStatement`, so each arm counts)
//   - `for`, `for..in`, `for..of`, `while`, `do..while`
//   - `switch` `case` clauses (the `default` clause is NOT counted)
//   - `catch` clauses
//   - ternary `?:` (`ConditionalExpression`)
//   - the short-circuiting operators `&&`, `||`, and `??`
//
// Optional chaining (`?.`) is deliberately excluded; it short-circuits on nullish
// receivers but is not a readability fork worth a branch point here.

import { ts } from "ts-morph";

import { scriptKindFor } from "./ts-source-util.js";

export const BRANCH_POINTS_METRIC_NAME = "branch-points";
export const BRANCH_POINTS_METRIC_VERSION = 1;
export const BRANCH_POINTS_METRIC_DEFINITION =
  "count of AST decision points (if, for/for-in/for-of, while, do-while, switch case " +
  "clauses, catch, ternary ?:, and the && / || / ?? operators); deterministic parser-only " +
  "count, not ESLint cyclomatic complexity and not type-aware";

// The synthetic scope that owns branch points outside any function-like node (a
// top-level `if`, a module-level `&&` guard). Kept in the function list so the per-scope
// counts always sum to `total`.
export const MODULE_SCOPE_NAME = "(module top-level)";

export type BranchPointFunction = {
  readonly name: string;
  readonly line: number; // 1-based start line of the function (or 1 for the module bucket)
  readonly branchPoints: number;
};

export type BranchPointMetrics = {
  readonly total: number;
  // Every scope that contributed at least one branch point, sorted by branch points
  // descending then by line. The module bucket appears as MODULE_SCOPE_NAME when it
  // contributes. Sum of `branchPoints` equals `total`.
  readonly functions: readonly BranchPointFunction[];
};

export type BranchPointResult =
  | { readonly ok: true; readonly metrics: BranchPointMetrics }
  | { readonly ok: false; readonly reason: string };

// Parser seam so tests can drive the failure branch; production always uses the default
// `ts.createSourceFile` parse, which mirrors parsed-source-cache.ts.
export type BranchPointSourceParser = (filePath: string, source: string) => ts.SourceFile;

// Measurement seam the birth-size-delta lens injects so tests can drive parse-failure
// degradations; production uses `measureBranchPoints` directly.
export type BranchPointMeasurer = (filePath: string, source: string) => BranchPointResult;

type MutableScope = {
  readonly name: string;
  readonly line: number;
  branchPoints: number;
};

export function measureBranchPoints(
  filePath: string,
  source: string,
  parse: BranchPointSourceParser = defaultParseSourceFile,
): BranchPointResult {
  try {
    return { ok: true, metrics: countBranchPoints(parse(filePath, source)) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function countBranchPoints(sourceFile: ts.SourceFile): BranchPointMetrics {
  const moduleScope: MutableScope = { name: MODULE_SCOPE_NAME, line: 1, branchPoints: 0 };
  const scopes: MutableScope[] = [moduleScope];
  const functionScopes: MutableScope[] = [];

  const visit = (node: ts.Node): void => {
    const scope = functionScopeFor(sourceFile, node);
    if (scope !== null) {
      scopes.push(scope);
      functionScopes.push(scope);
    }
    if (isBranchPoint(node)) {
      const current = scopes[scopes.length - 1];
      if (current !== undefined) current.branchPoints += 1;
    }
    ts.forEachChild(node, visit);
    if (scope !== null) scopes.pop();
  };
  visit(sourceFile);

  const all = [moduleScope, ...functionScopes];
  const total = all.reduce((sum, scope) => sum + scope.branchPoints, 0);
  const functions = all
    .filter((scope) => scope.branchPoints > 0)
    .sort(compareScopes)
    .map((scope) => ({ name: scope.name, line: scope.line, branchPoints: scope.branchPoints }));
  return { total, functions };
}

function compareScopes(left: MutableScope, right: MutableScope): number {
  return (
    right.branchPoints - left.branchPoints ||
    left.line - right.line ||
    left.name.localeCompare(right.name, "en")
  );
}

// Statement/clause kinds counted as one branch point. Kept as a Set so adding a kind
// does not grow the predicate's cyclomatic complexity (the metric this module measures).
const BRANCH_POINT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);

function isBranchPoint(node: ts.Node): boolean {
  if (BRANCH_POINT_KINDS.has(node.kind)) return true;
  return ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind);
}

function isLogicalOperator(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function functionScopeFor(sourceFile: ts.SourceFile, node: ts.Node): MutableScope | null {
  if (!isFunctionLike(node)) return null;
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  return { name: functionName(node), line, branchPoints: 0 };
}

function isFunctionLike(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

function functionName(node: FunctionNode): string {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node) && node.name !== undefined) {
    return nameText(node.name);
  }
  if (ts.isFunctionExpression(node) && node.name !== undefined) return nameText(node.name);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent)) return nameText(parent.name);
  if (ts.isPropertyAssignment(parent)) return nameText(parent.name);
  if (ts.isPropertyDeclaration(parent)) return nameText(parent.name);
  return "(anonymous)";
}

function nameText(name: ts.BindingName | ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return "(computed)";
}

function defaultParseSourceFile(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
}
