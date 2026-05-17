import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CallExpression,
  ImportDeclaration,
  Node,
  Project,
  PropertyAssignment,
  SourceFile,
  SyntaxKind,
  VariableDeclaration,
  VariableStatement,
} from "ts-morph";

const ROUTER_ROOT = path.join("packages", "server", "src", "routers");
const SHARED_SCHEMA_ROOT = path.join("packages", "shared", "src", "schemas");
export const SHARED_SCHEMA_PREFIX = "@musi/shared/schemas/";

export type ImportSpecifierInfo = {
  imported: string;
  isTypeOnly?: boolean;
  local: string;
};

export type ImportBinding = ImportSpecifierInfo & {
  targetSource: string;
};

export type TargetIdentifiers = {
  type: Set<string>;
  value: Set<string>;
};

export type WritePlan = {
  path: string;
  text: string;
};

export type SharedSchemaCodemodCandidate = {
  kind: "inline" | "const";
  schemaName: string;
  schemaCall: CallExpression;
  schemaExpression: Node;
  schemaText: string;
  constStatement?: VariableStatement;
};

export type SharedSchemaDiscoveryResult = {
  candidateCount: number;
  error?: string;
  relativeRouterPath: string;
};

export class CodemodError extends Error {
  constructor(codemodName: string, message: string) {
    super(`${codemodName} codemod: ${message}`);
    this.name = "CodemodError";
  }
}

export function fail(codemodName: string, message: string): never {
  throw new CodemodError(codemodName, message);
}

export function assertSafeSchemaIdentifier(codemodName: string, name: string): void {
  if (/^[A-Za-z_$][\w$]*$/u.test(name)) return;
  fail(codemodName, `Could not derive a safe schema name from procedure name ${name}.`);
}

export function moduleSource(importDeclaration: ImportDeclaration): string {
  return importDeclaration.getModuleSpecifierValue();
}

function namedImportSpecifiers(importDeclaration: ImportDeclaration): ImportSpecifierInfo[] {
  return importDeclaration.getNamedImports().map((specifier) => ({
    imported: specifier.getName(),
    isTypeOnly: !importDeclaration.isTypeOnly() && specifier.isTypeOnly(),
    local: specifier.getAliasNode()?.getText() ?? specifier.getName(),
  }));
}

function collectSharedSchemaValueImports(
  sourceFile: SourceFile,
  sourcePrefix = SHARED_SCHEMA_PREFIX,
): Set<string> {
  const imports = new Set<string>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const source = moduleSource(importDeclaration);
    if (importDeclaration.isTypeOnly()) continue;
    if (!source.startsWith(sourcePrefix)) continue;
    for (const specifier of namedImportSpecifiers(importDeclaration)) imports.add(specifier.local);
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

function specifierText(specifier: ImportSpecifierInfo): string {
  const typePrefix = specifier.isTypeOnly ? "type " : "";
  if (specifier.imported === specifier.local) return `${typePrefix}${specifier.local}`;
  return `${typePrefix}${specifier.imported} as ${specifier.local}`;
}

function normalizedImportText(importDeclaration: ImportDeclaration): string {
  const source = moduleSource(importDeclaration);
  const namedImports = namedImportSpecifiers(importDeclaration).sort((left, right) =>
    left.local.localeCompare(right.local, "en"),
  );
  const defaultImport = importDeclaration.getDefaultImport()?.getText();
  const namespaceImport = importDeclaration.getNamespaceImport()?.getText();
  const typePrefix = importDeclaration.isTypeOnly() ? "type " : "";
  if (namespaceImport && defaultImport) {
    return `import ${typePrefix}${defaultImport}, * as ${namespaceImport} from "${source}";`;
  }
  if (namespaceImport) return `import ${typePrefix}* as ${namespaceImport} from "${source}";`;
  if (defaultImport && namedImports.length > 0) {
    return `import ${typePrefix}${defaultImport}, { ${namedImports.map(specifierText).join(", ")} } from "${source}";`;
  }
  if (defaultImport) return `import ${typePrefix}${defaultImport} from "${source}";`;
  if (namedImports.length > 0) {
    return `import ${typePrefix}{ ${namedImports.map(specifierText).join(", ")} } from "${source}";`;
  }
  return importDeclaration.getText();
}

function importSortKey(importDeclaration: ImportDeclaration): string {
  const source = moduleSource(importDeclaration);
  const sortableSource = source.replace(/\.[cm]?js$/u, "");
  if (source.startsWith(".")) return `3:${sortableSource}`;
  if (source.startsWith("node:")) return `1:${sortableSource}`;
  return `2:${sortableSource}`;
}

export function sortImportBlocks(source: string, filePath: string): string {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.createSourceFile(filePath, source, { overwrite: true });
  const statements = sourceFile.getStatements();
  const replacements: { start: number; end: number; text: string }[] = [];
  let block: ImportDeclaration[] = [];

  const flushBlock = (): void => {
    if (block.length < 2) {
      block = [];
      return;
    }
    const first = block[0];
    const last = block[block.length - 1];
    if (!first || !last) {
      block = [];
      return;
    }
    const sorted = [...block].sort((left, right) =>
      importSortKey(left).localeCompare(importSortKey(right), "en"),
    );
    const grouped = sorted.reduce<string[][]>((groups, importDeclaration, index) => {
      const key = importSortKey(importDeclaration).slice(0, 1);
      const previous = sorted[index - 1];
      if (!previous || importSortKey(previous).slice(0, 1) !== key) groups.push([]);
      const group = groups[groups.length - 1];
      if (!group) throw new Error("Internal error while grouping imports.");
      group.push(normalizedImportText(importDeclaration));
      return groups;
    }, []);
    replacements.push({
      start: first.getStart(),
      end: last.getEnd(),
      text: grouped.map((group) => group.join("\n")).join("\n\n"),
    });
    block = [];
  };

  for (const statement of statements) {
    if (Node.isImportDeclaration(statement)) {
      block.push(statement);
      continue;
    }
    flushBlock();
  }
  flushBlock();

  let nextSource = source;
  for (const replacement of [...replacements].reverse()) {
    nextSource =
      nextSource.slice(0, replacement.start) + replacement.text + nextSource.slice(replacement.end);
  }
  return nextSource;
}

export function normalizeRelativeRouterPath(
  codemodName: string,
  root: string,
  routerPath: string,
): string {
  const relative = path.relative(root, routerPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(codemodName, "Router file must be inside the current repository.");
  }
  if (!relative.startsWith(`${ROUTER_ROOT}${path.sep}`)) {
    fail(codemodName, `Router file must be under ${ROUTER_ROOT}.`);
  }
  if (/\.test\.tsx?$/.test(relative)) fail(codemodName, "Test router files are not supported.");
  if (!relative.endsWith(".ts")) fail(codemodName, "Router file must be a .ts file.");
  return relative;
}

function discoverRouterFiles(root: string): string[] {
  const routerRoot = path.join(root, ROUTER_ROOT);
  if (!existsSync(routerRoot)) return [];

  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile()) continue;
      if (!currentPath.endsWith(".ts") || /\.test\.tsx?$/.test(currentPath)) continue;
      files.push(path.relative(root, currentPath));
    }
  };

  visit(routerRoot);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export function validateSharedSchemaSource(codemodName: string, source: string): void {
  if (!source.startsWith(SHARED_SCHEMA_PREFIX) || !source.endsWith(".js")) {
    fail(codemodName, "--target must be an @musi/shared/schemas/*.js module source.");
  }
  const suffix = source.slice(SHARED_SCHEMA_PREFIX.length);
  const segments = suffix.split("/");
  if (
    path.isAbsolute(suffix) ||
    path.win32.isAbsolute(suffix) ||
    suffix.includes("\\") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(codemodName, `--target must stay under ${SHARED_SCHEMA_ROOT}.`);
  }
}

export function targetPathFromSource(root: string, source: string): string {
  const fileName = source.slice(SHARED_SCHEMA_PREFIX.length).replace(/\.[cm]?js$/u, ".ts");
  const schemaRoot = path.resolve(root, SHARED_SCHEMA_ROOT);
  const targetPath = path.resolve(schemaRoot, fileName);
  const relative = path.relative(schemaRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Shared schema target escaped ${SHARED_SCHEMA_ROOT}: ${source}`);
  }
  return targetPath;
}

function relativeSharedModuleSource(targetSource: string, dependencyPath: string): string {
  const targetSuffix = targetSource.slice(SHARED_SCHEMA_PREFIX.length);
  const targetModulePath = path.posix.join("schemas", targetSuffix);
  const relativeSource = path.posix.relative(path.posix.dirname(targetModulePath), dependencyPath);
  return relativeSource.startsWith(".") ? relativeSource : `./${relativeSource}`;
}

export function rewriteAllowedSharedImportSource(
  codemodName: string,
  source: string,
  targetSource: string,
): string | undefined {
  validateSharedSchemaSource(codemodName, targetSource);
  if (source === "@musi/shared/constants") {
    return relativeSharedModuleSource(targetSource, "constants.js");
  }
  if (!source.startsWith(SHARED_SCHEMA_PREFIX) || !source.endsWith(".js")) return undefined;
  validateSharedSchemaSource(codemodName, source);
  const dependencyPath = path.posix.join("schemas", source.slice(SHARED_SCHEMA_PREFIX.length));
  return relativeSharedModuleSource(targetSource, dependencyPath);
}

export function getSourceFileAtPath(project: Project, filePath: string): SourceFile {
  return project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
}

export function collectExportedTopLevelIdentifiers(sourceFile: SourceFile): Set<string> {
  const identifiers = new Set<string>();
  for (const statement of sourceFile.getStatements()) {
    if (Node.isVariableStatement(statement)) {
      if (!statement.isExported()) continue;
      for (const declaration of statement.getDeclarations()) {
        const nameNode = declaration.getNameNode();
        if (Node.isIdentifier(nameNode)) identifiers.add(nameNode.getText());
      }
      continue;
    }
    if (
      Node.isFunctionDeclaration(statement) ||
      Node.isClassDeclaration(statement) ||
      Node.isInterfaceDeclaration(statement) ||
      Node.isTypeAliasDeclaration(statement) ||
      Node.isEnumDeclaration(statement)
    ) {
      if (!statement.isExported()) continue;
      const name = statement.getName();
      if (name) identifiers.add(name);
    }
  }
  return identifiers;
}

export function collectTargetIdentifiers(sourceFile: SourceFile): TargetIdentifiers {
  const identifiers: TargetIdentifiers = { type: new Set<string>(), value: new Set<string>() };
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const importSpace = importDeclaration.isTypeOnly() ? identifiers.type : identifiers.value;
    for (const specifier of importDeclaration.getNamedImports()) {
      const local = specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (importDeclaration.isTypeOnly() || specifier.isTypeOnly()) {
        identifiers.type.add(local);
      } else {
        identifiers.value.add(local);
      }
    }
    const defaultImport = importDeclaration.getDefaultImport();
    if (defaultImport) importSpace.add(defaultImport.getText());
    const namespaceImport = importDeclaration.getNamespaceImport();
    if (namespaceImport) importSpace.add(namespaceImport.getText());
  }
  for (const statement of sourceFile.getStatements()) {
    if (Node.isVariableStatement(statement)) {
      for (const declaration of statement.getDeclarations()) {
        const nameNode = declaration.getNameNode();
        if (Node.isIdentifier(nameNode)) identifiers.value.add(nameNode.getText());
      }
    }
    if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement)) {
      const name = statement.getName();
      if (name) identifiers.value.add(name);
    }
    if (Node.isInterfaceDeclaration(statement) || Node.isTypeAliasDeclaration(statement)) {
      const name = statement.getName();
      if (name) identifiers.type.add(name);
    }
    if (Node.isEnumDeclaration(statement)) {
      const name = statement.getName();
      if (name) {
        identifiers.type.add(name);
        identifiers.value.add(name);
      }
    }
  }
  return identifiers;
}

function targetHasIdentifier(targetIdentifiers: TargetIdentifiers, name: string): boolean {
  return targetIdentifiers.value.has(name) || targetIdentifiers.type.has(name);
}

function isProcedureSchemaCall(callExpression: CallExpression, methodName: string): boolean {
  const expression = callExpression.getExpression();
  return Node.isPropertyAccessExpression(expression) && expression.getName() === methodName;
}

export function propertyCallMethod(callExpression: CallExpression): string | undefined {
  const expression = callExpression.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  return expression.getName();
}

export function propertyCallObject(callExpression: CallExpression): Node | undefined {
  const expression = callExpression.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  return expression.getExpression();
}

export function isZObjectCall(node: Node): boolean {
  if (!Node.isCallExpression(node)) return false;
  const expression = node.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return false;
  return expression.getName() === "object" && expression.getExpression().getText() === "z";
}

function propertyAssignmentName(propertyAssignment: PropertyAssignment): string | undefined {
  const nameNode = propertyAssignment.getNameNode();
  if (
    Node.isIdentifier(nameNode) ||
    Node.isStringLiteral(nameNode) ||
    Node.isNumericLiteral(nameNode)
  ) {
    return Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : nameNode.getText();
  }
  return undefined;
}

function variableDeclarationName(declaration: VariableDeclaration): string | undefined {
  const nameNode = declaration.getNameNode();
  return Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
}

export function procedureNameForSchemaCall(schemaCall: CallExpression): string | undefined {
  for (const ancestor of schemaCall.getAncestors()) {
    if (Node.isPropertyAssignment(ancestor)) return propertyAssignmentName(ancestor);
    if (Node.isVariableDeclaration(ancestor)) return variableDeclarationName(ancestor);
  }
  return undefined;
}

function getTopLevelConstSchemas(sourceFile: SourceFile): Map<string, VariableStatement> {
  const declarations = new Map<string, VariableStatement>();
  for (const statement of sourceFile.getStatements()) {
    if (!Node.isVariableStatement(statement)) continue;
    const declarationKind = statement.getDeclarationKind();
    const variables = statement.getDeclarations();
    if (declarationKind !== "const" || variables.length !== 1) continue;
    const variable = variables[0];
    if (!variable) continue;
    const nameNode = variable.getNameNode();
    if (Node.isIdentifier(nameNode)) declarations.set(nameNode.getText(), statement);
  }
  return declarations;
}

export function collectSchemaCallCandidates<TCandidate extends SharedSchemaCodemodCandidate>(
  sourceFile: SourceFile,
  methodName: string,
  sharedSourcePrefix: string,
  resolveCandidate: (
    schemaCall: CallExpression,
    constSchemas: Map<string, VariableStatement>,
    sharedImports: Set<string>,
  ) => TCandidate | undefined,
): TCandidate[] {
  const constSchemas = getTopLevelConstSchemas(sourceFile);
  const sharedImports = collectSharedSchemaValueImports(sourceFile, sharedSourcePrefix);
  const candidates: TCandidate[] = [];
  for (const callExpression of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isProcedureSchemaCall(callExpression, methodName)) continue;
    const candidate = resolveCandidate(callExpression, constSchemas, sharedImports);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

function codemodErrorReason(codemodName: string, error: CodemodError): string {
  const prefix = `${codemodName} codemod: `;
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
}

export function discoverSharedSchemaCandidates(
  codemodName: string,
  root: string,
  collectCandidates: (sourceFile: SourceFile) => SharedSchemaCodemodCandidate[],
): SharedSchemaDiscoveryResult[] {
  const project = createProject();
  const results: SharedSchemaDiscoveryResult[] = [];
  for (const relativeRouterPath of discoverRouterFiles(root)) {
    const routerFile = project.addSourceFileAtPath(path.join(root, relativeRouterPath));
    try {
      const candidates = collectCandidates(routerFile);
      if (candidates.length > 0) {
        results.push({ candidateCount: candidates.length, relativeRouterPath });
      }
    } catch (error) {
      if (error instanceof CodemodError) {
        results.push({
          candidateCount: 0,
          error: codemodErrorReason(codemodName, error),
          relativeRouterPath,
        });
        continue;
      }
      throw error;
    }
  }
  return results;
}

export function reportSharedSchemaDiscovery(
  codemodName: string,
  schemaKind: "input" | "output",
  results: SharedSchemaDiscoveryResult[],
): void {
  if (results.length === 0) {
    console.log(
      `${codemodName} codemod: no router-local ${schemaKind} schemas found under ${ROUTER_ROOT}.`,
    );
    return;
  }
  for (const result of results) {
    if (result.error) {
      console.log(
        `${codemodName} codemod: check ${result.relativeRouterPath}: unsupported (${result.error})`,
      );
      continue;
    }
    console.log(
      `${codemodName} codemod: check ${result.relativeRouterPath}: ${result.candidateCount} candidate(s).`,
    );
  }
}

export function isReferenceIdentifier(identifier: Node): boolean {
  const parent = identifier.getParent();
  if (!parent) return true;
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isPropertyAssignment(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isMethodDeclaration(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isBindingElement(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isVariableDeclaration(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isImportSpecifier(parent) && parent.getNameNode() === identifier) return false;
  if (Node.isImportSpecifier(parent) && parent.getAliasNode() === identifier) return false;
  if (Node.isImportClause(parent) && parent.getDefaultImport() === identifier) return false;
  return true;
}

export function referencedIdentifiers(node: Node): Set<string> {
  const identifiers = new Set<string>();
  const candidates = [node, ...node.getDescendantsOfKind(SyntaxKind.Identifier)];
  for (const current of candidates) {
    if (!Node.isIdentifier(current) || !isReferenceIdentifier(current)) continue;
    identifiers.add(current.getText());
  }
  return identifiers;
}

export function ensureNamedImport(
  sourceFile: SourceFile,
  source: string,
  specifiers: ImportSpecifierInfo[],
): void {
  const existing = sourceFile
    .getImportDeclarations()
    .find((declaration) => !declaration.isTypeOnly() && moduleSource(declaration) === source);
  if (existing) {
    const existingLocals = new Set(
      namedImportSpecifiers(existing).map((specifier) => specifier.local),
    );
    for (const specifier of specifiers) {
      if (existingLocals.has(specifier.local)) continue;
      existing.addNamedImport(specifierText(specifier));
    }
    return;
  }
  sourceFile.addImportDeclaration({
    moduleSpecifier: source,
    namedImports: specifiers.map(specifierText),
  });
}

function removeMatchingTypeOnlyNamedImport(
  sourceFile: SourceFile,
  source: string,
  specifier: ImportSpecifierInfo,
): void {
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (moduleSource(importDeclaration) !== source) continue;
    for (const namedImport of importDeclaration.getNamedImports()) {
      const imported = namedImport.getName();
      const local = namedImport.getAliasNode()?.getText() ?? imported;
      if (imported !== specifier.imported || local !== specifier.local) continue;
      if (!importDeclaration.isTypeOnly() && !namedImport.isTypeOnly()) continue;
      namedImport.remove();
      if (
        importDeclaration.getNamedImports().length === 0 &&
        !importDeclaration.getDefaultImport()
      ) {
        importDeclaration.remove();
      }
      return;
    }
  }
}

function hasTypeOnlyImport(sourceFile: SourceFile, localName: string): boolean {
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (importDeclaration.isTypeOnly()) {
      const defaultImport = importDeclaration.getDefaultImport();
      if (defaultImport?.getText() === localName) return true;
      const namespaceImport = importDeclaration.getNamespaceImport();
      if (namespaceImport?.getText() === localName) return true;
    }
    for (const namedImport of importDeclaration.getNamedImports()) {
      if (!importDeclaration.isTypeOnly() && !namedImport.isTypeOnly()) continue;
      const local = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
      if (local === localName) return true;
    }
  }
  return false;
}

function ensureValueImportAvailable(
  codemodName: string,
  sourceFile: SourceFile,
  source: string,
  specifier: ImportSpecifierInfo,
): void {
  removeMatchingTypeOnlyNamedImport(sourceFile, source, specifier);
  if (hasTypeOnlyImport(sourceFile, specifier.local)) {
    fail(
      codemodName,
      `${specifier.local} is already imported type-only in the target shared schema file.`,
    );
  }
}

export function validateSharedSchemaCandidates<TCandidate extends SharedSchemaCodemodCandidate>({
  allowlistedImports,
  assertConstSchemaIsOnlyCallReference,
  candidates,
  codemodName,
  isImportBindingAllowed,
  sourceFile,
  targetIdentifiers,
  typeNameForSchema,
}: {
  allowlistedImports: Map<string, ImportBinding>;
  assertConstSchemaIsOnlyCallReference: (candidate: TCandidate, sourceFile: SourceFile) => void;
  candidates: TCandidate[];
  codemodName: string;
  isImportBindingAllowed?: (binding: ImportBinding, identifier: string) => boolean;
  sourceFile: SourceFile;
  targetIdentifiers: TargetIdentifiers;
  typeNameForSchema: (schemaName: string) => string;
}): Map<string, ImportBinding> {
  const seen = new Set<string>();
  const seenTypeNames = new Set<string>();
  const neededImports = new Map<string, ImportBinding>();
  for (const candidate of candidates) {
    if (seen.has(candidate.schemaName)) {
      fail(codemodName, `${candidate.schemaName} is generated more than once in this file.`);
    }
    seen.add(candidate.schemaName);
    if (targetHasIdentifier(targetIdentifiers, candidate.schemaName)) {
      fail(codemodName, `${candidate.schemaName} already exists in the target shared schema file.`);
    }
    const typeName = typeNameForSchema(candidate.schemaName);
    if (seenTypeNames.has(typeName)) {
      fail(codemodName, `${typeName} is generated more than once in this file.`);
    }
    seenTypeNames.add(typeName);
    if (targetHasIdentifier(targetIdentifiers, typeName)) {
      fail(codemodName, `${typeName} already exists in the target shared schema file.`);
    }
    assertConstSchemaIsOnlyCallReference(candidate, sourceFile);
    for (const identifier of referencedIdentifiers(candidate.schemaExpression)) {
      if (identifier === "z") continue;
      if (targetIdentifiers.value.has(identifier)) continue;
      const binding = allowlistedImports.get(identifier);
      if (binding && (isImportBindingAllowed?.(binding, identifier) ?? true)) {
        neededImports.set(identifier, binding);
        continue;
      }
      fail(
        codemodName,
        `${identifier} is not available in the target shared schema file; import it from a supported shared module or move this schema manually.`,
      );
    }
  }
  return neededImports;
}

export function ensureSharedSchemaImports(
  codemodName: string,
  targetFile: SourceFile,
  neededImports: Map<string, ImportBinding>,
  targetIdentifiers: TargetIdentifiers,
): void {
  if (!targetIdentifiers.value.has("z")) {
    ensureValueImportAvailable(codemodName, targetFile, "zod", { imported: "z", local: "z" });
    ensureNamedImport(targetFile, "zod", [{ imported: "z", local: "z" }]);
  }
  const grouped = new Map<string, ImportSpecifierInfo[]>();
  for (const binding of neededImports.values()) {
    ensureValueImportAvailable(codemodName, targetFile, binding.targetSource, binding);
    const current = grouped.get(binding.targetSource) ?? [];
    current.push({ imported: binding.imported, local: binding.local });
    grouped.set(binding.targetSource, current);
  }
  for (const [source, specifiers] of [...grouped.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    ensureNamedImport(targetFile, source, specifiers);
  }
}

export function appendSharedSchemaExports<TCandidate extends SharedSchemaCodemodCandidate>(
  targetFile: SourceFile,
  candidates: TCandidate[],
  typeNameForSchema: (schemaName: string) => string,
): void {
  const statements = candidates.map((candidate) => {
    const typeName = typeNameForSchema(candidate.schemaName);
    return `export const ${candidate.schemaName} = ${candidate.schemaText};\n\nexport type ${typeName} = z.infer<typeof ${candidate.schemaName}>;`;
  });
  targetFile.addStatements(`\n${statements.join("\n\n")}`);
}

export function rewriteRouterSharedSchemaReferences<
  TCandidate extends SharedSchemaCodemodCandidate,
>({
  candidates,
  codemodName,
  removeLocalNames,
  routerFile,
  targetSource,
}: {
  candidates: TCandidate[];
  codemodName: string;
  removeLocalNames: Iterable<string>;
  routerFile: SourceFile;
  targetSource: string;
}): void {
  for (const candidate of candidates) {
    if (candidate.kind !== "inline") continue;
    const argument = candidate.schemaCall.getArguments()[0];
    if (!argument) {
      const method = propertyCallMethod(candidate.schemaCall) ?? "schema";
      fail(codemodName, `.${method}(...) call has no argument.`);
    }
    argument.replaceWithText(candidate.schemaName);
  }
  for (const candidate of candidates) {
    if (candidate.constStatement) candidate.constStatement.remove();
  }
  ensureNamedImport(
    routerFile,
    targetSource,
    candidates.map((candidate) => ({
      imported: candidate.schemaName,
      local: candidate.schemaName,
    })),
  );
  for (const localName of new Set(removeLocalNames)) removeUnusedNamedImport(routerFile, localName);
  removeUnusedNamedImport(routerFile, "z");
}

function hasReference(sourceFile: SourceFile, name: string): boolean {
  for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (identifier.getText() === name && isReferenceIdentifier(identifier)) return true;
  }
  return false;
}

function removeUnusedNamedImport(sourceFile: SourceFile, localName: string): void {
  if (hasReference(sourceFile, localName)) return;
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    for (const specifier of importDeclaration.getNamedImports()) {
      const local = specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (local !== localName) continue;
      specifier.remove();
      if (
        importDeclaration.getNamedImports().length === 0 &&
        !importDeclaration.getDefaultImport()
      ) {
        importDeclaration.remove();
      }
      return;
    }
  }
}

export function createProject(): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: {
      useTrailingCommas: false,
    },
  });
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
        `${codemodName} codemod: dry-run would write ${path.relative(root, plan.path)} (${plan.text.length} bytes).`,
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
