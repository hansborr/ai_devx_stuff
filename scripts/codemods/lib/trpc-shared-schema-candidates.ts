import path from "node:path";

import {
  type CallExpression,
  Node,
  type PropertyAssignment,
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
  VariableDeclarationKind,
  type VariableStatement,
} from "ts-morph";

import { CodemodError } from "./codemod-errors.js";
import { createProject } from "./codemod-project.js";
import { collectSharedSchemaValueImports } from "./trpc-shared-schema-imports.js";
import { discoverRouterFiles } from "./trpc-shared-schema-paths.js";
import {
  ROUTER_ROOT,
  type SharedSchemaCodemodCandidate,
  type SharedSchemaDiscoveryResult,
} from "./trpc-shared-schema-types.js";

function isProcedureSchemaCall(callExpression: CallExpression, methodName: string): boolean {
  const expression = callExpression.getExpression();
  return Node.isPropertyAccessExpression(expression) && expression.getName() === methodName;
}

export function propertyCallMethod(callExpression: CallExpression): string | undefined {
  const expression = callExpression.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  return expression.getName();
}

export function propertyCallObject(callExpression: CallExpression): Node | undefined {
  const expression = callExpression.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  return expression.getExpression();
}

export function isZObjectCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return false;
  return expression.getName() === "object" && expression.getExpression().getText() === "z";
}

function propertyAssignmentName(propertyAssignment: PropertyAssignment): string | undefined {
  const nameNode = propertyAssignment.getNameNode();
  if (
    Node.isIdentifier(nameNode) ||
    Node.isStringLiteral(nameNode) ||
    Node.isNumericLiteral(nameNode)
  ) {
    return Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : nameNode.getText();
  }
  return undefined;
}

function variableDeclarationName(declaration: VariableDeclaration): string | undefined {
  const nameNode = declaration.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
}

export function procedureNameForSchemaCall(schemaCall: CallExpression): string | undefined {
  for (const ancestor of schemaCall.getAncestors()) {
    if (Node.isPropertyAssignment(ancestor)) return propertyAssignmentName(ancestor);
    if (Node.isVariableDeclaration(ancestor)) return variableDeclarationName(ancestor);
  }
  return undefined;
}

function getTopLevelConstSchemas(sourceFile: SourceFile): Map<string, VariableStatement> {
  const declarations = new Map<string, VariableStatement>();
  for (const statement of sourceFile.getStatements()) {
    if (!Node.isVariableStatement(statement)) continue;
    const declarationKind = statement.getDeclarationKind();
    const variables = statement.getDeclarations();
    if (declarationKind !== VariableDeclarationKind.Const || variables.length !== 1) continue;
    const variable = variables[0];
    if (!variable) continue;
    const nameNode = variable.getNameNode();
    if (Node.isIdentifier(nameNode)) declarations.set(nameNode.getText(), statement);
  }
  return declarations;
}

export function collectSchemaCallCandidates<TCandidate extends SharedSchemaCodemodCandidate>(
  sourceFile: SourceFile,
  methodName: string,
  sharedSourcePrefix: string,
  resolveCandidate: (
    schemaCall: CallExpression,
    constSchemas: Map<string, VariableStatement>,
    sharedImports: Set<string>,
  ) => TCandidate | undefined,
): TCandidate[] {
  const constSchemas = getTopLevelConstSchemas(sourceFile);
  const sharedImports = collectSharedSchemaValueImports(sourceFile, sharedSourcePrefix);
  const candidates: TCandidate[] = [];
  for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isProcedureSchemaCall(callExpression, methodName)) continue;
    const candidate = resolveCandidate(callExpression, constSchemas, sharedImports);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function codemodErrorReason(codemodName: string, error: CodemodError): string {
  const prefix = `${codemodName} codemod: `;
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
}

export function discoverSharedSchemaCandidates(
  codemodName: string,
  root: string,
  collectCandidates: (sourceFile: SourceFile) => SharedSchemaCodemodCandidate[],
): SharedSchemaDiscoveryResult[] {
  const project = createProject();
  const results: SharedSchemaDiscoveryResult[] = [];
  for (const relativeRouterPath of discoverRouterFiles(root)) {
    const routerFile = project.addSourceFileAtPath(path.join(root, relativeRouterPath));
    try {
      const candidates = collectCandidates(routerFile);
      if (candidates.length > 0) {
        results.push({ candidateCount: candidates.length, relativeRouterPath });
      }
    } catch (error) {
      if (error instanceof CodemodError) {
        results.push({
          candidateCount: 0,
          error: codemodErrorReason(codemodName, error),
          relativeRouterPath,
        });
        continue;
      }
      throw error;
    }
  }
  return results;
}

export function reportSharedSchemaDiscovery(
  codemodName: string,
  schemaKind: "input" | "output",
  results: SharedSchemaDiscoveryResult[],
): void {
  if (results.length === 0) {
    console.log(
      `${codemodName} codemod: no router-local ${schemaKind} schemas found under ${ROUTER_ROOT}.`,
    );
    return;
  }
  for (const result of results) {
    if (result.error) {
      console.log(
        `${codemodName} codemod: check ${result.relativeRouterPath}: unsupported (${result.error})`,
      );
      continue;
    }
    console.log(
      `${codemodName} codemod: check ${result.relativeRouterPath}: ${String(result.candidateCount)} candidate(s).`,
    );
  }
}
