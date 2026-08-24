import type { SourceFile } from "ts-morph";

import { moduleSource } from "./codemod-imports.js";
import { rewriteAllowedSharedImportSource } from "./trpc-shared-schema-paths.js";
import { type ImportBinding, SHARED_SCHEMA_PREFIX } from "./trpc-shared-schema-types.js";

export function collectSharedSchemaValueImports(
  sourceFile: SourceFile,
  sourcePrefix = SHARED_SCHEMA_PREFIX,
): Set<string> {
  const imports = new Set<string>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const source = moduleSource(importDeclaration);
    if (importDeclaration.isTypeOnly()) continue;
    if (!source.startsWith(sourcePrefix)) continue;
    for (const specifier of importDeclaration.getNamedImports()) {
      imports.add(specifier.getAliasNode()?.getText() ?? specifier.getName());
    }
  }
  return imports;
}

export function collectAllowlistedRouterImports(
  codemodName: string,
  sourceFile: SourceFile,
  targetSource: string,
): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (importDeclaration.isTypeOnly()) continue;
    const dependencySource = rewriteAllowedSharedImportSource(
      codemodName,
      moduleSource(importDeclaration),
      targetSource,
    );
    if (!dependencySource) continue;
    for (const specifier of importDeclaration.getNamedImports()) {
      if (specifier.isTypeOnly()) continue;
      const imported = specifier.getName();
      const local = specifier.getAliasNode()?.getText() ?? imported;
      bindings.set(local, { imported, local, targetSource: dependencySource });
    }
  }
  return bindings;
}
