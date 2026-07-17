// @ts-check

const FUNCTION_NODE_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "FunctionExpression",
]);

/** @param {import('estree').Node} node */
export function parentOf(node) {
  const parent = /** @type {import('estree').Node | null | undefined} */ (node.parent);
  return parent ?? undefined;
}

/**
 * @param {import('estree').Node} node
 * @param {import('estree').Node} ancestor
 */
function isDescendantOf(node, ancestor) {
  for (let current = parentOf(node); current !== undefined; current = parentOf(current)) {
    if (current === ancestor) return true;
  }
  return false;
}

/** @param {import('estree').Node} node */
function isFunctionNode(node) {
  return FUNCTION_NODE_TYPES.has(node.type);
}

/**
 * @param {import('estree').Node} node
 * @param {import('estree').CatchClause} catchClause
 */
export function belongsToCatch(node, catchClause) {
  for (let current = parentOf(node); current !== undefined; current = parentOf(current)) {
    if (current === catchClause) return true;
    if (isFunctionNode(current)) return false;
  }
  return false;
}

/**
 * @param {import('estree').Node} node
 * @param {import('estree').BlockStatement} block
 */
function directStatementWithin(node, block) {
  let current = node;
  while (parentOf(current) !== block) {
    const parent = parentOf(current);
    if (parent === undefined) return undefined;
    current = parent;
  }
  return current;
}

/**
 * @param {import('estree').Node} node
 * @param {import('estree').Statement} branch
 */
function branchTerminatesAfter(node, branch) {
  if (branch.type !== "BlockStatement") return false;
  const containingStatement = directStatementWithin(node, branch);
  const statementIndex = branch.body.findIndex((statement) => statement === containingStatement);
  return branch.body
    .slice(statementIndex + 1)
    .some(
      (statement) => statement.type === "ReturnStatement" || statement.type === "ThrowStatement",
    );
}

/**
 * @param {import('estree').Node} node
 * @param {import('estree').IfStatement} statement
 */
function containingIfBranch(node, statement) {
  if (isDescendantOf(node, statement.consequent)) return statement.consequent;
  if (statement.alternate !== null && isDescendantOf(node, statement.alternate)) {
    return statement.alternate;
  }
  return undefined;
}

/**
 * Return false only for syntax-proven mutually exclusive paths: opposite
 * branches, or a branch that returns/throws after the log before a later exit.
 *
 * @param {import('estree').Node} first
 * @param {import('estree').Node} second
 * @param {import('eslint').SourceCode} sourceCode
 */
export function nodesMaySharePath(first, second, sourceCode) {
  const secondStart = sourceCode.getRange(second)[0];
  for (let current = parentOf(first); current !== undefined; current = parentOf(current)) {
    if (current.type !== "IfStatement") continue;
    const firstBranch = containingIfBranch(first, current);
    if (firstBranch === undefined) continue;
    const otherBranch = firstBranch === current.consequent ? current.alternate : current.consequent;
    if (otherBranch !== null && isDescendantOf(second, otherBranch)) return false;
    const ifEnd = sourceCode.getRange(current)[1];
    if (secondStart >= ifEnd && branchTerminatesAfter(first, firstBranch)) return false;
  }
  return true;
}
