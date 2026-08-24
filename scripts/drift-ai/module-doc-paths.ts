// MODULE.md path-freshness sensor. Validates that backtick *file* references in
// `MODULE.md` / `*-MODULE.md` docs still resolve to a real file, so a renamed or
// deleted file leaves a visible trail in the module note that points at it.
//
// Path existence only — symbols named in prose are out of scope. The check is
// report-only and opt-in (`runByDefault: false`).
//
// Resolution is deliberately multi-base. MODULE.md authors write paths against
// several anchors: the module's own directory (`./connection-handler.ts`), a
// shared sibling under the parent (`entries/entry-dialog.tsx`), the package
// `src`/package root (`utils/foo.ts`, `src/test/mock-trpc.tsx`), or the repo root
// (`docs/CONCURRENCY.md`). A reference is treated as fresh when it resolves under
// ANY candidate base. This favors precision (few false positives) over recall: a
// path that has genuinely drifted but happens to also exist under another base is
// not flagged. `./` and `../` references are unambiguous, so they resolve against
// the module's own directory only.

import path from "node:path";

import { extractInlineCodeTokens } from "./backtick-paths.js";
import { matchesAnyGlob } from "./config-match.js";
import { defaultPathIgnored, type PathIgnored } from "./repo-ignore.js";
import { compareStrings, type PathProbe, type RepoFileReader } from "./repo-io.js";
import type { DriftFinding } from "./types.js";

export type ModuleDocPathsFinding = DriftFinding & { readonly check: "module-doc-paths" };

export type RunModuleDocPathsOptions = {
  // Used only to build the default git check-ignore probe when `isIgnored` is not
  // injected; resolution itself is repo-root-relative via the injected probes.
  readonly repoRoot?: string;
  readonly roots: readonly string[];
  // Repo-relative paths of the MODULE.md / *-MODULE.md files to scan.
  readonly listModuleDocs: () => readonly string[];
  readonly readFile: RepoFileReader;
  readonly pathExists: PathProbe;
  readonly isIgnored?: PathIgnored;
  readonly excludeGlobs?: readonly string[];
};

// File extensions a backtick token must end in to be treated as a path reference.
// Requiring a known extension is the main noise filter: it keeps `identifier.member`
// prose (`character.get`, `socket.broadcast`) from being mistaken for files.
const KNOWN_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".md",
  ".css",
  ".scss",
  ".sql",
  ".prisma",
  ".yml",
  ".yaml",
  ".sh",
  ".txt",
  ".html",
]);

// NodeNext docs reference the emitted `.js` specifier; the real file on disk is the
// `.ts`/`.tsx` source. Existence checks try these fallbacks before flagging.
const EXTENSION_FALLBACKS: ReadonlyMap<string, readonly string[]> = new Map([
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
]);

const SEGMENT_RE = /^[\w.@-]+$/u;
const URI_SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

type PendingReference = {
  readonly doc: string;
  readonly line: number;
  readonly raw: string;
  // Repo-relative candidate paths the reference could resolve to (no ext fallbacks).
  readonly candidates: readonly string[];
};

export function runModuleDocPathsCheck(
  options: RunModuleDocPathsOptions,
): readonly ModuleDocPathsFinding[] {
  const excludeGlobs = options.excludeGlobs ?? [];
  const docs = [...new Set(options.listModuleDocs())]
    .filter((doc) => !matchesAnyGlob(doc, excludeGlobs))
    .sort(compareStrings);

  const pending: PendingReference[] = [];
  for (const doc of docs) {
    const content = options.readFile(doc);
    if (content === undefined) continue;
    collectPendingReferences(doc, content, options, pending);
  }

  if (pending.length === 0) return [];
  const isIgnored = options.isIgnored ?? buildDefaultIgnored(options.repoRoot, pending);
  return pending.filter((item) => !allCandidatesIgnored(item, isIgnored)).map(buildFinding);
}

function collectPendingReferences(
  doc: string,
  content: string,
  options: RunModuleDocPathsOptions,
  pending: PendingReference[],
): void {
  const bases = candidateBases(doc, options.roots);
  const emitted = new Set<string>();
  for (const token of extractInlineCodeTokens(content)) {
    const reference = qualifyReference(token.raw);
    if (reference === undefined) continue;
    const key = `${String(token.line)}:${reference}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    const candidates = resolveCandidates(reference, bases);
    // A reference that escapes the repo under every base (a deep `../` chain)
    // cannot name an in-repo file; treat it as out of scope, not stale.
    if (candidates.length === 0) continue;
    if (candidates.some((candidate) => existsWithFallback(candidate, options.pathExists))) continue;
    pending.push({ doc, line: token.line, raw: token.raw, candidates });
  }
}

function buildFinding(item: PendingReference): ModuleDocPathsFinding {
  return {
    check: "module-doc-paths",
    file: `${item.doc}:${String(item.line)}`,
    message: `backtick path ${item.raw} does not resolve to a file`,
    hint: "update the reference to the file's new location, or remove it if the file was deleted.",
    details: { line: item.line, path: item.raw },
  };
}

function allCandidatesIgnored(item: PendingReference, isIgnored: PathIgnored): boolean {
  return item.candidates.every((candidate) => isIgnored(candidate));
}

function buildDefaultIgnored(
  repoRoot: string | undefined,
  pending: readonly PendingReference[],
): PathIgnored {
  const candidates = [...new Set(pending.flatMap((item) => item.candidates))];
  return defaultPathIgnored(repoRoot ?? process.cwd(), candidates, "module-doc-paths");
}

// Anchors a reference may be written against, in resolution order. Deduped so a
// reference is reported missing only when it resolves under none of them.
function candidateBases(docPath: string, roots: readonly string[]): readonly string[] {
  const moduleDir = posixDirname(docPath);
  const bases = [moduleDir, posixDirname(moduleDir)];
  for (const root of roots) {
    bases.push(root);
    const parent = posixDirname(root);
    if (parent !== ".") bases.push(parent);
  }
  bases.push(".");
  return [...new Set(bases)];
}

function resolveCandidates(reference: string, bases: readonly string[]): readonly string[] {
  const dotted = reference.startsWith("./") || reference.startsWith("../");
  // `./` and `../` are anchored to the module's own directory by definition.
  const resolveBases = dotted ? bases.slice(0, 1) : bases;
  const out = new Set<string>();
  for (const base of resolveBases) {
    const joined = path.posix.normalize(path.posix.join(base, reference));
    if (joined.startsWith("../") || joined === "..") continue; // escapes the repo
    out.add(joined);
  }
  return [...out];
}

function existsWithFallback(repoRelative: string, pathExists: PathProbe): boolean {
  if (pathExists(repoRelative)) return true;
  const ext = lastExtension(repoRelative);
  const stem = repoRelative.slice(0, repoRelative.length - ext.length);
  return (EXTENSION_FALLBACKS.get(ext) ?? []).some((alt) => pathExists(`${stem}${alt}`));
}

// A backtick token qualifies as a file-path reference when it is a multi-segment
// relative path ending in a known file extension. Returns the posix-normalized
// (backslash-free) form, or undefined when the token is not a checkable file path.
function qualifyReference(raw: string): string | undefined {
  if (raw.trim() !== raw || /\s/u.test(raw)) return undefined;
  if (raw.startsWith("@")) return undefined; // package specifier, not a repo path
  const normalized = raw.replaceAll("\\", "/");
  if (!isRelativeFilePathShape(normalized)) return undefined;
  if (!KNOWN_FILE_EXTENSIONS.has(lastExtension(normalized))) return undefined;
  return normalized;
}

// Multi-segment relative file path (not absolute, not a URI, not a bare filename,
// not a directory ref), with every segment a plain path component.
function isRelativeFilePathShape(normalized: string): boolean {
  if (normalized.startsWith("/") || URI_SCHEME_RE.test(normalized)) return false;
  if (!normalized.includes("/") || normalized.endsWith("/")) return false;
  return normalized.split("/").every(isPathSegment);
}

function isPathSegment(segment: string): boolean {
  return segment === "." || segment === ".." || SEGMENT_RE.test(segment);
}

function lastExtension(value: string): string {
  const segment = value.slice(value.lastIndexOf("/") + 1);
  const dot = segment.lastIndexOf(".");
  return dot <= 0 ? "" : segment.slice(dot).toLowerCase();
}

function posixDirname(value: string): string {
  return path.posix.dirname(value);
}
