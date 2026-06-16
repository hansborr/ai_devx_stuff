import type { CallExpression, SourceFile, VariableStatement } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";

import type { ImportBinding, SharedSchemaCodemodCandidate } from "./lib/trpc-shared-schema.js";
import {
  assertSafeSchemaIdentifier,
  collectSchemaCallCandidates,
  fail as failWithName,
  isReferenceIdentifier,
  isZObjectCall,
  procedureNameForSchemaCall,
  propertyCallMethod,
  propertyCallObject,
  rewriteAllowedSharedImportSource,
  SHARED_SCHEMA_PREFIX,
} from "./lib/trpc-shared-schema.js";

export const CODEMOD_NAME = "trpc-shared-output";
const OUTPUT_SCHEMA_SUFFIX = "OutputSchema";

type Candidate = SharedSchemaCodemodCandidate;

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function isSimpleZObjectExpression(node: Node): boolean {
  if (isZObjectCall(node)) return true;
  if (!Node.isCallExpression(node) || propertyCallMethod(node) !== "strict") return false;
  const object = propertyCallObject(node);
  return object ? isZObjectCall(object) : false;
}

function isSharedSchemaArrayExpression(node: Node, sharedImports: Set<string>): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return false;
  if (expression.getName() !== "array" || expression.getExpression().getText() !== "z") {
    return false;
  }
  const element = node.getArguments()[0];
  return Boolean(element && Node.isIdentifier(element) && sharedImports.has(element.getText()));
}

function isSupportedOutputExpression(node: Node, sharedImports: Set<string>): boolean {
  return isSimpleZObjectExpression(node) || isSharedSchemaArrayExpression(node, sharedImports);
}

function isImportedSharedOutput(argument: Node, sharedImports: Set<string>): boolean {
  return Node.isIdentifier(argument) && sharedImports.has(argument.getText());
}

function constOutputCandidate(
  outputCall: CallExpression,
  argument: Node,
  constSchemas: Map<string, VariableStatement>,
  sharedImports: Set<string>,
): Candidate {
  const schemaName = argument.getText();
  const constStatement = constSchemas.get(schemaName);
  if (!constStatement) {
    fail(`${schemaName} is not a supported top-level output const schema.`);
  }
  const declaration = constStatement.getDeclarations()[0];
  if (!declaration) fail(`${schemaName} is not a supported const schema.`);
  const initializer = declaration.getInitializer();
  if (!initializer || !isSupportedOutputExpression(initializer, sharedImports)) {
    fail(`${schemaName} is not a supported simple output schema.`);
  }
  return {
    kind: "const",
    schemaName,
    schemaCall: outputCall,
    schemaExpression: initializer,
    schemaText: initializer.getText(),
    constStatement,
  };
}

function inlineOutputCandidate(
  outputCall: CallExpression,
  argument: Node,
  sharedImports: Set<string>,
): Candidate | undefined {
  if (!isSupportedOutputExpression(argument, sharedImports)) return undefined;
  const name = procedureNameForSchemaCall(outputCall);
  if (!name) fail("Could not derive a schema name for inline .output(...) shape.");
  assertSafeSchemaIdentifier(CODEMOD_NAME, name);
  return {
    kind: "inline",
    schemaName: `${name}${OUTPUT_SCHEMA_SUFFIX}`,
    schemaCall: outputCall,
    schemaExpression: argument,
    schemaText: argument.getText(),
  };
}

function resolveOutputCandidate(
  outputCall: CallExpression,
  constSchemas: Map<string, VariableStatement>,
  sharedImports: Set<string>,
): Candidate | undefined {
  const argument = outputCall.getArguments()[0];
  if (!argument) fail(".output(...) call has no argument.");

  if (isImportedSharedOutput(argument, sharedImports)) return undefined;

  if (Node.isIdentifier(argument)) {
    return constOutputCandidate(outputCall, argument, constSchemas, sharedImports);
  }

  const inlineCandidate = inlineOutputCandidate(outputCall, argument, sharedImports);
  if (inlineCandidate) return inlineCandidate;

  fail(`Unsupported .output(...) shape: ${argument.getText()}.`);
}

export function collectOutputCandidates(sourceFile: SourceFile): Candidate[] {
  return collectSchemaCallCandidates(
    sourceFile,
    "output",
    SHARED_SCHEMA_PREFIX,
    resolveOutputCandidate,
  );
}

function upperFirst(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function outputTypeNameForSchema(schemaName: string): string {
  if (schemaName.endsWith(OUTPUT_SCHEMA_SUFFIX)) {
    return `${upperFirst(schemaName.slice(0, -OUTPUT_SCHEMA_SUFFIX.length))}Output`;
  }
  for (const suffix of ["ResponseSchema", "ResultSchema", "Schema"]) {
    if (!schemaName.endsWith(suffix)) continue;
    const typeSuffix = suffix.slice(0, -"Schema".length);
    return `${upperFirst(schemaName.slice(0, -suffix.length))}${typeSuffix}`;
  }
  fail(`${schemaName} does not end with a supported schema suffix; move it manually.`);
}

function isOutputCallArgument(identifier: Node, outputCall: CallExpression): boolean {
  return identifier === outputCall.getArguments()[0];
}

export function assertConstSchemaIsOnlyOutputReference(
  candidate: Candidate,
  sourceFile: SourceFile,
): void {
  if (!candidate.constStatement) return;
  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier.getText() !== candidate.schemaName) continue;
    if (!isReferenceIdentifier(identifier)) continue;
    if (isOutputCallArgument(identifier, candidate.schemaCall)) continue;
    fail(
      `${candidate.schemaName} has references outside the migrated .output(...) call; move it manually.`,
    );
  }
}

export function isSelfImport(targetSource: string, binding: ImportBinding): boolean {
  const selfSource = rewriteAllowedSharedImportSource(CODEMOD_NAME, targetSource, targetSource);
  return binding.targetSource === selfSource;
}
