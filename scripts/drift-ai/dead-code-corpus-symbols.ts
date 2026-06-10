import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ts } from "ts-morph";

import {
  type DeadCodeCorpusExportKind,
  type DeadCodeCorpusSymbol,
  deadCodeCorpusSymbolId,
  DEFAULT_DEAD_CODE_CORPUS_DIR,
} from "./dead-code-corpus-types.js";
import { toPosix } from "./path-util.js";
import { hasModifier, scriptKindFor } from "./ts-source-util.js";

const CORPUS_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx"]);

export function extractDeadCodeCorpusSymbols(
  corpusDir = DEFAULT_DEAD_CODE_CORPUS_DIR,
): DeadCodeCorpusSymbol[] {
  return listCorpusSourceFiles(corpusDir).flatMap((relativePath) =>
    extractExportedSymbols(relativePath, readFileSync(path.join(corpusDir, relativePath), "utf8")),
  );
}

function extractExportedSymbols(filePath: string, source: string): DeadCodeCorpusSymbol[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const symbols: DeadCodeCorpusSymbol[] = [];
  for (const statement of sourceFile.statements)
    addStatementSymbols(sourceFile, statement, symbols);
  return symbols.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath, "en") ||
      left.symbol.localeCompare(right.symbol, "en"),
  );
}

function addStatementSymbols(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  symbols: DeadCodeCorpusSymbol[],
): void {
  if (ts.isExportDeclaration(statement)) {
    addReExportSymbols(sourceFile, statement, symbols);
    return;
  }
  if (!hasExportModifier(statement)) return;
  addExportedDeclarationSymbols(sourceFile, statement, symbols);
}

function addExportedDeclarationSymbols(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  symbols: DeadCodeCorpusSymbol[],
): void {
  if (hasDefaultModifier(statement)) {
    addSymbol(sourceFile, statement, symbols, "default", "default");
    return;
  }
  const named = namedExport(statement);
  if (named !== undefined) {
    addSymbol(sourceFile, statement, symbols, named.symbol, named.exportKind);
    return;
  }
  if (ts.isVariableStatement(statement)) addVariableSymbols(sourceFile, statement, symbols);
}

function addReExportSymbols(
  sourceFile: ts.SourceFile,
  statement: ts.ExportDeclaration,
  symbols: DeadCodeCorpusSymbol[],
): void {
  const clause = statement.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) return;
  for (const element of clause.elements) {
    addSymbol(sourceFile, element, symbols, element.name.text, "re-export");
  }
}

function addVariableSymbols(
  sourceFile: ts.SourceFile,
  statement: ts.VariableStatement,
  symbols: DeadCodeCorpusSymbol[],
): void {
  const exportKind = variableExportKind(statement);
  for (const declaration of statement.declarationList.declarations) {
    for (const name of bindingNames(declaration.name)) {
      addSymbol(sourceFile, declaration, symbols, name, exportKind);
    }
  }
}

function namedExport(
  statement: ts.Statement,
): { readonly symbol: string; readonly exportKind: DeadCodeCorpusExportKind } | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    return { symbol: statement.name.text, exportKind: "function" };
  }
  if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
    return { symbol: statement.name.text, exportKind: "class" };
  }
  if (ts.isInterfaceDeclaration(statement)) {
    return { symbol: statement.name.text, exportKind: "interface" };
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return { symbol: statement.name.text, exportKind: "type" };
  }
  if (ts.isEnumDeclaration(statement)) return { symbol: statement.name.text, exportKind: "enum" };
  return undefined;
}

function addSymbol(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  symbols: DeadCodeCorpusSymbol[],
  symbol: string,
  exportKind: DeadCodeCorpusExportKind,
): void {
  const filePath = toPosix(sourceFile.fileName);
  symbols.push({
    id: deadCodeCorpusSymbolId(filePath, symbol),
    filePath,
    symbol,
    exportKind,
    startLine: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  });
}

function variableExportKind(statement: ts.VariableStatement): DeadCodeCorpusExportKind {
  if ((statement.declarationList.flags & ts.NodeFlags.Const) !== 0) return "const";
  if ((statement.declarationList.flags & ts.NodeFlags.Let) !== 0) return "let";
  return "var";
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => {
    if (ts.isOmittedExpression(element)) return [];
    return bindingNames(element.name);
  });
}

function hasExportModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword);
}

function listCorpusSourceFiles(corpusDir: string): string[] {
  return listFiles(corpusDir, "").filter((relativePath) =>
    CORPUS_SOURCE_EXTENSIONS.has(path.extname(relativePath)),
  );
}

function listFiles(root: string, relativeDir: string): string[] {
  const absoluteDir = path.join(root, relativeDir);
  return readdirSync(absoluteDir, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = toPosix(path.join(relativeDir, entry.name));
      if (entry.isDirectory()) return listFiles(root, relativePath);
      return entry.isFile() ? [relativePath] : [];
    })
    .sort((left, right) => left.localeCompare(right, "en"));
}
