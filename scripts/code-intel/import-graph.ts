import type { CallExpression, ExportDeclaration, ImportDeclaration, SourceFile } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";

import { isTestFile } from "./test-files.js";
import type { ImportEdge, ImportGraph, Via } from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

type EdgeCandidate = {
  edges: ImportEdge[];
  from: string;
  resolver: WorkspaceResolver;
  runtime: boolean;
  specifier: string;
  via: Via;
};

export function buildImportGraph(
  sourceFiles: SourceFile[],
  resolver: WorkspaceResolver,
): ImportGraph {
  const incoming = new Map<string, ImportEdge[]>();

  for (const sourceFile of sourceFiles) {
    const from = resolver.relative(sourceFile.getFilePath());
    for (const edge of collectImportEdges(sourceFile, resolver, from)) {
      const edges = incoming.get(edge.to) ?? [];
      edges.push(edge);
      incoming.set(edge.to, edges);
    }
  }

  for (const edges of incoming.values()) {
    edges.sort(compareEdges);
  }

  return { incoming };
}

export function collectImportEdges(
  sourceFile: SourceFile,
  resolver: WorkspaceResolver,
  from: string,
): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const mockedSpecifiers = isTestFile(from)
    ? collectViMockSpecifiers(sourceFile)
    : new Set<string>();

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const specifier = importDeclaration.getModuleSpecifierValue();
    if (mockedSpecifiers.has(specifier)) continue;
    addResolvedEdge({
      edges,
      from,
      resolver,
      runtime: importDeclarationHasRuntimeEdge(importDeclaration),
      specifier,
      via: "direct",
    });
  }

  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue();
    if (!specifier) continue;
    addResolvedEdge({
      edges,
      from,
      resolver,
      runtime: exportDeclarationHasRuntimeEdge(exportDeclaration),
      specifier,
      via: "re-export",
    });
  }

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    if (node.getExpression().getKind() !== SyntaxKind.ImportKeyword) return;
    const specifier = literalFirstArgument(node);
    if (!specifier) return;
    addResolvedEdge({ edges, from, resolver, runtime: true, specifier, via: "dynamic" });
  });

  return uniqueEdges(edges);
}

export function importDeclarationHasRuntimeEdge(
  importDeclaration: ImportDeclaration,
): boolean {
  if (importDeclaration.isTypeOnly()) return false;
  if (importDeclaration.getDefaultImport() || importDeclaration.getNamespaceImport()) return true;
  const namedImports = importDeclaration.getNamedImports();
  if (namedImports.length === 0) return true;
  return namedImports.some((specifier) => !specifier.isTypeOnly());
}

export function exportDeclarationHasRuntimeEdge(
  exportDeclaration: ExportDeclaration,
): boolean {
  if (exportDeclaration.isTypeOnly()) return false;
  if (exportDeclaration.getNamespaceExport()) return true;
  const namedExports = exportDeclaration.getNamedExports();
  if (namedExports.length === 0) return true;
  return namedExports.some((specifier) => !specifier.isTypeOnly());
}

export function addResolvedEdge(candidate: EdgeCandidate): void {
  const to = candidate.resolver.resolveModule(candidate.specifier, candidate.from);
  if (!to || to === candidate.from) return;
  candidate.edges.push({
    from: candidate.from,
    runtime: candidate.runtime,
    to,
    via: candidate.via,
  });
}

export function collectViMockSpecifiers(sourceFile: SourceFile): Set<string> {
  const specifiers = new Set<string>();
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expression = node.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) return;
    if (expression.getExpression().getText() !== "vi" || expression.getName() !== "mock") return;
    const specifier = literalFirstArgument(node);
    if (specifier) specifiers.add(specifier);
  });
  return specifiers;
}

export function literalFirstArgument(callExpression: CallExpression): string | undefined {
  const firstArgument = callExpression.getArguments()[0];
  if (!firstArgument) return undefined;
  if (Node.isStringLiteral(firstArgument) || Node.isNoSubstitutionTemplateLiteral(firstArgument)) {
    return firstArgument.getLiteralText();
  }
  return undefined;
}

export function uniqueEdges(edges: ImportEdge[]): ImportEdge[] {
  const unique = new Map<string, ImportEdge>();
  for (const edge of edges) {
    const key = `${edge.from}\0${edge.to}\0${edge.via}`;
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, edge);
      continue;
    }
    if (edge.runtime && !previous.runtime) unique.set(key, edge);
  }
  return [...unique.values()];
}

function compareEdges(left: ImportEdge, right: ImportEdge): number {
  const fileComparison = left.from.localeCompare(right.from, "en");
  if (fileComparison !== 0) return fileComparison;
  return left.via.localeCompare(right.via, "en");
}
