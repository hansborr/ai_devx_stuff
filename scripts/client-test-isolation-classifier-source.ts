import ts from "typescript";

import {
  type ClassifyClientTestFileSourceOptions,
  type ClientTestFileClassification,
  type ClientTestIsolationReason,
  MODULE_REGISTRY_MUTATION_METHODS,
  type ModuleRegistryMutationMethod,
} from "./client-test-isolation-classifier-types.js";

type VitestAliases = {
  readonly viObjectNames: ReadonlySet<string>;
  readonly viMethodNames: ReadonlyMap<string, ModuleRegistryMutationMethod>;
  readonly vitestNamespaceNames: ReadonlySet<string>;
};

type MutableVitestAliases = {
  readonly viObjectNames: Set<string>;
  readonly viMethodNames: Map<string, ModuleRegistryMutationMethod>;
  readonly vitestNamespaceNames: Set<string>;
};

type VitestViExpressionAliases = {
  readonly viObjectNames: ReadonlySet<string>;
  readonly vitestNamespaceNames: ReadonlySet<string>;
};

export function classifyClientTestFileSource(
  options: ClassifyClientTestFileSourceOptions,
): ClientTestFileClassification {
  const sourceFile = ts.createSourceFile(
    options.file,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(options.file),
  );
  const aliases = collectVitestAliases(sourceFile);
  const reasons = collectModuleRegistryMutationReasons(sourceFile, aliases);

  if (reasons.length === 0) {
    return { file: options.file, mode: "no-isolate", reasons: [] };
  }

  return {
    file: options.file,
    mode: "isolated",
    reasons,
  };
}

function collectVitestAliases(sourceFile: ts.SourceFile): VitestAliases {
  const aliases: MutableVitestAliases = {
    viObjectNames: new Set(["vi"]),
    viMethodNames: new Map(),
    vitestNamespaceNames: new Set(),
  };
  collectVitestImportAliases(sourceFile, aliases);

  let changed = true;
  while (changed) {
    changed = collectVariableAliases(sourceFile, aliases);
  }

  return aliases;
}

function collectVitestImportAliases(
  sourceFile: ts.SourceFile,
  aliases: MutableVitestAliases,
): void {
  visit(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) collectVitestImportDeclarationAliases(node, aliases);
  });
}

function collectVitestImportDeclarationAliases(
  node: ts.ImportDeclaration,
  aliases: MutableVitestAliases,
): void {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return;
  if (node.moduleSpecifier.text !== "vitest") return;
  const namedBindings = node.importClause?.namedBindings;
  if (namedBindings === undefined) return;

  if (ts.isNamespaceImport(namedBindings)) {
    aliases.vitestNamespaceNames.add(namedBindings.name.text);
    return;
  }

  for (const element of namedBindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    if (importedName === "vi") aliases.viObjectNames.add(element.name.text);
  }
}

function collectVariableAliases(sourceFile: ts.SourceFile, aliases: MutableVitestAliases): boolean {
  let changed = false;
  visit(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node)) return;
    changed = collectVariableDeclarationAlias(node, aliases) || changed;
  });
  return changed;
}

function collectVariableDeclarationAlias(
  node: ts.VariableDeclaration,
  aliases: MutableVitestAliases,
): boolean {
  if (node.initializer === undefined) return false;
  if (ts.isIdentifier(node.name)) return collectIdentifierVariableAlias(node, aliases);
  if (ts.isObjectBindingPattern(node.name)) return collectObjectBindingAliases(node, aliases);
  return false;
}

function collectIdentifierVariableAlias(
  node: ts.VariableDeclaration,
  aliases: MutableVitestAliases,
): boolean {
  if (node.initializer === undefined) return false;
  if (!ts.isIdentifier(node.name)) return false;

  if (isVitestViExpression(node.initializer, aliases)) {
    return addToSet(aliases.viObjectNames, node.name.text);
  }

  const method = methodFromVitestMemberAccess(node.initializer, aliases);
  return method === undefined ? false : addToMap(aliases.viMethodNames, node.name.text, method);
}

function collectObjectBindingAliases(
  node: ts.VariableDeclaration,
  aliases: MutableVitestAliases,
): boolean {
  if (node.initializer === undefined) return false;
  if (!ts.isObjectBindingPattern(node.name)) return false;
  if (!isVitestViExpression(node.initializer, aliases)) return false;

  let changed = false;
  for (const element of node.name.elements) {
    changed = collectObjectBindingElementAlias(element, aliases) || changed;
  }
  return changed;
}

function collectObjectBindingElementAlias(
  element: ts.BindingElement,
  aliases: MutableVitestAliases,
): boolean {
  if (!ts.isIdentifier(element.name)) return false;
  const propertyName = bindingElementPropertyName(element);
  if (propertyName === undefined) return false;
  if (!isModuleRegistryMutationMethod(propertyName)) return false;
  return addToMap(aliases.viMethodNames, element.name.text, propertyName);
}

function collectModuleRegistryMutationReasons(
  sourceFile: ts.SourceFile,
  aliases: VitestAliases,
): readonly ClientTestIsolationReason[] {
  const reasons: ClientTestIsolationReason[] = [];
  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const method = methodFromCallExpression(node, aliases);
    if (method === undefined) return;
    reasons.push(reasonFromCallExpression(sourceFile, node, method));
  });
  return reasons;
}

function methodFromCallExpression(
  callExpression: ts.CallExpression,
  aliases: VitestAliases,
): ModuleRegistryMutationMethod | undefined {
  const expression = callExpression.expression;
  if (ts.isIdentifier(expression)) return aliases.viMethodNames.get(expression.text);
  return methodFromVitestMemberAccess(expression, aliases);
}

function methodFromVitestMemberAccess(
  node: ts.Node,
  aliases: VitestViExpressionAliases,
): ModuleRegistryMutationMethod | undefined {
  if (ts.isPropertyAccessExpression(node)) return methodFromPropertyAccess(node, aliases);
  if (ts.isElementAccessExpression(node)) return methodFromElementAccess(node, aliases);
  return undefined;
}

function methodFromPropertyAccess(
  node: ts.PropertyAccessExpression,
  aliases: VitestViExpressionAliases,
): ModuleRegistryMutationMethod | undefined {
  const methodName = node.name.text;
  if (!isModuleRegistryMutationMethod(methodName)) return undefined;
  return isVitestViExpression(node.expression, aliases) ? methodName : undefined;
}

function methodFromElementAccess(
  node: ts.ElementAccessExpression,
  aliases: VitestViExpressionAliases,
): ModuleRegistryMutationMethod | undefined {
  const methodName = stringLiteralText(node.argumentExpression);
  if (methodName === undefined) return undefined;
  if (!isModuleRegistryMutationMethod(methodName)) return undefined;
  return isVitestViExpression(node.expression, aliases) ? methodName : undefined;
}

function reasonFromCallExpression(
  sourceFile: ts.SourceFile,
  callExpression: ts.CallExpression,
  method: ModuleRegistryMutationMethod,
): ClientTestIsolationReason {
  const line =
    sourceFile.getLineAndCharacterOfPosition(callExpression.getStart(sourceFile)).line + 1;
  const moduleName = stringLiteralText(callExpression.arguments[0]);
  const expression = formatCallExpression(sourceFile, callExpression, moduleName);
  const reason = {
    kind: "module-registry-mutation",
    line,
    method,
    expression,
  } satisfies ClientTestIsolationReason;

  if (moduleName === undefined) return reason;
  return { ...reason, moduleName };
}

function formatCallExpression(
  sourceFile: ts.SourceFile,
  callExpression: ts.CallExpression,
  moduleName: string | undefined,
): string {
  const callee = callExpression.expression.getText(sourceFile);
  if (moduleName === undefined) return `${callee}()`;
  return `${callee}(${JSON.stringify(moduleName)})`;
}

function isVitestViExpression(
  expression: ts.Expression,
  aliases: VitestViExpressionAliases,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return aliases.viObjectNames.has(unwrapped.text);
  if (!ts.isPropertyAccessExpression(unwrapped)) return false;
  if (unwrapped.name.text !== "vi") return false;
  return (
    ts.isIdentifier(unwrapped.expression) &&
    aliases.vitestNamespaceNames.has(unwrapped.expression.text)
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function bindingElementPropertyName(element: ts.BindingElement): string | undefined {
  if (element.propertyName === undefined) {
    return ts.isIdentifier(element.name) ? element.name.text : undefined;
  }
  if (ts.isIdentifier(element.propertyName)) return element.propertyName.text;
  return stringLiteralText(element.propertyName);
}

function stringLiteralText(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function isModuleRegistryMutationMethod(value: string): value is ModuleRegistryMutationMethod {
  return MODULE_REGISTRY_MUTATION_METHODS.has(value);
}

function addToSet(set: Set<string>, value: string): boolean {
  if (set.has(value)) return false;
  set.add(value);
  return true;
}

function addToMap(
  map: Map<string, ModuleRegistryMutationMethod>,
  key: string,
  value: ModuleRegistryMutationMethod,
): boolean {
  if (map.get(key) === value) return false;
  map.set(key, value);
  return true;
}

function visit(sourceFile: ts.SourceFile, callback: (node: ts.Node) => void): void {
  const visitNode = (node: ts.Node): void => {
    callback(node);
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}
