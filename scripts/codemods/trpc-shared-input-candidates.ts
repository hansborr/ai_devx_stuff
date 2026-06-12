import type { CallExpression, SourceFile, VariableStatement } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";

import type { SharedSchemaCodemodCandidate } from "./lib/trpc-shared-schema.js";
import {
  assertSafeSchemaIdentifier,
  collectSchemaCallCandidates,
  fail as failWithName,
  isReferenceIdentifier,
  isZObjectCall,
  procedureNameForSchemaCall,
  propertyCallMethod,
  propertyCallObject,
  SHARED_SCHEMA_PREFIX,
} from "./lib/trpc-shared-schema.js";

const CODEMOD_NAME = "trpc-shared-input";
const INPUT_SCHEMA_SUFFIX = "InputSchema";
const STRUCTURAL_METHODS = new Set(["extend", "merge", "and", "or"]);

type Candidate = SharedSchemaCodemodCandidate;

function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

function isStrictZObjectExpression(node: Node): boolean {
  if (!Node.isCallExpression(node) || propertyCallMethod(node) !== "strict") return false;
  const object = propertyCallObject(node);
  return object ? isZObjectCall(object) : false;
}

function structuralCombinator(node: Node): string | undefined {
  const calls = [node, ...node.getDescendantsOfKind(SyntaxKind.CallExpression)];
  for (const current of calls) {
    if (!Node.isCallExpression(current)) continue;
    const method = propertyCallMethod(current);
    if (method && STRUCTURAL_METHODS.has(method)) return method;
  }
  return undefined;
}

function sharedInputRootName(node: Node): string | undefined {
  if (Node.isIdentifier(node)) return node.getText();
  if (!Node.isCallExpression(node)) return undefined;
  const method = propertyCallMethod(node);
  if (method !== "optional" && method !== "describe") return undefined;
  const object = propertyCallObject(node);
  return object ? sharedInputRootName(object) : undefined;
}

function isImportedSharedInput(argument: Node, sharedImports: Set<string>): boolean {
  const sharedRoot = sharedInputRootName(argument);
  return Boolean(sharedRoot && sharedImports.has(sharedRoot));
}

function constInputCandidate(
  inputCall: CallExpression,
  argument: Node,
  constSchemas: Map<string, VariableStatement>,
): Candidate {
  const schemaName = argument.getText();
  const constStatement = constSchemas.get(schemaName);
  if (!constStatement) {
    fail(`${schemaName} is not a supported top-level z.object(...).strict() const schema.`);
  }
  const declaration = constStatement.getDeclarations()[0];
  if (!declaration) fail(`${schemaName} is not a supported const schema.`);
  const initializer = declaration.getInitializer();
  if (!initializer || !isStrictZObjectExpression(initializer)) {
    fail(`${schemaName} is not initialized to z.object(...).strict().`);
  }
  return {
    kind: "const",
    schemaName,
    schemaCall: inputCall,
    schemaExpression: initializer,
    schemaText: initializer.getText(),
    constStatement,
  };
}

function inlineInputCandidate(inputCall: CallExpression, argument: Node): Candidate | undefined {
  if (!isStrictZObjectExpression(argument)) return undefined;
  const name = procedureNameForSchemaCall(inputCall);
  if (!name) fail("Could not derive a schema name for inline .input(...) shape.");
  assertSafeSchemaIdentifier(CODEMOD_NAME, name);
  return {
    kind: "inline",
    schemaName: `${name}${INPUT_SCHEMA_SUFFIX}`,
    schemaCall: inputCall,
    schemaExpression: argument,
    schemaText: argument.getText(),
  };
}

function resolveInputCandidate(
  inputCall: CallExpression,
  constSchemas: Map<string, VariableStatement>,
  sharedImports: Set<string>,
): Candidate | undefined {
  const argument = inputCall.getArguments()[0];
  if (!argument) fail(".input(...) call has no argument.");

  if (isImportedSharedInput(argument, sharedImports)) return undefined;

  const combinator = structuralCombinator(argument);
  if (combinator) fail(`Unsupported .${combinator}(...) input shape. Move it manually.`);

  if (Node.isIdentifier(argument)) {
    return constInputCandidate(inputCall, argument, constSchemas);
  }

  const inlineCandidate = inlineInputCandidate(inputCall, argument);
  if (inlineCandidate) return inlineCandidate;

  fail(`Unsupported .input(...) shape: ${argument.getText()}.`);
}

export function collectInputCandidates(sourceFile: SourceFile): Candidate[] {
  return collectSchemaCallCandidates(
    sourceFile,
    "input",
    SHARED_SCHEMA_PREFIX,
    resolveInputCandidate,
  );
}

export function inputTypeNameForSchema(schemaName: string): string {
  if (!schemaName.endsWith(INPUT_SCHEMA_SUFFIX)) {
    fail(
      `${schemaName} does not end with InputSchema; move it manually so the input type name is explicit.`,
    );
  }
  const base = schemaName.slice(0, -INPUT_SCHEMA_SUFFIX.length);
  return `${base.slice(0, 1).toUpperCase()}${base.slice(1)}Input`;
}

function isInputCallArgument(identifier: Node, inputCall: CallExpression): boolean {
  return identifier === inputCall.getArguments()[0];
}

export function assertConstSchemaIsOnlyInputReference(
  candidate: Candidate,
  sourceFile: SourceFile,
): void {
  if (!candidate.constStatement) return;
  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier.getText() !== candidate.schemaName) continue;
    if (!isReferenceIdentifier(identifier)) continue;
    if (isInputCallArgument(identifier, candidate.schemaCall)) continue;
    fail(
      `${candidate.schemaName} has references outside the migrated .input(...) call; move it manually.`,
    );
  }
}
