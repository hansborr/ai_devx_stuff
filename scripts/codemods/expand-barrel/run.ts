import { existsSync } from "node:fs";
import path from "node:path";

import { Node, type Project, type SourceFile } from "ts-morph";

import {
  createProject,
  moduleSource,
  sortImportBlocks,
  writeOrPreviewFiles,
} from "../lib/trpc-shared-schema.js";
import { contextForKnown } from "./barrel-context.js";
import { KNOWN_PACKAGE_BARRELS, CODEMOD_NAME } from "./constants.js";
import { buildSymbolMap } from "./export-map.js";
import { transformSourceFile } from "./import-replacement.js";
import { mockCallInfo, staticString } from "./mocks.js";
import { discoverPackageFiles, specifierMatchesKnownBarrel } from "./paths.js";
import type { BarrelContext } from "./types.js";
import type { WritePlan } from "../lib/trpc-shared-schema.js";

export function runOne(context: BarrelContext, root: string, dryRun: boolean): void {
  const project = createProject();
  const symbolMap = buildSymbolMap(project, context);
  const plans: WritePlan[] = [];

  for (const filePath of discoverPackageFiles(root)) {
    const sourceFile = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
    const changed = transformSourceFile(context, symbolMap, sourceFile, root);
    if (!changed) continue;
    plans.push({
      path: filePath,
      text: sortImportBlocks(sourceFile.getFullText(), filePath),
    });
  }

  if (plans.length === 0) {
    console.log(
      `${CODEMOD_NAME} codemod: no expandable imports found for ${context.relativeBarrelPath}.`,
    );
    return;
  }
  writeOrPreviewFiles(CODEMOD_NAME, root, plans, dryRun);
  console.log(
    `${CODEMOD_NAME} codemod: expanded ${plans.length.toString()} file(s) for ${context.relativeBarrelPath}.`,
  );
}

export function runAll(root: string, dryRun: boolean): void {
  for (const known of KNOWN_PACKAGE_BARRELS) {
    const context = contextForKnown(root, known);
    if (!existsSync(context.barrelPath)) {
      console.log(`${CODEMOD_NAME} codemod: skipped missing ${context.relativeBarrelPath}.`);
      continue;
    }
    runOne(context, root, dryRun);
  }
}

function reportCheckFinding(root: string, filePath: string, line: number, message: string): void {
  console.log(`${CODEMOD_NAME} codemod: ${path.relative(root, filePath)}:${String(line)} ${message}`);
}

function checkImportDeclarations(root: string, sourceFile: SourceFile): number {
  const filePath = sourceFile.getFilePath();
  let findings = 0;
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const source = moduleSource(importDeclaration);
    if (!specifierMatchesKnownBarrel(filePath, source, root)) continue;
    findings += 1;
    reportCheckFinding(
      root,
      filePath,
      importDeclaration.getStartLineNumber(),
      `imports ${source}.`,
    );
  }
  return findings;
}

function checkExportDeclarations(root: string, sourceFile: SourceFile): number {
  const filePath = sourceFile.getFilePath();
  let findings = 0;
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const source = exportDeclaration.getModuleSpecifierValue();
    if (!source || !specifierMatchesKnownBarrel(filePath, source, root)) continue;
    findings += 1;
    reportCheckFinding(
      root,
      filePath,
      exportDeclaration.getStartLineNumber(),
      `re-exports ${source}.`,
    );
  }
  return findings;
}

function checkMockCalls(root: string, sourceFile: SourceFile): number {
  const filePath = sourceFile.getFilePath();
  let findings = 0;
  for (const call of sourceFile.getDescendants().filter(Node.isCallExpression)) {
    const info = mockCallInfo(call);
    if (!info) continue;
    const specifier = staticString(call.getArguments()[0]);
    if (!specifier || !specifierMatchesKnownBarrel(filePath, specifier, root)) continue;
    findings += 1;
    reportCheckFinding(
      root,
      filePath,
      call.getStartLineNumber(),
      `${info.framework}.${info.method} references ${specifier}.`,
    );
  }
  return findings;
}

function checkSourceFile(project: Project, root: string, filePath: string): number {
  const sourceFile = project.addSourceFileAtPath(filePath);
  return (
    checkImportDeclarations(root, sourceFile) +
    checkExportDeclarations(root, sourceFile) +
    checkMockCalls(root, sourceFile)
  );
}

export function runCheck(root: string): void {
  const project = createProject();
  let findings = 0;
  for (const filePath of discoverPackageFiles(root)) {
    findings += checkSourceFile(project, root, filePath);
  }
  if (findings === 0) console.log(`${CODEMOD_NAME} codemod: no package barrel consumers found.`);
}
