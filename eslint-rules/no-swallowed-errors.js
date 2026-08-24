// @ts-check

import { parentOf, unwrapChain } from "./ast-helpers.js";
import { resolveDeclaredVariable } from "./binding-resolution.js";
import { belongsToCatch, nodesMaySharePath } from "./no-swallowed-errors-paths.js";

/**
 * Catch blocks must preserve observable failure semantics. Keep this narrow:
 * named error handlers and non-console recovery paths remain domain decisions.
 */

const CONSOLE_METHODS = new Set(["debug", "error", "log", "warn"]);

/**
 * @typedef {object} CatchAnalysis
 * @property {import('estree').CatchClause} node
 * @property {Set<import('eslint').Scope.Variable>} variables
 * @property {import('estree').CallExpression[]} caughtErrorLogs
 * @property {import('estree').ReturnStatement[]} fallbackReturns
 * @property {import('estree').ThrowStatement[]} caughtErrorThrows
 */

/** @param {import('estree').MemberExpression} node */
function staticMemberName(node) {
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (node.computed && node.property.type === "Literal") return String(node.property.value);
  return undefined;
}

/** @param {import('estree').CallExpression} node */
function consoleCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;
  if (callee.object.type !== "Identifier" || callee.object.name !== "console") return false;
  return CONSOLE_METHODS.has(staticMemberName(callee) ?? "");
}

/** @param {import('estree').Statement} statement */
function directConsoleCall(statement) {
  if (statement.type !== "ExpressionStatement") return false;
  const expression = statement.expression;
  return expression.type === "CallExpression" && consoleCall(expression) ? expression : false;
}

/** @param {import('estree').Statement} statement */
function isExecutableStatement(statement) {
  if (statement.type === "EmptyStatement") return false;
  if (statement.type !== "ExpressionStatement") return true;
  const expression = statement.expression;
  if (expression.type === "Identifier" || expression.type === "Literal") return false;
  return !(
    expression.type === "UnaryExpression" &&
    expression.operator === "void" &&
    (expression.argument.type === "Identifier" || expression.argument.type === "Literal")
  );
}

/** @param {import('estree').Node | null | undefined} node */
function isFalseLiteral(node) {
  return node?.type === "Literal" && node.value === false;
}

/** @param {import('estree').Expression} node */
function isPromiseRejectCall(node) {
  const expression = unwrapChain(node);
  if (expression.type !== "CallExpression") return false;
  const callee = unwrapChain(expression.callee);
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Promise" &&
    staticMemberName(callee) === "reject"
  );
}

/**
 * @param {import('estree').Node} node
 * @param {Set<import('eslint').Scope.Variable>} variables
 * @param {import('eslint').SourceCode} sourceCode
 */
function nodeReferencesVariable(node, variables, sourceCode) {
  const [nodeStart, nodeEnd] = sourceCode.getRange(node);
  for (const variable of variables) {
    for (const reference of variable.references) {
      const [referenceStart, referenceEnd] = sourceCode.getRange(reference.identifier);
      if (referenceStart >= nodeStart && referenceEnd <= nodeEnd) return true;
    }
  }
  return false;
}

/**
 * @param {import('estree').ReturnStatement} statement
 * @param {Set<import('eslint').Scope.Variable>} variables
 * @param {import('eslint').SourceCode} sourceCode
 */
function returnsExplicitFailure(statement, variables, sourceCode) {
  const argument = statement.argument;
  if (argument === null) return returnFollowsExitCodeAssignment(statement);
  if (isFalseLiteral(argument) || isPromiseRejectCall(argument)) return true;
  if (argument.type !== "ObjectExpression") return false;

  return argument.properties.some((property) =>
    propertySignalsExplicitFailure(property, variables, sourceCode),
  );
}

/** @param {import('estree').Statement} statement */
function setsProcessExitCode(statement) {
  if (statement.type !== "ExpressionStatement") return false;
  const expression = statement.expression;
  if (expression.type !== "AssignmentExpression") return false;
  const target = expression.left;
  return (
    target.type === "MemberExpression" &&
    target.object.type === "Identifier" &&
    target.object.name === "process" &&
    staticMemberName(target) === "exitCode"
  );
}

/** @param {import('estree').ReturnStatement} statement */
function returnFollowsExitCodeAssignment(statement) {
  const parent = parentOf(statement);
  if (parent?.type !== "BlockStatement") return false;
  const statementIndex = parent.body.findIndex((candidate) => candidate === statement);
  return parent.body.slice(0, statementIndex).some(setsProcessExitCode);
}

/** @param {import('estree').Property} property */
function staticPropertyKey(property) {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal") return String(property.key.value);
  return undefined;
}

/**
 * @param {import('estree').Property | import('estree').SpreadElement} property
 * @param {Set<import('eslint').Scope.Variable>} variables
 * @param {import('eslint').SourceCode} sourceCode
 */
function propertySignalsExplicitFailure(property, variables, sourceCode) {
  if (property.type !== "Property") return false;
  const key = staticPropertyKey(property);
  if (key === "ok" || key === "success") return isFalseLiteral(property.value);
  if (key !== "error" && key !== "cause") return false;
  return nodeReferencesVariable(property.value, variables, sourceCode);
}

/**
 * @param {import('estree').CatchClause} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function caughtErrorVariables(node, sourceCode) {
  /** @type {Set<import('eslint').Scope.Variable>} */
  const variables = new Set();
  if (node.param?.type !== "Identifier") return variables;
  const variable = resolveDeclaredVariable(sourceCode.getScope(node.param), node.param);
  if (variable !== undefined) variables.add(variable);
  return variables;
}

/**
 * @param {import('estree').VariableDeclarator} declarator
 * @param {Set<import('eslint').Scope.Variable>} variables
 * @param {import('eslint').SourceCode} sourceCode
 */
function recordDerivedVariable(declarator, variables, sourceCode) {
  if (declarator.id.type !== "Identifier" || declarator.init === null) return;
  if (!nodeReferencesVariable(declarator.init, variables, sourceCode)) return;
  const variable = resolveDeclaredVariable(sourceCode.getScope(declarator.id), declarator.id);
  if (variable !== undefined) variables.add(variable);
}

/**
 * @param {import('estree').CallExpression} node
 * @param {CatchAnalysis} analysis
 * @param {import('eslint').SourceCode} sourceCode
 */
function recordConsoleCall(node, analysis, sourceCode) {
  if (!consoleCall(node)) return;
  const logsCaughtError = node.arguments.some((argument) =>
    nodeReferencesVariable(argument, analysis.variables, sourceCode),
  );
  if (logsCaughtError) analysis.caughtErrorLogs.push(node);
}

/**
 * @param {CatchAnalysis} analysis
 * @param {import('eslint').SourceCode} sourceCode
 */
function completedSemantics(analysis, sourceCode) {
  const pairSharesPath = (exitNode) =>
    analysis.caughtErrorLogs.some((logNode) => nodesMaySharePath(logNode, exitNode, sourceCode));
  return {
    returnsFallback: analysis.fallbackReturns.some(pairSharesPath),
    rethrowsCaughtError: analysis.caughtErrorThrows.some(pairSharesPath),
  };
}

/**
 * @param {{ returnsFallback: boolean, rethrowsCaughtError: boolean }} semantics
 * @param {boolean} checkLoggedRethrow
 * @param {boolean} checkLoggedFallback
 */
function loggedMessageId(semantics, checkLoggedRethrow, checkLoggedFallback) {
  if (checkLoggedRethrow && semantics.rethrowsCaughtError) return "loggedRethrow";
  if (checkLoggedFallback && semantics.returnsFallback) return "loggedFallback";
  return undefined;
}

/**
 * @param {readonly import('estree').Statement[]} statements
 * @param {{ returnsFallback: boolean, rethrowsCaughtError: boolean }} semantics
 * @param {{ empty: boolean, fallback: boolean, rethrow: boolean, swallowed: boolean }} checks
 */
function catchMessageId(statements, semantics, checks) {
  if (statements.length === 0) return checks.empty ? "emptyCatch" : undefined;
  const logged = loggedMessageId(semantics, checks.rethrow, checks.fallback);
  if (logged !== undefined) return logged;
  const onlyConsoleCalls = statements.every((statement) => directConsoleCall(statement) !== false);
  if (checks.swallowed && onlyConsoleCalls) return "swallowedError";
  return undefined;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow catch blocks that erase or double-report failure semantics",
      principle:
        "Catch blocks must keep failures observable without hiding them behind normal-looking fallbacks or logging the same error twice.",
      category: "behavior",
      pairedGuide: "docs/guides/local-eslint-rules.md",
      repairKind: "manual",
    },
    messages: {
      emptyCatch:
        "Why: This catch block silently discards the failure; a comment alone does not make the failure observable. How to fix: Use a correctly coded `TRPCError` in tRPC-adjacent code or translate the domain failure at the boundary per docs/authorization.md; elsewhere propagate the error or return the surface's typed failure result.",
      loggedFallback:
        "Why: This catch block logs and then returns a fallback, hiding the failure behind normal-looking output. How to fix: Remove the console call. In tRPC-adjacent code, throw a correctly coded `TRPCError` or translate at the boundary per docs/authorization.md; elsewhere return the surface's typed failure result and let its owning boundary log.",
      loggedRethrow:
        "Why: This catch block logs and rethrows the same failure, so reporting boundaries can emit it twice. How to fix: Remove the console call and let the reporting boundary log once. In tRPC-adjacent code, translate once to a correctly coded `TRPCError` per docs/authorization.md.",
      swallowedError:
        "Why: This catch block only logs to console, so callers cannot detect the failure. How to fix: Remove the console call and propagate the failure. In tRPC-adjacent code, throw a correctly coded `TRPCError` or translate at the boundary per docs/authorization.md; elsewhere return the surface's typed failure result.",
    },
    schema: [
      {
        type: "object",
        properties: {
          checkEmptyCatch: { type: "boolean" },
          checkLoggedFallback: { type: "boolean" },
          checkLoggedRethrow: { type: "boolean" },
          checkSwallowedError: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {};
    const checkEmptyCatch = options.checkEmptyCatch !== false;
    const checkLoggedFallback = options.checkLoggedFallback !== false;
    const checkLoggedRethrow = options.checkLoggedRethrow !== false;
    const checkSwallowedError = options.checkSwallowedError !== false;

    /** @type {CatchAnalysis[]} */
    const catchStack = [];

    /** @param {import('estree').Node} node */
    function currentCatch(node) {
      const analysis = catchStack.at(-1);
      return analysis !== undefined && belongsToCatch(node, analysis.node) ? analysis : undefined;
    }

    return {
      CatchClause(node) {
        catchStack.push({
          node,
          variables: caughtErrorVariables(node, context.sourceCode),
          caughtErrorLogs: [],
          fallbackReturns: [],
          caughtErrorThrows: [],
        });
      },
      "CatchClause:exit"() {
        const analysis = catchStack.pop();
        if (analysis === undefined) return;
        const statements = analysis.node.body.body.filter(isExecutableStatement);
        const messageId = catchMessageId(
          statements,
          completedSemantics(analysis, context.sourceCode),
          {
            empty: checkEmptyCatch,
            fallback: checkLoggedFallback,
            rethrow: checkLoggedRethrow,
            swallowed: checkSwallowedError,
          },
        );
        if (messageId !== undefined) {
          context.report({ node: analysis.node.body, messageId });
        }
      },
      CallExpression(node) {
        const analysis = currentCatch(node);
        if (analysis !== undefined) recordConsoleCall(node, analysis, context.sourceCode);
      },
      ReturnStatement(node) {
        const analysis = currentCatch(node);
        if (
          analysis !== undefined &&
          !returnsExplicitFailure(node, analysis.variables, context.sourceCode)
        ) {
          analysis.fallbackReturns.push(node);
        }
      },
      ThrowStatement(node) {
        const analysis = currentCatch(node);
        if (analysis !== undefined) {
          const rethrowsCaughtError = nodeReferencesVariable(
            node.argument,
            analysis.variables,
            context.sourceCode,
          );
          if (rethrowsCaughtError) analysis.caughtErrorThrows.push(node);
        }
      },
      VariableDeclarator(node) {
        const analysis = currentCatch(node);
        if (analysis !== undefined) {
          recordDerivedVariable(node, analysis.variables, context.sourceCode);
        }
      },
    };
  },
};
