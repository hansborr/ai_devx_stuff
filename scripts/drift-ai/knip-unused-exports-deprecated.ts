// `@deprecated` overlay for the unused-exports adapter. knip already decides what
// is unreachable (target-configured reachability, adapter contract §1); this module
// adds ONLY a local annotation signal: which of those symbols are also annotated
// `@deprecated` in their own JSDoc/declaration trivia. A symbol that is both
// deprecated AND reported unused is a conservative tombstone-removal candidate.
//
// Detection is AST-exact, not a line scan: we parse each file once and index the
// (line, col) of every named declaration that carries a `@deprecated` JSDoc tag,
// then look symbols up by knip's reported name position. `ts.getJSDocTags` resolves
// declaration trivia correctly — it hoists a leading JSDoc block onto a
// `const`/`let` declaration and does NOT bleed a container's `@deprecated` (an enum
// or namespace) onto its members. Anything we cannot resolve to a deprecated
// declaration at that exact position stays un-flagged (no location, unreadable
// file, or a position that matches no named declaration → no overlay), so the
// overlay never fabricates a verdict.
//
// One deliberate edge: a multi-declarator statement (`export const a = 1, b = 2;`)
// with a single leading `@deprecated` block hoists the tag to the FIRST declarator
// only, so only `a`'s position is indexed. That is conservative (per-declarator name
// positions) and the case is vanishingly rare for exported symbols.

import { ts } from "ts-morph";

import { type UnusedExportSymbol } from "./knip-unused-exports.js";
import { toPosix } from "./path-util.js";
import type { RepoFileReader } from "./repo-io.js";
import { scriptKindFor } from "./ts-source-util.js";

export type DeprecatedExportLookup = (symbol: UnusedExportSymbol) => boolean;

// Build a memoizing lookup over the target's source. Each file is read and parsed
// at most once per lookup instance; a lookup instance is built per check run, so the
// cache never outlives a report build. A symbol is deprecated-flagged only when its
// reported (line, col) maps exactly to a named declaration that carries a
// `@deprecated` JSDoc tag.
export function createDeprecatedExportLookup(readFile: RepoFileReader): DeprecatedExportLookup {
  const positionsByFile = new Map<string, ReadonlySet<string>>();
  return (symbol) => {
    if (symbol.line === undefined || symbol.col === undefined) return false;
    return deprecatedPositionsFor(symbol.file, positionsByFile, readFile).has(
      positionKey(symbol.line, symbol.col),
    );
  };
}

const EMPTY_POSITIONS: ReadonlySet<string> = new Set();

function deprecatedPositionsFor(
  file: string,
  cache: Map<string, ReadonlySet<string>>,
  readFile: RepoFileReader,
): ReadonlySet<string> {
  const posixFile = toPosix(file);
  const cached = cache.get(posixFile);
  if (cached !== undefined) return cached;
  const positions = computeDeprecatedPositions(posixFile, readFile);
  cache.set(posixFile, positions);
  return positions;
}

function computeDeprecatedPositions(file: string, readFile: RepoFileReader): ReadonlySet<string> {
  const source = readFile(file);
  if (source === undefined) return EMPTY_POSITIONS;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const positions = new Set<string>();
  const visit = (node: ts.Node): void => {
    const name = deprecatedDeclarationName(node);
    if (name !== undefined) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        name.getStart(sourceFile),
      );
      positions.add(positionKey(line + 1, character + 1));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return positions;
}

// The name identifier of a named declaration that carries a `@deprecated` JSDoc
// tag, or undefined. Each `ts.isX` guard narrows `node.name` to its real type, so
// the identifier check needs no assertion. The declaration kinds cover knip's four
// symbol categories: value/function/class exports, type/interface exports, enum
// members, and namespace members (plus class members, which knip can also report).
function deprecatedDeclarationName(node: ts.Node): ts.Identifier | undefined {
  const name = declarationNameIdentifier(node);
  if (name === undefined) return undefined;
  return hasDeprecatedTag(node) ? name : undefined;
}

function declarationNameIdentifier(node: ts.Node): ts.Identifier | undefined {
  // Split across two guard helpers purely to keep each under the complexity
  // ratchet; each `ts.isX` guard narrows `node.name` so no assertion is needed.
  const name = valueDeclarationName(node) ?? typeMemberDeclarationName(node);
  return name !== undefined && ts.isIdentifier(name) ? name : undefined;
}

function valueDeclarationName(node: ts.Node): ts.DeclarationName | undefined {
  if (
    ts.isVariableDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isEnumMember(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return node.name;
  }
  return undefined;
}

function typeMemberDeclarationName(node: ts.Node): ts.DeclarationName | undefined {
  if (
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.name;
  }
  return undefined;
}

function hasDeprecatedTag(node: ts.Node): boolean {
  return ts.getJSDocTags(node).some(isDeprecatedTag);
}

// JSDoc tag names are parsed as identifiers; `@deprecated` is the standard tag.
// Lower-cased so a stray `@Deprecated` still reads as the same intent.
function isDeprecatedTag(tag: ts.JSDocTag): boolean {
  return tag.tagName.text.toLowerCase() === "deprecated";
}

function positionKey(line: number, col: number): string {
  return `${line}:${col}`;
}
