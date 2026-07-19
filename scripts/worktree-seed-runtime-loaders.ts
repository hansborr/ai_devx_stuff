import ts from "typescript";

import {
  expressionCreatesRuntimeLoader,
  expressionIsCreateRequireFactory,
  expressionIsRuntimeLoader,
  nodeModuleSpecifiers,
  type RuntimeLoaderBindings,
  validateKnownLoaderSourceUsage,
} from "./worktree-seed-runtime-loader-validation.js";

interface AliasCandidate {
  readonly initializer: ts.Expression;
  readonly name: ts.BindingName;
}

const importDeclarationIsRuntime = (node: ts.ImportDeclaration): boolean => {
  const clause = node.importClause;
  if (clause === undefined) return true;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
  if (clause.name !== undefined) return true;
  const namedBindings = clause.namedBindings;
  if (namedBindings === undefined || ts.isNamespaceImport(namedBindings)) return true;
  return (
    namedBindings.elements.length === 0 ||
    namedBindings.elements.some((element) => !element.isTypeOnly)
  );
};

const exportDeclarationIsRuntime = (node: ts.ExportDeclaration): boolean => {
  if (node.isTypeOnly) return false;
  const exportClause = node.exportClause;
  if (exportClause === undefined || ts.isNamespaceExport(exportClause)) return true;
  return (
    exportClause.elements.length === 0 ||
    exportClause.elements.some((element) => !element.isTypeOnly)
  );
};

const addBinding = (bindings: Set<string>, name: ts.BindingName): boolean => {
  if (!ts.isIdentifier(name) || bindings.has(name.text)) return false;
  bindings.add(name.text);
  return true;
};

const collectCreateRequireClause = (
  clause: ts.ImportClause,
  bindings: RuntimeLoaderBindings,
): void => {
  if (clause.name !== undefined) bindings.createRequireNamespaces.add(clause.name.text);
  const namedBindings = clause.namedBindings;
  if (namedBindings === undefined) return;
  if (ts.isNamespaceImport(namedBindings)) {
    bindings.createRequireNamespaces.add(namedBindings.name.text);
    return;
  }
  for (const element of namedBindings.elements) {
    if (!element.isTypeOnly && (element.propertyName ?? element.name).text === "createRequire") {
      bindings.createRequireFactories.add(element.name.text);
    }
  }
};

const collectCreateRequireImport = (
  statement: ts.Statement,
  bindings: RuntimeLoaderBindings,
): void => {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
    return;
  }
  if (!nodeModuleSpecifiers.has(statement.moduleSpecifier.text)) return;
  const clause = statement.importClause;
  if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return;
  collectCreateRequireClause(clause, bindings);
};

const collectCreateRequireImportEquals = (
  statement: ts.Statement,
  bindings: RuntimeLoaderBindings,
): void => {
  if (!ts.isImportEqualsDeclaration(statement) || statement.isTypeOnly) return;
  const reference = statement.moduleReference;
  if (!ts.isExternalModuleReference(reference)) return;
  const specifier = reference.expression;
  if (ts.isStringLiteralLike(specifier) && nodeModuleSpecifiers.has(specifier.text)) {
    bindings.createRequireNamespaces.add(statement.name.text);
  }
};

const aliasCandidate = (node: ts.Node): AliasCandidate | undefined => {
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
    return { initializer: node.initializer, name: node.name };
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left)
  ) {
    return { initializer: node.right, name: node.left };
  }
  return undefined;
};

const collectAliasCandidate = (
  candidate: AliasCandidate,
  bindings: RuntimeLoaderBindings,
): boolean => {
  let changed = false;
  if (expressionIsCreateRequireFactory(candidate.initializer, bindings)) {
    changed = addBinding(bindings.createRequireFactories, candidate.name) || changed;
  }
  if (
    expressionIsRuntimeLoader(candidate.initializer, bindings) ||
    expressionCreatesRuntimeLoader(candidate.initializer, bindings)
  ) {
    changed = addBinding(bindings.loaders, candidate.name) || changed;
  }
  return changed;
};

const collectRuntimeLoaderAliases = (
  sourceFile: ts.SourceFile,
  bindings: RuntimeLoaderBindings,
): void => {
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      const candidate = aliasCandidate(node);
      if (candidate !== undefined) changed = collectAliasCandidate(candidate, bindings) || changed;
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
};

const runtimeLoaderBindings = (sourceFile: ts.SourceFile): RuntimeLoaderBindings => {
  const bindings: RuntimeLoaderBindings = {
    createRequireFactories: new Set<string>(),
    createRequireNamespaces: new Set<string>(),
    loaders: new Set<string>(),
  };
  for (const statement of sourceFile.statements) {
    collectCreateRequireImport(statement, bindings);
    collectCreateRequireImportEquals(statement, bindings);
  }
  collectRuntimeLoaderAliases(sourceFile, bindings);
  return bindings;
};

const importEqualsRuntimeSpecifier = (
  node: ts.ImportEqualsDeclaration,
): ts.Expression | undefined => {
  if (node.isTypeOnly || !ts.isExternalModuleReference(node.moduleReference)) return undefined;
  return node.moduleReference.expression;
};

const runtimeCallSpecifier = (
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  bindings: RuntimeLoaderBindings,
): ts.Expression | undefined => {
  const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const runtimeLoader = expressionIsRuntimeLoader(node.expression, bindings);
  if (!dynamicImport && !runtimeLoader) return undefined;
  if (node.arguments.length !== 1) {
    throw new Error(`runtime loader in ${sourceFile.fileName} requires exactly one argument`);
  }
  return node.arguments[0];
};

export interface RuntimeImportSpecifierOptions {
  /**
   * How to treat a runtime import whose specifier is not a static string
   * literal. The worktree-seed contract keeps the historical `"throw"` default
   * (a seed closure must be fully statically resolvable); `"skip"` is for
   * closure walks over code that intentionally loads runtime-configured inputs
   * (e.g. `await import(pathToFileURL(configPath).href)`), which a static walk
   * cannot and should not resolve.
   */
  readonly nonStaticSpecifiers?: "throw" | "skip";
}

export const runtimeImportSpecifiers = (
  sourceFile: ts.SourceFile,
  options: RuntimeImportSpecifierOptions = {},
): readonly string[] => {
  const nonStaticSpecifiers = options.nonStaticSpecifiers ?? "throw";
  const specifiers: string[] = [];
  const bindings = runtimeLoaderBindings(sourceFile);
  validateKnownLoaderSourceUsage(sourceFile, bindings);
  const record = (node: ts.Expression | undefined): void => {
    if (node === undefined) return;
    if (!ts.isStringLiteralLike(node)) {
      if (nonStaticSpecifiers === "skip") return;
      throw new Error(
        `runtime import in ${sourceFile.fileName} must use a static string specifier`,
      );
    }
    specifiers.push(node.text);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && importDeclarationIsRuntime(node))
      record(node.moduleSpecifier);
    if (ts.isExportDeclaration(node) && exportDeclarationIsRuntime(node))
      record(node.moduleSpecifier);
    if (ts.isCallExpression(node)) record(runtimeCallSpecifier(node, sourceFile, bindings));
    if (ts.isImportEqualsDeclaration(node)) record(importEqualsRuntimeSpecifier(node));
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
};
