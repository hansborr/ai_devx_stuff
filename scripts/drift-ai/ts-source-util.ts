import { ts } from "ts-morph";

export function scriptKindFor(filePath: string): ts.ScriptKind {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

// `ts.Node.parent` is typed non-nullable, so a plain `while (cursor !== undefined)`
// walk trips `@typescript-eslint/no-unnecessary-condition`. Stop at the SourceFile
// root instead. Walks strictly upward (the start node is never tested), returning
// the nearest matching ancestor or `undefined` when the walk reaches the root.
export function findAncestor(
  node: ts.Node,
  predicate: (candidate: ts.Node) => boolean,
): ts.Node | undefined {
  let cursor: ts.Node = node.parent;
  while (!ts.isSourceFile(cursor)) {
    if (predicate(cursor)) return cursor;
    cursor = cursor.parent;
  }
  return predicate(cursor) ? cursor : undefined;
}

export function hasAncestor(node: ts.Node, predicate: (candidate: ts.Node) => boolean): boolean {
  return findAncestor(node, predicate) !== undefined;
}

// `ts.sys.fileExists` and friends trip `@typescript-eslint/unbound-method` when
// referenced as bare method values. These arrow-bound wrappers (and the host
// factory below) keep the `this` binding correct so callers never re-derive the
// arrow wrapper at each TS-compiler I/O seam.
export function tsSysReadFile(filePath: string): string | undefined {
  return ts.sys.readFile(filePath);
}

export function tsSysFileExists(filePath: string): boolean {
  return ts.sys.fileExists(filePath);
}

// A `ts.ModuleResolutionHost` whose filesystem methods delegate to `ts.sys` with
// `this` bound, and whose current directory is the repo root. `realpath` is
// intentionally omitted: it only canonicalizes symlinks, which for source-tree
// resolution against a single repoRoot does not matter.
export function tsSysModuleResolutionHost(repoRoot: string): ts.ModuleResolutionHost {
  return {
    fileExists: (file) => ts.sys.fileExists(file),
    readFile: (file) => ts.sys.readFile(file),
    directoryExists: (dir) => ts.sys.directoryExists(dir),
    getCurrentDirectory: () => repoRoot,
    getDirectories: (dir) => ts.sys.getDirectories(dir),
  };
}

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((item) => item.kind === kind) === true
  );
}

export function sourceLineCount(source: string): number {
  const normalized = source.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return Math.max(1, lines.length);
}
