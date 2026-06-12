import path from "node:path";

import {
  type CallExpression,
  type ExpressionStatement,
  Node,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

import { CODEMOD_NAME } from "./constants.js";
import { specifierMatchesContext } from "./paths.js";
import type { BarrelContext, MockCallInfo } from "./types.js";

export function warningPrefix(root: string, filePath: string, line: number): string {
  return `${CODEMOD_NAME} codemod: warning ${path.relative(root, filePath)}:${String(line)}`;
}

export function staticString(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return undefined;
}

export function mockCallInfo(node: Node): MockCallInfo | undefined {
  if (!Node.isCallExpression(node)) return undefined;
  const expression = node.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  const framework = expression.getExpression().getText();
  const name = expression.getName();
  if (framework === "vi" && (name === "mock" || name === "importActual")) {
    return { framework, method: name };
  }
  if (framework === "jest" && name === "mock") return { framework, method: name };
  return undefined;
}

function mockKey(framework: string, specifier: string): string {
  return `${framework}\0${specifier}`;
}

function collectExistingMockKeys(sourceFile: SourceFile): Set<string> {
  const keys = new Set<string>();
  for (const call of sourceFile.getDescendants().filter(Node.isCallExpression)) {
    const info = mockCallInfo(call);
    if (!info || info.method !== "mock") continue;
    const specifier = staticString(call.getArguments()[0]);
    if (!specifier) continue;
    keys.add(mockKey(info.framework, specifier));
  }
  return keys;
}

function warnMockCallLeftUnchanged(
  sourceFile: SourceFile,
  call: Node,
  info: MockCallInfo,
  specifier: string,
  root: string,
): void {
  console.log(
    `${warningPrefix(
      root,
      sourceFile.getFilePath(),
      call.getStartLineNumber(),
    )} ${info.framework}.${info.method}("${specifier}") left unchanged.`,
  );
}

function missingMockSources(
  existingMockKeys: ReadonlySet<string>,
  info: MockCallInfo,
  directSources: ReadonlySet<string>,
): string[] {
  return [...directSources]
    .sort((left, right) => left.localeCompare(right, "en"))
    .filter((directSource) => !existingMockKeys.has(mockKey(info.framework, directSource)));
}

function standaloneMockStatement(call: Node): ExpressionStatement | undefined {
  const statement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  if (!statement || statement.getExpression().getStart() !== call.getStart()) return undefined;
  return statement;
}

function appendDirectMocks(
  statement: ExpressionStatement,
  info: MockCallInfo,
  directSources: readonly string[],
  existingMockKeys: Set<string>,
): void {
  statement.replaceWithText(
    [
      statement.getText(),
      ...directSources.map((directSource) => {
        return `${info.framework}.mock("${directSource}");`;
      }),
    ].join("\n"),
  );
  for (const directSource of directSources) {
    existingMockKeys.add(mockKey(info.framework, directSource));
  }
}

function transformMockCallReference(
  context: BarrelContext,
  sourceFile: SourceFile,
  root: string,
  directMockSourcesByOriginalSource: ReadonlyMap<string, ReadonlySet<string>>,
  existingMockKeys: Set<string>,
  call: CallExpression,
): boolean {
  const info = mockCallInfo(call);
  if (!info) return false;
  const specifier = staticString(call.getArguments()[0]);
  if (!specifier || !specifierMatchesContext(context, sourceFile.getFilePath(), specifier)) {
    return false;
  }
  if (info.method === "importActual" || call.getArguments().length !== 1) {
    warnMockCallLeftUnchanged(sourceFile, call, info, specifier, root);
    return false;
  }

  const directSources = directMockSourcesByOriginalSource.get(specifier);
  if (!directSources || directSources.size === 0) {
    warnMockCallLeftUnchanged(sourceFile, call, info, specifier, root);
    return false;
  }

  const missingDirectSources = missingMockSources(existingMockKeys, info, directSources);
  if (missingDirectSources.length === 0) return false;

  const statement = standaloneMockStatement(call);
  if (!statement) {
    warnMockCallLeftUnchanged(sourceFile, call, info, specifier, root);
    return false;
  }

  appendDirectMocks(statement, info, missingDirectSources, existingMockKeys);
  return true;
}

export function transformMockStringReferences(
  context: BarrelContext,
  sourceFile: SourceFile,
  root: string,
  directMockSourcesByOriginalSource: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  let changed = false;
  const existingMockKeys = collectExistingMockKeys(sourceFile);
  const calls = sourceFile
    .getDescendants()
    .filter(Node.isCallExpression)
    .sort((left, right) => right.getStart() - left.getStart());

  for (const call of calls) {
    if (
      transformMockCallReference(
        context,
        sourceFile,
        root,
        directMockSourcesByOriginalSource,
        existingMockKeys,
        call,
      )
    ) {
      changed = true;
    }
  }
  return changed;
}
