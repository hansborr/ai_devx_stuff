import ts from "typescript";

import { collectExportedBindingNames } from "./worktree-seed-runtime-loader-exports.js";
import {
  identifierIsDefinitionOrPropertyName,
  sourceHasRequireShadow,
} from "./worktree-seed-runtime-loader-identifiers.js";

export interface RuntimeLoaderBindings {
  readonly createRequireFactories: Set<string>;
  readonly createRequireNamespaces: Set<string>;
  readonly loaders: Set<string>;
}

export const nodeModuleSpecifiers: ReadonlySet<string> = new Set(["module", "node:module"]);

export const expressionIsCreateRequireFactory = (
  expression: ts.Expression,
  bindings: RuntimeLoaderBindings,
): boolean => {
  if (ts.isIdentifier(expression)) return bindings.createRequireFactories.has(expression.text);
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    bindings.createRequireNamespaces.has(expression.expression.text) &&
    expression.name.text === "createRequire"
  );
};

export const expressionCreatesRuntimeLoader = (
  expression: ts.Expression,
  bindings: RuntimeLoaderBindings,
): boolean =>
  ts.isCallExpression(expression) &&
  expressionIsCreateRequireFactory(expression.expression, bindings);

export const expressionIsRuntimeLoader = (
  expression: ts.Expression,
  bindings: RuntimeLoaderBindings,
): boolean => {
  if (ts.isIdentifier(expression)) {
    return expression.text === "require" || bindings.loaders.has(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === "require";
  if (!ts.isElementAccessExpression(expression)) {
    return expressionCreatesRuntimeLoader(expression, bindings);
  }
  return (
    ts.isStringLiteralLike(expression.argumentExpression) &&
    expression.argumentExpression.text === "require"
  );
};

const unsupportedLoaderUse = (sourceFile: ts.SourceFile, node: ts.Node): never => {
  const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  throw new Error(
    `unsupported runtime loader usage in ${sourceFile.fileName}:${String(location.line + 1)}:` +
      `${String(location.character + 1)}; use a supported form (a direct call with a static specifier, ` +
      "or a simple identifier alias followed by a direct call), or add the loaded file to the " +
      "seed runtime manifest",
  );
};

const expressionIsSimpleAliasInitializer = (node: ts.Expression): boolean => {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent)) {
    return parent.initializer === node && ts.isIdentifier(parent.name);
  }
  return (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === node &&
    ts.isIdentifier(parent.left)
  );
};

const validateExportedBindings = (
  sourceFile: ts.SourceFile,
  bindings: RuntimeLoaderBindings,
): void => {
  for (const [name, node] of collectExportedBindingNames(sourceFile)) {
    if (
      name === "require" ||
      bindings.loaders.has(name) ||
      bindings.createRequireFactories.has(name) ||
      bindings.createRequireNamespaces.has(name)
    ) {
      unsupportedLoaderUse(sourceFile, node);
    }
  }
};

const assertSupportedSourceExpression = (node: ts.Expression, sourceFile: ts.SourceFile): void => {
  const parent = node.parent;
  if (
    (ts.isCallExpression(parent) && parent.expression === node) ||
    expressionIsSimpleAliasInitializer(node)
  ) {
    return;
  }
  unsupportedLoaderUse(sourceFile, node);
};

const expressionLoadsNodeModule = (
  node: ts.CallExpression,
  bindings: RuntimeLoaderBindings,
): boolean => {
  const specifier = node.arguments[0];
  if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return false;
  if (!nodeModuleSpecifiers.has(specifier.text)) return false;
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    expressionIsRuntimeLoader(node.expression, bindings)
  );
};

const nodeModuleExportExposesCreateRequire = (node: ts.ExportDeclaration): boolean => {
  const specifier = node.moduleSpecifier;
  if (specifier === undefined || !ts.isStringLiteralLike(specifier)) return false;
  if (!nodeModuleSpecifiers.has(specifier.text) || node.isTypeOnly) return false;
  const clause = node.exportClause;
  if (clause === undefined || ts.isNamespaceExport(clause)) return true;
  return clause.elements.some(
    (element) =>
      !element.isTypeOnly && (element.propertyName ?? element.name).text === "createRequire",
  );
};

const validateCallSourceUsage = (
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  bindings: RuntimeLoaderBindings,
): void => {
  if (expressionLoadsNodeModule(node, bindings) && !ts.isExpressionStatement(node.parent)) {
    unsupportedLoaderUse(sourceFile, node);
  }
  if (expressionCreatesRuntimeLoader(node, bindings)) {
    assertSupportedSourceExpression(node, sourceFile);
  }
};

const validateAccessSourceUsage = (
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  bindings: RuntimeLoaderBindings,
): void => {
  if (
    expressionIsRuntimeLoader(node, bindings) ||
    expressionIsCreateRequireFactory(node, bindings)
  ) {
    assertSupportedSourceExpression(node, sourceFile);
  }
};

const validateNamespaceIdentifier = (node: ts.Identifier, sourceFile: ts.SourceFile): void => {
  const parent = node.parent;
  if (
    !ts.isPropertyAccessExpression(parent) ||
    parent.expression !== node ||
    parent.name.text !== "createRequire"
  ) {
    unsupportedLoaderUse(sourceFile, node);
  }
};

const identifierIsKnownLoader = (node: ts.Identifier, bindings: RuntimeLoaderBindings): boolean =>
  bindings.createRequireFactories.has(node.text) ||
  node.text === "require" ||
  bindings.loaders.has(node.text);

const validateIdentifierSourceUsage = (
  node: ts.Identifier,
  sourceFile: ts.SourceFile,
  bindings: RuntimeLoaderBindings,
  requireShadowed: boolean,
): void => {
  if (identifierIsDefinitionOrPropertyName(node)) return;
  if (bindings.createRequireNamespaces.has(node.text)) {
    validateNamespaceIdentifier(node, sourceFile);
    return;
  }
  if (node.text === "require" && requireShadowed) {
    unsupportedLoaderUse(sourceFile, node);
  }
  if (identifierIsKnownLoader(node, bindings)) {
    assertSupportedSourceExpression(node, sourceFile);
  }
};

export const validateKnownLoaderSourceUsage = (
  sourceFile: ts.SourceFile,
  bindings: RuntimeLoaderBindings,
): void => {
  validateExportedBindings(sourceFile, bindings);
  const requireShadowed = sourceHasRequireShadow(sourceFile);
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node) && nodeModuleExportExposesCreateRequire(node)) {
      unsupportedLoaderUse(sourceFile, node);
    }
    if (ts.isCallExpression(node)) validateCallSourceUsage(node, sourceFile, bindings);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      validateAccessSourceUsage(node, sourceFile, bindings);
    }
    if (ts.isIdentifier(node)) {
      validateIdentifierSourceUsage(node, sourceFile, bindings, requireShadowed);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
};
