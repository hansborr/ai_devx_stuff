import ts from "typescript";

const nodeHasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false);

const collectExportedVariables = (node: ts.Node, exported: Map<string, ts.Node>): void => {
  if (!ts.isVariableStatement(node) || !nodeHasExportModifier(node)) return;
  for (const declaration of node.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) exported.set(declaration.name.text, node);
  }
};

const collectExportDeclaration = (node: ts.Node, exported: Map<string, ts.Node>): void => {
  if (!ts.isExportDeclaration(node) || node.moduleSpecifier !== undefined || node.isTypeOnly) {
    return;
  }
  const clause = node.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return;
  for (const element of clause.elements) {
    if (!element.isTypeOnly) exported.set((element.propertyName ?? element.name).text, node);
  }
};

const collectOtherExport = (node: ts.Node, exported: Map<string, ts.Node>): void => {
  if (ts.isImportEqualsDeclaration(node) && nodeHasExportModifier(node)) {
    exported.set(node.name.text, node);
  }
  if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) {
    exported.set(node.expression.text, node);
  }
};

export const collectExportedBindingNames = (
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, ts.Node> => {
  const exported = new Map<string, ts.Node>();
  const visit = (node: ts.Node): void => {
    collectExportedVariables(node, exported);
    collectExportDeclaration(node, exported);
    collectOtherExport(node, exported);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return exported;
};
