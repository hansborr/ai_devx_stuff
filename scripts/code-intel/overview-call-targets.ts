import type { CallExpression, Node, Project } from "ts-morph";
import { Node as MorphNode, SyntaxKind } from "ts-morph";

import { unwrapExpression } from "./declaration-utils.js";

type SourceFile = ReturnType<Project["getSourceFileOrThrow"]>;

type ImportedCallTargets = Map<string, ImportMatch>;

type ImportMatch = { broadcast: boolean; service: boolean };
type LocalCallBodies = Map<string, Node>;

export type OverviewCallContext = {
  imports: ImportedCallTargets;
  localCallBodies: LocalCallBodies;
};

export type OverviewCallTargets = {
  broadcasts: string[];
  serviceCalls: string[];
};

export function collectOverviewCallContext(sourceFile: SourceFile): OverviewCallContext {
  return {
    imports: collectImportedCallTargets(sourceFile),
    localCallBodies: localCallableBodies(sourceFile),
  };
}

export function collectOverviewCallTargets(
  resolver: Node | undefined,
  context: OverviewCallContext,
): OverviewCallTargets {
  const calls = resolverCalls(resolver, context.localCallBodies);
  return {
    serviceCalls: collectServiceCalls(calls, context.imports),
    broadcasts: collectBroadcasts(calls, context.imports),
  };
}

function resolverCalls(
  resolver: Node | undefined,
  localCallBodies: LocalCallBodies,
): CallExpression[] {
  const body = resolverBody(resolver);
  if (!body) return [];
  return collectCallsFromBody(body, localCallBodies, new Set());
}

function collectCallsFromBody(
  body: Node,
  localCallBodies: LocalCallBodies,
  seenLocalCalls: Set<string>,
): CallExpression[] {
  const calls = MorphNode.isCallExpression(body) ? [body] : [];
  const collected = [...calls, ...body.getDescendantsOfKind(SyntaxKind.CallExpression)];
  const expanded = [...collected];
  for (const call of collected) {
    const localCallName = identifierCallName(call);
    const localBody = localCallName ? localCallBodies.get(localCallName) : undefined;
    if (!localCallName || !localBody || seenLocalCalls.has(localCallName)) continue;
    seenLocalCalls.add(localCallName);
    expanded.push(...collectCallsFromBody(localBody, localCallBodies, seenLocalCalls));
  }
  return expanded;
}

function resolverBody(resolver: Node | undefined): Node | undefined {
  if (!resolver) return undefined;
  if (!MorphNode.isExpression(resolver)) return undefined;
  const unwrapped = unwrapExpression(resolver);
  if (MorphNode.isArrowFunction(unwrapped)) return unwrapped.getBody();
  if (MorphNode.isFunctionExpression(unwrapped)) return unwrapped.getBody();
  return undefined;
}

function collectImportedCallTargets(sourceFile: SourceFile): ImportedCallTargets {
  const targets: ImportedCallTargets = new Map();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (importDeclaration.isTypeOnly()) continue;
    const source = importDeclaration.getModuleSpecifierValue();
    const defaultImport = importDeclaration.getDefaultImport();
    if (defaultImport) addImportTarget(targets, defaultImport.getText(), source);
    for (const specifier of importDeclaration.getNamedImports()) {
      if (specifier.isTypeOnly()) continue;
      const localName = specifier.getAliasNode()?.getText() ?? specifier.getName();
      addImportTarget(targets, localName, source);
    }
  }
  return targets;
}

function addImportTarget(targets: Map<string, ImportMatch>, name: string, source: string): void {
  const existing = targets.get(name) ?? { broadcast: false, service: false };
  targets.set(name, {
    broadcast: existing.broadcast || isBroadcastImport(source, name),
    service: existing.service || source.includes("/services/"),
  });
}

function localCallableBodies(sourceFile: SourceFile): LocalCallBodies {
  const localCallBodies: LocalCallBodies = new Map();
  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    const body = declaration.getBody();
    if (name && body) localCallBodies.set(name, body);
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();
    const body = resolverBody(declaration.getInitializer());
    if (body) localCallBodies.set(name, body);
  }
  return localCallBodies;
}

function collectServiceCalls(calls: CallExpression[], imports: ImportedCallTargets): string[] {
  return sortedUnique(
    calls.flatMap((call) => {
      const importedCall = importedCallName(call, imports);
      return importedCall?.match.service ? [importedCall.name] : [];
    }),
  );
}

function collectBroadcasts(calls: CallExpression[], imports: ImportedCallTargets): string[] {
  return sortedUnique(
    calls.flatMap((call) => {
      const socketEmit = socketEmitName(call);
      if (socketEmit) return [socketEmit];
      const importedCall = importedCallName(call, imports);
      return importedCall?.match.broadcast ? [importedCall.name] : [];
    }),
  );
}

function importedCallName(
  call: CallExpression,
  imports: ImportedCallTargets,
): { match: ImportMatch; name: string } | undefined {
  const callee = call.getExpression();
  if (MorphNode.isIdentifier(callee)) {
    const match = imports.get(callee.getText());
    return match ? { match, name: callee.getText() } : undefined;
  }
  return undefined;
}

function identifierCallName(call: CallExpression): string | undefined {
  const callee = call.getExpression();
  return MorphNode.isIdentifier(callee) ? callee.getText() : undefined;
}

function socketEmitName(call: CallExpression): string | undefined {
  const callee = call.getExpression();
  if (MorphNode.isIdentifier(callee) && callee.getText() === "emit") return "emit";
  if (!MorphNode.isPropertyAccessExpression(callee) || callee.getName() !== "emit") {
    return undefined;
  }
  return isSocketIoEmitTarget(callee.getExpression()) ? "emit" : undefined;
}

function isSocketIoEmitTarget(target: Node): boolean {
  if (MorphNode.isIdentifier(target)) return target.getText() === "io";
  if (!MorphNode.isCallExpression(target)) return false;
  const callee = target.getExpression();
  if (MorphNode.isIdentifier(callee)) return callee.getText() === "to";
  if (!MorphNode.isPropertyAccessExpression(callee) || callee.getName() !== "to") return false;
  const owner = callee.getExpression();
  return MorphNode.isIdentifier(owner) && owner.getText() === "io";
}

function isBroadcastImport(source: string, name: string): boolean {
  if (isBroadcastHelperName(name)) return true;
  if (source.includes("/socket/")) return true;
  if (source.includes("/utils/character-campaign")) return true;
  return false;
}

function isBroadcastHelperName(name: string): boolean {
  return name.startsWith("broadcast") || name.startsWith("emit") || name.endsWith("Broadcast");
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}
