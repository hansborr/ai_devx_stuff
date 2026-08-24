// Suppression diff sensor. Reports newly added lint, TypeScript, and Stryker
// suppression comments from the changed-scope unified diff.

import { defaultGitRunner, gitRepoRootArgs } from "../lib/git.js";
import type { FileReader } from "./comments.js";
import { type ChangedDetectorScope, changedFilesFromScope, type DetectorScope } from "./scope.js";
import {
  type CommentScanState,
  compareSuppressions,
  detectSuppressions,
  initialCommentScanState,
  type ParsedSuppression,
  scanCommentSegments,
  toFinding,
} from "./suppressions-parse.js";
import type { DriftFinding } from "./types.js";

export type SuppressionsGitRunner = (repoRoot: string, ref: string) => string;

export type RunSuppressionsCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly repoRoot: string;
  readonly ref: string;
  readonly git: SuppressionsGitRunner;
  readonly readFile: FileReader;
};

// The injectable SuppressionsGitRunner port stays; only its default
// implementation moves onto the seam. Unlike the drift-ai history/blame runners
// this one needs no per-call buffer cap or timeout, so the plain string runner
// plus the seam's own repo-root anchoring is an exact substitution.
export function defaultSuppressionsGitRunner(repoRoot: string, ref: string): string {
  return defaultGitRunner()(gitRepoRootArgs(repoRoot, ["diff", ref]));
}

export function runSuppressionsCheck(options: RunSuppressionsCheckOptions): DriftFinding[] {
  if (options.detectorScope.scopeMode !== "changed") return [];
  const changedFiles = suppressionChangedFilesFromScope(options.detectorScope);
  if (changedFiles.size === 0) return [];
  const changedPaths = new Set(changedFiles.keys());
  const diffText = options.git(options.repoRoot, options.ref);
  const parsed = parseSuppressionDiff(diffText, changedPaths);
  const findings = [...parsed.findings];
  for (const [filePath, status] of changedFiles) {
    if (status !== "added") continue;
    if (parsed.files.has(filePath)) continue;
    const source = options.readFile(filePath);
    if (source === undefined) continue;
    findings.push(...parseAddedFile(filePath, source));
  }
  return findings.sort(compareSuppressions).map(toFinding);
}

function suppressionChangedFilesFromScope(
  detectorScope: ChangedDetectorScope,
): ReadonlyMap<string, "added" | "modified" | "renamed" | "copied"> {
  const files = new Map<string, "added" | "modified" | "renamed" | "copied">();
  for (const file of changedFilesFromScope(detectorScope)) {
    if (file.status === "deleted") continue;
    files.set(file.path, file.status);
  }
  return files;
}

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

type ParsedDiff = {
  readonly findings: readonly ParsedSuppression[];
  readonly files: ReadonlySet<string>;
};

type DiffLineKind =
  | "file-header"
  | "new-file"
  | "hunk-header"
  | "added"
  | "context"
  | "deleted"
  | "meta"
  | "other";

function classifyDiffLine(line: string, inHunk: boolean): DiffLineKind {
  if (line.startsWith("diff --git ")) return "file-header";
  if (!inHunk && line.startsWith("+++ ")) return "new-file";
  if (line.startsWith("@@ ")) return "hunk-header";
  if (!inHunk) return "other";
  if (line.startsWith("+")) return "added";
  if (line.startsWith(" ")) return "context";
  if (line.startsWith("-")) return "deleted";
  if (line.startsWith("\\")) return "meta";
  return "other";
}

function parseHunkStart(line: string): number | undefined {
  const match = HUNK_HEADER_RE.exec(line);
  if (!match) return undefined;
  const start = match[1];
  if (start === undefined) return undefined;
  return Number(start);
}

function scanContent(
  text: string,
  currentFile: string | undefined,
  changedPaths: ReadonlySet<string>,
  scanState: CommentScanState,
): CommentScanState {
  if (currentFile === undefined || !changedPaths.has(currentFile)) return scanState;
  return scanCommentSegments(text, scanState).state;
}

function scanAndDetect(
  text: string,
  currentFile: string | undefined,
  changedPaths: ReadonlySet<string>,
  scanState: CommentScanState,
  newLine: number,
): { readonly state: CommentScanState; readonly findings: readonly ParsedSuppression[] } {
  if (currentFile === undefined || !changedPaths.has(currentFile)) {
    return { state: scanState, findings: [] };
  }
  const scanned = scanCommentSegments(text, scanState);
  return {
    state: scanned.state,
    findings: detectSuppressions(scanned.segments, { file: currentFile, line: newLine, text }),
  };
}

function parseSuppressionDiff(diffText: string, changedPaths: ReadonlySet<string>): ParsedDiff {
  const findings: ParsedSuppression[] = [];
  const files = new Set<string>();
  let currentFile: string | undefined;
  let inHunk = false;
  let newLine = 0;
  let scanState = initialCommentScanState();

  for (const rawLine of diffText.replace(/\r\n/gu, "\n").split("\n")) {
    const line = rawLine.replace(/\r$/u, "");
    const classified = classifyDiffLine(line, inHunk);
    if (classified === "file-header") {
      currentFile = undefined;
      inHunk = false;
      scanState = initialCommentScanState();
    } else if (classified === "new-file") {
      currentFile = parseNewFilePath(line, changedPaths);
      if (currentFile !== undefined) files.add(currentFile);
      scanState = initialCommentScanState();
    } else if (classified === "hunk-header") {
      const start = parseHunkStart(line);
      if (start === undefined) continue;
      newLine = start;
      inHunk = true;
      scanState = initialCommentScanState();
    } else if (classified === "added") {
      const result = scanAndDetect(line.slice(1), currentFile, changedPaths, scanState, newLine);
      scanState = result.state;
      findings.push(...result.findings);
      newLine += 1;
    } else if (classified === "context") {
      scanState = scanContent(line.slice(1), currentFile, changedPaths, scanState);
      newLine += 1;
    } else if (classified === "other") {
      inHunk = false;
      scanState = initialCommentScanState();
    }
  }

  return { findings, files };
}

function parseAddedFile(filePath: string, source: string): ParsedSuppression[] {
  const findings: ParsedSuppression[] = [];
  let scanState = initialCommentScanState();
  let lineNumber = 1;
  for (const line of sourceLines(source)) {
    const scanned = scanCommentSegments(line, scanState);
    scanState = scanned.state;
    findings.push(
      ...detectSuppressions(scanned.segments, {
        file: filePath,
        line: lineNumber,
        text: line,
      }),
    );
    lineNumber += 1;
  }
  return findings;
}

function sourceLines(source: string): string[] {
  const lines = source
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/\r$/u, ""));
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parseNewFilePath(line: string, changedPaths: ReadonlySet<string>): string | undefined {
  const value = line.slice(4).replace(/\t.*$/u, "").trimEnd();
  if (value === "/dev/null") return undefined;
  return stripDiffPathPrefix(unquoteDiffPath(value), changedPaths);
}

function unquoteDiffPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  return value.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
}

function stripDiffPathPrefix(value: string, changedPaths: ReadonlySet<string>): string {
  if (changedPaths.has(value)) return value;
  if (value.startsWith("a/") || value.startsWith("b/")) {
    const stripped = value.slice(2);
    if (changedPaths.has(stripped)) return stripped;
  }
  return value;
}
