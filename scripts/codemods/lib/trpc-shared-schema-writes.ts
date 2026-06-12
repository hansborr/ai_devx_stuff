import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type SourceFile, SyntaxKind } from "ts-morph";

import { propertyCallMethod } from "./trpc-shared-schema-candidates.js";
import { isReferenceIdentifier } from "./trpc-shared-schema-identifiers.js";
import { ensureNamedImport, sortImportBlocks } from "./trpc-shared-schema-imports.js";
import {
  fail,
  type SharedSchemaCodemodCandidate,
  type WritePlan,
} from "./trpc-shared-schema-types.js";

export function appendSharedSchemaExports(
  targetFile: SourceFile,
  candidates: SharedSchemaCodemodCandidate[],
  typeNameForSchema: (schemaName: string) => string,
): void {
  const statements = candidates.map((candidate) => {
    const typeName = typeNameForSchema(candidate.schemaName);
    return `export const ${candidate.schemaName} = ${candidate.schemaText};\n\nexport type ${typeName} = z.infer<typeof ${candidate.schemaName}>;`;
  });
  targetFile.addStatements(`\n${statements.join("\n\n")}`);
}

function replaceInlineSchemaReference(
  candidate: SharedSchemaCodemodCandidate,
  codemodName: string,
): void {
  if (candidate.kind !== "inline") return;
  const argument = candidate.schemaCall.getArguments()[0];
  if (!argument) {
    const method = propertyCallMethod(candidate.schemaCall) ?? "schema";
    fail(codemodName, `.${method}(...) call has no argument.`);
  }
  argument.replaceWithText(candidate.schemaName);
}

function removeConstSchemaStatement(candidate: SharedSchemaCodemodCandidate): void {
  if (candidate.constStatement) candidate.constStatement.remove();
}

function addMovedSchemaImport(
  routerFile: SourceFile,
  targetSource: string,
  candidates: SharedSchemaCodemodCandidate[],
): void {
  ensureNamedImport(
    routerFile,
    targetSource,
    candidates.map((candidate) => ({
      imported: candidate.schemaName,
      local: candidate.schemaName,
    })),
  );
}

export function rewriteRouterSharedSchemaReferences({
  candidates,
  codemodName,
  removeLocalNames,
  routerFile,
  targetSource,
}: {
  candidates: SharedSchemaCodemodCandidate[];
  codemodName: string;
  removeLocalNames: Iterable<string>;
  routerFile: SourceFile;
  targetSource: string;
}): void {
  for (const candidate of candidates) replaceInlineSchemaReference(candidate, codemodName);
  for (const candidate of candidates) removeConstSchemaStatement(candidate);
  addMovedSchemaImport(routerFile, targetSource, candidates);
  for (const localName of new Set(removeLocalNames)) removeUnusedNamedImport(routerFile, localName);
  removeUnusedNamedImport(routerFile, "z");
}

function hasReference(sourceFile: SourceFile, name: string): boolean {
  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier.getText() === name && isReferenceIdentifier(identifier)) return true;
  }
  return false;
}

function removeImportDeclarationIfEmpty(
  importDeclaration: ReturnType<SourceFile["getImportDeclarations"]>[number],
): void {
  if (importDeclaration.getNamedImports().length > 0) return;
  if (importDeclaration.getDefaultImport()) return;
  importDeclaration.remove();
}

function removeUnusedNamedImport(sourceFile: SourceFile, localName: string): void {
  if (hasReference(sourceFile, localName)) return;
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    for (const specifier of importDeclaration.getNamedImports()) {
      const local = specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (local !== localName) continue;
      specifier.remove();
      removeImportDeclarationIfEmpty(importDeclaration);
      return;
    }
  }
}

function runEslintImportFix(codemodName: string, root: string, filePaths: string[]): void {
  if (!existsSync(path.join(root, "eslint.config.js"))) return;
  const relativeFiles = filePaths.map((filePath) => path.relative(root, filePath));
  const result = spawnSync(
    "bun",
    [
      "eslint",
      "--fix",
      "--fix-type",
      "layout",
      "--rule",
      "simple-import-sort/imports:error",
      "--rule",
      "simple-import-sort/exports:error",
      ...relativeFiles,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (!result.error && result.status === 0) return;
  const details = [result.error?.message, result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  const detailSuffix = details ? `\n${details}` : "";
  console.warn(`${codemodName} codemod: eslint import fix failed.${detailSuffix}`);
}

export function writeOrPreviewFiles(
  codemodName: string,
  root: string,
  plans: WritePlan[],
  dryRun: boolean,
): void {
  const sortedPlans = plans.map((plan) => ({
    path: plan.path,
    text: sortImportBlocks(plan.text, plan.path),
  }));
  if (dryRun) {
    for (const plan of sortedPlans) {
      console.log(
        `${codemodName} codemod: dry-run would write ${path.relative(root, plan.path)} (${String(plan.text.length)} bytes).`,
      );
    }
    return;
  }
  for (const plan of sortedPlans) {
    mkdirSync(path.dirname(plan.path), { recursive: true });
    writeFileSync(plan.path, plan.text);
  }
  runEslintImportFix(
    codemodName,
    root,
    sortedPlans.map((plan) => plan.path),
  );
}
