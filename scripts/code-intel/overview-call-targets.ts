import type { CallExpression, Node, Project } from "ts-morph";
import { Node as MorphNode, SyntaxKind } from "ts-morph";

import { unwrapExpression } from "./declaration-utils.js";
import { DEFAULT_OVERVIEW_CONVENTIONS, type OverviewConventions } from "./overview-conventions.js";

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

export function collectOverviewCallContext(
  sourceFile: SourceFile,
  conventions: OverviewConventions = DEFAULT_OVERVIEW_CONVENTIONS,
): OverviewCallContext {
  return {
    imports: collectImportedCallTargets(sourceFile, conventions),
    localCallBodies: localCallableBodies(sourceFile),
  };
}

export function collectOverviewCallTargets(
  resolver: Node | undefined,
  context: OverviewCallContext,
  conventions: OverviewConventions = DEFAULT_OVERVIEW_CONVENTIONS,
): OverviewCallTargets {
  const calls = resolverCalls(resolver, context.localCallBodies);
  return {
    serviceCalls: collectServiceCalls(calls, context.imports),
    broadcasts: collectBroadcasts(calls, context.imports, conventions),
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

function collectImportedCallTargets(
  sourceFile: SourceFile,
  conventions: OverviewConventions,
): ImportedCallTargets {
  const targets: ImportedCallTargets = new Map();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (importDeclaration.isTypeOnly()) continue;
    const source = importDeclaration.getModuleSpecifierValue();
    const defaultImport = importDeclaration.getDefaultImport();
    if (defaultImport) addImportTarget(targets, defaultImport.getText(), source, conventions);
    for (const specifier of importDeclaration.getNamedImports()) {
      if (specifier.isTypeOnly()) continue;
      const localName = specifier.getAliasNode()?.getText() ?? specifier.getName();
      addImportTarget(targets, localName, source, conventions);
    }
  }
  return targets;
}

function addImportTarget(
  targets: Map<string, ImportMatch>,
  name: string,
  source: string,
  conventions: OverviewConventions,
): void {
  const existing = targets.get(name) ?? { broadcast: false, service: false };
  targets.set(name, {
    broadcast: existing.broadcast || isBroadcastImport(source, name, conventions),
    service:
      existing.service || includesAnyFragment(source, conventions.serviceImportPathFragments),
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

function collectBroadcasts(
  calls: CallExpression[],
  imports: ImportedCallTargets,
  conventions: OverviewConventions,
): string[] {
  return sortedUnique(
    calls.flatMap((call) => {
      const socketEmit = socketEmitName(call, conventions);
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

function socketEmitName(
  call: CallExpression,
  conventions: OverviewConventions,
): string | undefined {
  const emitMethod = conventions.socketEmitMethod;
  const callee = call.getExpression();
  if (MorphNode.isIdentifier(callee) && callee.getText() === emitMethod) return emitMethod;
  if (!MorphNode.isPropertyAccessExpression(callee) || callee.getName() !== emitMethod) {
    return undefined;
  }
  return isSocketEmitChainTarget(callee.getExpression(), conventions) ? emitMethod : undefined;
}

function isSocketEmitChainTarget(target: Node, conventions: OverviewConventions): boolean {
  const { socketRoomMethod, socketServerIdentifier } = conventions;
  if (MorphNode.isIdentifier(target)) return target.getText() === socketServerIdentifier;
  if (!MorphNode.isCallExpression(target)) return false;
  const callee = target.getExpression();
  if (MorphNode.isIdentifier(callee)) return callee.getText() === socketRoomMethod;
  if (!MorphNode.isPropertyAccessExpression(callee) || callee.getName() !== socketRoomMethod) {
    return false;
  }
  const owner = callee.getExpression();
  return MorphNode.isIdentifier(owner) && owner.getText() === socketServerIdentifier;
}

function isBroadcastImport(
  source: string,
  name: string,
  conventions: OverviewConventions,
): boolean {
  if (isBroadcastHelperName(name, conventions)) return true;
  return includesAnyFragment(source, conventions.broadcastImportPathFragments);
}

function isBroadcastHelperName(name: string, conventions: OverviewConventions): boolean {
  return (
    conventions.broadcastNamePrefixes.some((prefix) => name.startsWith(prefix)) ||
    conventions.broadcastNameSuffixes.some((suffix) => name.endsWith(suffix))
  );
}

function includesAnyFragment(source: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => source.includes(fragment));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}
