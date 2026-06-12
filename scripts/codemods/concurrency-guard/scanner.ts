import path from "node:path";

import { type Project, type SourceFile, SyntaxKind } from "ts-morph";

import { delegateCall } from "./ast.js";
import { DIRECT_WRITE_SUGGESTIONS } from "./constants.js";
import { helperShapeFindings } from "./helper-shapes.js";
import { isExcludedPath, isMutationHelperPath, rawTxClientAllowed } from "./paths.js";
import type { DelegateCall, Finding } from "./types.js";

function rawImportFindings(sourceFile: SourceFile, relativePath: string): Finding[] {
  if (rawTxClientAllowed(relativePath)) return [];
  const findings: Finding[] = [];
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (!importDeclaration.getModuleSpecifierValue().endsWith("/prisma-types.js")) continue;
    for (const namedImport of importDeclaration.getNamedImports()) {
      if (namedImport.getName() !== "RawTxClient") continue;
      findings.push({
        category: "raw-tx-boundary",
        file: relativePath,
        line: namedImport.getStartLineNumber(),
        message: "RawTxClient import is outside the restricted mutation-helper boundary.",
        suggestion:
          "Move raw gated writes behind packages/server/src/utils/*-mutations.ts; see docs/guides/add-race-sensitive-mutation.md#add-a-race-sensitive-mutation.",
        target: "RawTxClient",
        verdict: "ERROR",
      });
    }
  }
  return findings;
}

function directWriteFindings(sourceFile: SourceFile, relativePath: string): Finding[] {
  if (isMutationHelperPath(relativePath)) return [];
  const findings: Finding[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const target = delegateCall(call);
    if (!target) continue;
    findings.push({
      category: "direct-gated-write",
      file: relativePath,
      line: call.getStartLineNumber(),
      message:
        "Direct gated delegate write found. This checker uses receiver-name matching, so aliases/destructuring may need manual review.",
      suggestion:
        DIRECT_WRITE_SUGGESTIONS.get(target.delegate) ??
        "Route race-sensitive writes through the documented helper boundary; see docs/CONCURRENCY.md.",
      target: `${target.delegate}.${target.method}`,
      verdict: "ERROR",
    });
  }
  return findings;
}

function helperMutatorTargets(sourceFile: SourceFile, relativePath: string): DelegateCall[] {
  if (!isMutationHelperPath(relativePath)) return [];
  const targets: DelegateCall[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const target = delegateCall(call);
    if (target) targets.push(target);
  }
  return targets;
}

export function scanFile(project: Project, root: string, relativePath: string): Finding[] {
  if (isExcludedPath(relativePath)) return [];
  const sourceFile = project.addSourceFileAtPath(path.join(root, relativePath));
  return [
    ...rawImportFindings(sourceFile, relativePath),
    ...directWriteFindings(sourceFile, relativePath),
    ...helperShapeFindings(helperMutatorTargets(sourceFile, relativePath), relativePath),
  ];
}
