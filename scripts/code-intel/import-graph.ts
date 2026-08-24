import type { CallExpression, SourceFile } from "ts-morph";
import { Node } from "ts-morph";

import { extractModuleRefs, type ModuleRefKind } from "../lib/ts-module-refs.js";
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

const VIA_BY_KIND: Record<ModuleRefKind, Via> = {
  import: "direct",
  "export-from": "re-export",
  "dynamic-import": "dynamic",
};

function collectImportEdges(
  sourceFile: SourceFile,
  resolver: WorkspaceResolver,
  from: string,
): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const mockedSpecifiers = isTestFile(from)
    ? collectViMockSpecifiers(sourceFile)
    : new Set<string>();

  // Drop to the compiler API at the pure-syntax seam: the shared kernel
  // (scripts/lib/ts-module-refs.ts) classifies edges on the compiler node.
  for (const ref of extractModuleRefs(sourceFile.compilerNode)) {
    if (ref.kind === "import" && mockedSpecifiers.has(ref.specifier)) continue;
    addResolvedEdge({
      edges,
      from,
      resolver,
      runtime: !ref.typeOnly,
      specifier: ref.specifier,
      via: VIA_BY_KIND[ref.kind],
    });
  }

  return uniqueEdges(edges);
}

function addResolvedEdge(candidate: EdgeCandidate): void {
  const to = candidate.resolver.resolveModule(candidate.specifier, candidate.from);
  if (!to || to === candidate.from) return;
  candidate.edges.push({
    from: candidate.from,
    runtime: candidate.runtime,
    to,
    via: candidate.via,
  });
}

function collectViMockSpecifiers(sourceFile: SourceFile): Set<string> {
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

function literalFirstArgument(callExpression: CallExpression): string | undefined {
  const firstArgument = callExpression.getArguments()[0];
  if (!firstArgument) return undefined;
  if (Node.isStringLiteral(firstArgument) || Node.isNoSubstitutionTemplateLiteral(firstArgument)) {
    return firstArgument.getLiteralText();
  }
  return undefined;
}

function uniqueEdges(edges: ImportEdge[]): ImportEdge[] {
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
