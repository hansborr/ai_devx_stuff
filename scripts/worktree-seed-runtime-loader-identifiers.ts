import ts from "typescript";

const identifierIsImportOrBindingDefinition = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isImportClause(parent)) return parent.name === node;
  if (ts.isImportSpecifier(parent)) return parent.name === node;
  if (ts.isNamespaceImport(parent)) return parent.name === node;
  if (ts.isImportEqualsDeclaration(parent)) return parent.name === node;
  if (ts.isVariableDeclaration(parent)) return parent.name === node;
  if (ts.isParameter(parent)) return parent.name === node;
  if (ts.isBindingElement(parent)) return parent.name === node;
  return false;
};

const importBindingIsTypeOnly = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isImportClause(parent)) return parent.phaseModifier === ts.SyntaxKind.TypeKeyword;
  if (ts.isImportEqualsDeclaration(parent)) return parent.isTypeOnly;
  if (ts.isNamespaceImport(parent)) {
    const clause = parent.parent;
    return ts.isImportClause(clause) && clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
  }
  if (!ts.isImportSpecifier(parent)) return false;
  if (parent.isTypeOnly) return true;
  const namedImports = parent.parent;
  const clause = namedImports.parent;
  return ts.isImportClause(clause) && clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
};

const identifierIsValueBindingDefinition = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent)) return parent.name === node;
  if (ts.isParameter(parent)) return parent.name === node;
  if (ts.isBindingElement(parent)) return parent.name === node;
  if (
    ts.isImportClause(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent)
  ) {
    return !importBindingIsTypeOnly(node);
  }
  return false;
};

const identifierIsNamedDeclaration = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) {
    return parent.name === node;
  }
  if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) return parent.name === node;
  if (ts.isInterfaceDeclaration(parent)) return parent.name === node;
  if (ts.isTypeAliasDeclaration(parent)) return parent.name === node;
  if (ts.isEnumDeclaration(parent)) return parent.name === node;
  if (ts.isModuleDeclaration(parent)) return parent.name === node;
  if (ts.isTypeParameterDeclaration(parent)) return parent.name === node;
  return false;
};

const identifierIsValueNamedDeclaration = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) {
    return parent.name === node;
  }
  if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) return parent.name === node;
  if (ts.isEnumDeclaration(parent)) return parent.name === node;
  if (ts.isModuleDeclaration(parent)) return parent.name === node;
  return false;
};

const identifierIsMemberName = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isPropertyAssignment(parent)) return parent.name === node;
  if (ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) {
    return parent.name === node;
  }
  if (ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) return parent.name === node;
  if (ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) {
    return parent.name === node;
  }
  return false;
};

const identifierIsPropertyName = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  if (identifierIsMemberName(node)) return true;
  if (ts.isBindingElement(parent)) return parent.propertyName === node;
  if (ts.isEnumMember(parent)) return parent.name === node;
  return false;
};

const identifierIsInTypeOnlyContext = (node: ts.Identifier): boolean => {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
};

export const identifierIsDefinitionOrPropertyName = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  const assignmentTarget =
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === node;
  return (
    assignmentTarget ||
    identifierIsImportOrBindingDefinition(node) ||
    identifierIsNamedDeclaration(node) ||
    identifierIsPropertyName(node) ||
    identifierIsInTypeOnlyContext(node)
  );
};

export const sourceHasRequireShadow = (sourceFile: ts.SourceFile): boolean => {
  let shadowed = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      node.text === "require" &&
      (identifierIsValueBindingDefinition(node) || identifierIsValueNamedDeclaration(node))
    ) {
      shadowed = true;
      return;
    }
    if (!shadowed) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return shadowed;
};
