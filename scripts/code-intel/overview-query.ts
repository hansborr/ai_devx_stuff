import type { CallExpression, Expression, Node, ObjectLiteralExpression, Project } from "ts-morph";
import { Node as MorphNode } from "ts-morph";

import { CodeIntelError } from "./errors.js";
import {
  collectOverviewCallContext,
  collectOverviewCallTargets,
  type OverviewCallContext,
} from "./overview-call-targets.js";
import { getProjectSourceFile } from "./source-project.js";
import type { OverviewProcedureKind, OverviewResult } from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

type BuilderCall = { call: CallExpression; method: string };

const PROCEDURE_KINDS = new Set<string>(["mutation", "query", "subscription"]);

export function queryOverview(
  project: Project,
  resolver: WorkspaceResolver,
  file: string,
  candidateTests: string[] = [],
): OverviewResult[] {
  const sourceFile = getProjectSourceFile(project, resolver.mapFileToSource(file));
  const sourceRelative = resolver.relative(sourceFile.getFilePath());
  const routerObject = exportedRouterObject(sourceFile);
  if (!routerObject) {
    throw new CodeIntelError(
      `overview: ${sourceRelative} does not export a tRPC router via router({ ... }).`,
    );
  }

  const locals = localInitializers(sourceFile);
  const callContext = collectOverviewCallContext(sourceFile);
  const results = routerObject
    .getProperties()
    .flatMap((property) => overviewForProperty(property, locals, callContext, candidateTests));
  if (results.length === 0) {
    throw new CodeIntelError(
      `overview: ${sourceRelative} does not contain direct tRPC procedures in router({ ... }).`,
    );
  }
  return results;
}

function exportedRouterObject(
  sourceFile: ReturnType<Project["getSourceFileOrThrow"]>,
): ObjectLiteralExpression | undefined {
  for (const statement of sourceFile.getVariableStatements()) {
    if (!statement.isExported()) continue;
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      const routerObject = routerObjectFromExpression(initializer);
      if (routerObject) return routerObject;
    }
  }
  return undefined;
}

function routerObjectFromExpression(expression: Expression): ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression);
  if (!MorphNode.isCallExpression(unwrapped)) return undefined;
  const callee = unwrapped.getExpression();
  if (!MorphNode.isIdentifier(callee) || callee.getText() !== "router") return undefined;
  const firstArg = unwrapped.getArguments()[0];
  if (!firstArg || !MorphNode.isObjectLiteralExpression(firstArg)) return undefined;
  return firstArg;
}

function overviewForProperty(
  property: Node,
  locals: Map<string, Expression>,
  callContext: OverviewCallContext,
  candidateTests: string[],
): OverviewResult[] {
  const procedure = procedureName(property);
  if (!procedure) return [];
  const expression = procedureExpression(property, locals);
  if (!expression) return [];
  const chain = analyzeProcedureChain(expression);
  if (!chain) return [];
  const targets = collectOverviewCallTargets(chain.resolver, callContext);

  return [
    {
      procedure,
      kind: chain.kind,
      authHelper: chain.authHelper,
      inputSchema: schemaArgument(chain.calls.find((call) => call.method === "input")?.call),
      outputSchema: schemaArgument(chain.calls.find((call) => call.method === "output")?.call),
      serviceCalls: targets.serviceCalls,
      broadcasts: targets.broadcasts,
      candidateTests,
    },
  ];
}

function procedureName(property: Node): string | undefined {
  if (MorphNode.isPropertyAssignment(property)) return propertyNameText(property.getNameNode());
  if (MorphNode.isShorthandPropertyAssignment(property)) return property.getName();
  return undefined;
}

function propertyNameText(name: Node): string | undefined {
  if (MorphNode.isIdentifier(name)) return name.getText();
  if (MorphNode.isStringLiteral(name) || MorphNode.isNumericLiteral(name)) {
    return name.getLiteralText();
  }
  return undefined;
}

function procedureExpression(
  property: Node,
  locals: Map<string, Expression>,
): Expression | undefined {
  if (MorphNode.isPropertyAssignment(property)) {
    return resolveLocalAlias(property.getInitializer(), locals);
  }
  if (!MorphNode.isShorthandPropertyAssignment(property)) return undefined;
  const initializer = locals.get(property.getName());
  if (!initializer) return undefined;
  return resolveLocalAlias(initializer, locals);
}

function resolveLocalAlias(
  expression: Expression | undefined,
  locals: Map<string, Expression>,
  seen = new Set<string>(),
): Expression | undefined {
  if (!expression) return undefined;
  const unwrapped = unwrapExpression(expression);
  if (!MorphNode.isIdentifier(unwrapped)) return unwrapped;
  const name = unwrapped.getText();
  if (seen.has(name)) return unwrapped;
  const initializer = locals.get(name);
  if (!initializer) return unwrapped;
  seen.add(name);
  return resolveLocalAlias(initializer, locals, seen);
}

function analyzeProcedureChain(expression: Expression):
  | {
      authHelper: string;
      calls: BuilderCall[];
      kind: OverviewProcedureKind;
      resolver: Node | undefined;
    }
  | undefined {
  const calls: BuilderCall[] = [];
  let current: Node = unwrapExpression(expression);

  while (MorphNode.isCallExpression(current)) {
    const callee = current.getExpression();
    if (!MorphNode.isPropertyAccessExpression(callee)) break;
    calls.push({ call: current, method: callee.getName() });
    current = unwrapExpression(callee.getExpression());
  }

  if (!MorphNode.isIdentifier(current)) return undefined;
  const terminal = calls.find((call) => isProcedureKind(call.method));
  if (!terminal || !isProcedureKind(terminal.method)) return undefined;
  return {
    authHelper: current.getText(),
    calls,
    kind: terminal.method,
    resolver: terminal.call.getArguments()[0],
  };
}

function schemaArgument(call: CallExpression | undefined): string | null {
  if (!call) return null;
  const args = call.getArguments();
  if (args.length !== 1) return null;
  const firstArg = args[0];
  if (!MorphNode.isExpression(firstArg)) return null;
  const arg = unwrapExpression(firstArg);
  if (MorphNode.isIdentifier(arg)) return arg.getText();
  if (isInlineZodObject(arg)) return "inline";
  return null;
}

function isInlineZodObject(expression: Node): boolean {
  if (!MorphNode.isCallExpression(expression)) return false;
  const callee = expression.getExpression();
  if (!MorphNode.isPropertyAccessExpression(callee)) return false;
  const target = callee.getExpression();
  return (
    callee.getName() === "object" && MorphNode.isIdentifier(target) && target.getText() === "z"
  );
}

function localInitializers(
  sourceFile: ReturnType<Project["getSourceFileOrThrow"]>,
): Map<string, Expression> {
  const locals = new Map<string, Expression>();
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    locals.set(declaration.getName(), initializer);
  }
  return locals;
}

function isProcedureKind(method: string): method is OverviewProcedureKind {
  return PROCEDURE_KINDS.has(method);
}

function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    MorphNode.isAsExpression(current) ||
    MorphNode.isNonNullExpression(current) ||
    MorphNode.isParenthesizedExpression(current) ||
    MorphNode.isSatisfiesExpression(current)
  ) {
    current = current.getExpression();
  }
  return current;
}
