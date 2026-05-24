// Suppression diff sensor. Reports newly added lint, TypeScript, and Stryker
// suppression comments from the changed-scope unified diff.

import { execFileSync } from "node:child_process";

import type { DriftFinding } from "../drift-ai.js";
import type { FileReader } from "./comments.js";
import type { DetectorScope } from "./scope.js";

export type SuppressionsGitRunner = (repoRoot: string, ref: string) => string;

export const ESLINT_BROAD_SUPPRESSION_HINT =
  "prefer `eslint-disable-next-line` over a broad disable; include `-- <reason>`.";
export const ESLINT_INLINE_SUPPRESSION_HINT =
  "narrow the rule list and include `-- <reason>`.";
export const TS_EXPECT_ERROR_SUPPRESSION_HINT =
  "keep the suppression line-specific and include `-- <reason>`.";
export const TS_IGNORE_SUPPRESSION_HINT =
  "prefer `@ts-expect-error` over `@ts-ignore`; include `-- <reason>`.";
export const TS_NOCHECK_SUPPRESSION_HINT =
  "prefer a line-level TypeScript suppression; include `-- <reason>`.";
export const STRYKER_SUPPRESSION_HINT =
  "prefer `disable next-line` over a broad mutator disable; include `-- <reason>`.";

type SuppressionKind =
  | "eslint-disable"
  | "eslint-disable-next-line"
  | "eslint-disable-line"
  | "@ts-expect-error"
  | "@ts-ignore"
  | "@ts-nocheck"
  | "Stryker disable"
  | "Stryker disable next-line";

type ParsedSuppression = {
  readonly file: string;
  readonly line: number;
  readonly kind: SuppressionKind;
  readonly target: string;
  readonly reasonPresent: boolean;
  readonly text: string;
  readonly hint: string;
};

type CommentKind = "line" | "block";

type CommentSegment = {
  readonly kind: CommentKind;
  readonly text: string;
};

type StringDelim = '"' | "'" | "`";

type CommentScanState = {
  readonly inBlockComment: boolean;
  readonly inString: StringDelim | false;
};

export type RunSuppressionsCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly repoRoot: string;
  readonly ref: string;
  readonly git: SuppressionsGitRunner;
  readonly readFile: FileReader;
};

export function defaultSuppressionsGitRunner(repoRoot: string, ref: string): string {
  return execFileSync("git", ["-C", repoRoot, "diff", ref], { encoding: "utf8" });
}

export function runSuppressionsCheck(options: RunSuppressionsCheckOptions): DriftFinding[] {
  if (options.detectorScope.scopeMode !== "changed") return [];
  const changedFiles = changedFilesFromScope(options.detectorScope);
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

function changedFilesFromScope(
  detectorScope: DetectorScope,
): ReadonlyMap<string, "added" | "modified" | "renamed" | "copied"> {
  const files = new Map<string, "added" | "modified" | "renamed" | "copied">();
  for (const file of detectorScope.files) {
    if (file.scope !== "changed") continue;
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

function parseSuppressionDiff(
  diffText: string,
  changedPaths: ReadonlySet<string>,
): ParsedDiff {
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

function initialCommentScanState(): CommentScanState {
  return { inBlockComment: false, inString: false };
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

function advanceBlockSegment(
  line: string,
  index: number,
): { readonly segment: CommentSegment; readonly newIndex: number; readonly exited: boolean } {
  const end = line.indexOf("*/", index);
  if (end < 0) {
    return { segment: { kind: "block", text: line.slice(index) }, newIndex: line.length, exited: false };
  }
  return { segment: { kind: "block", text: line.slice(index, end) }, newIndex: end + 2, exited: true };
}

function advanceSegmentString(
  line: string,
  index: number,
  delim: StringDelim,
): { readonly newIndex: number; readonly closed: boolean } {
  const ch = line.charAt(index);
  if (ch === "\\") return { newIndex: index + 2, closed: false };
  if (ch === delim) return { newIndex: index + 1, closed: true };
  return { newIndex: index + 1, closed: false };
}

type SegmentCodeAdvance =
  | { readonly kind: "line-comment"; readonly newIndex: number; readonly text: string }
  | { readonly kind: "block-comment"; readonly newIndex: number }
  | { readonly kind: "string"; readonly newIndex: number; readonly delim: StringDelim }
  | { readonly kind: "other"; readonly newIndex: number };

function advanceSegmentCode(line: string, index: number): SegmentCodeAdvance {
  const ch = line.charAt(index);
  const next = line[index + 1];
  if (ch === "/" && next === "/") {
    return { kind: "line-comment", newIndex: line.length, text: line.slice(index + 2) };
  }
  if (ch === "/" && next === "*") return { kind: "block-comment", newIndex: index + 2 };
  if (ch === '"' || ch === "'" || ch === "`") return { kind: "string", newIndex: index + 1, delim: ch };
  return { kind: "other", newIndex: index + 1 };
}

function scanCommentSegments(
  line: string,
  state: CommentScanState,
): {
  readonly segments: readonly CommentSegment[];
  readonly state: CommentScanState;
} {
  const segments: CommentSegment[] = [];
  let inBlockComment = state.inBlockComment;
  let inString = state.inString;
  let index = 0;
  while (index < line.length) {
    if (inBlockComment) {
      const result = advanceBlockSegment(line, index);
      segments.push(result.segment);
      inBlockComment = !result.exited;
      index = result.newIndex;
      continue;
    }
    if (inString) {
      const result = advanceSegmentString(line, index, inString);
      if (result.closed) inString = false;
      index = result.newIndex;
      continue;
    }
    const result = advanceSegmentCode(line, index);
    if (result.kind === "line-comment") {
      segments.push({ kind: "line", text: result.text });
    } else if (result.kind === "block-comment") {
      inBlockComment = true;
    } else if (result.kind === "string") {
      inString = result.delim;
    }
    index = result.newIndex;
  }
  return { segments, state: { inBlockComment, inString } };
}

function detectSuppressions(
  segments: readonly CommentSegment[],
  location: {
    readonly file: string;
    readonly line: number;
    readonly text: string;
  },
): ParsedSuppression[] {
  const findings: ParsedSuppression[] = [];
  for (const segment of segments) {
    const commentText = normalizeCommentText(segment.text);
    const eslint = parseEslintSuppression(commentText, location);
    if (eslint !== undefined) {
      findings.push(eslint);
      continue;
    }
    const ts = parseTypeScriptSuppression(commentText, location);
    if (ts !== undefined) {
      findings.push(ts);
      continue;
    }
    if (segment.kind === "line") {
      const stryker = parseStrykerSuppression(commentText, location);
      if (stryker !== undefined) findings.push(stryker);
    }
  }
  return findings;
}

function normalizeCommentText(text: string): string {
  return text.replace(/^\s*\*\s?/u, "").trimStart();
}

const ESLINT_SUPPRESSION_RE =
  /^(eslint-disable-next-line|eslint-disable-line|eslint-disable)(?:\s+(.*)|$)/u;

function parseEslintSuppression(
  commentText: string,
  location: {
    readonly file: string;
    readonly line: number;
    readonly text: string;
  },
): ParsedSuppression | undefined {
  const match = ESLINT_SUPPRESSION_RE.exec(commentText);
  if (!match) return undefined;
  const kind = match[1];
  if (!isEslintSuppressionKind(kind)) return undefined;
  const reason = splitReason(match[2] ?? "");
  const target = eslintTarget(reason.targetText);
  return {
    ...location,
    kind,
    target,
    reasonPresent: reason.reasonPresent,
    hint:
      kind === "eslint-disable" ? ESLINT_BROAD_SUPPRESSION_HINT : ESLINT_INLINE_SUPPRESSION_HINT,
  };
}

function isEslintSuppressionKind(value: string | undefined): value is
  | "eslint-disable"
  | "eslint-disable-next-line"
  | "eslint-disable-line" {
  return (
    value === "eslint-disable" ||
    value === "eslint-disable-next-line" ||
    value === "eslint-disable-line"
  );
}

function eslintTarget(targetText: string): string {
  const rules = targetText
    .split(",")
    .map((rule) => rule.trim())
    .filter((rule) => rule.length > 0);
  return rules.length === 0 ? "all" : rules.join(",");
}

const TS_SUPPRESSION_RE = /^(@ts-expect-error|@ts-ignore|@ts-nocheck)(?:\b|\s|$)(.*)$/u;

function parseTypeScriptSuppression(
  commentText: string,
  location: {
    readonly file: string;
    readonly line: number;
    readonly text: string;
  },
): ParsedSuppression | undefined {
  const match = TS_SUPPRESSION_RE.exec(commentText);
  if (!match) return undefined;
  const kind = match[1];
  if (!isTypeScriptSuppressionKind(kind)) return undefined;
  const reason = splitReason(match[2] ?? "");
  return {
    ...location,
    kind,
    target: kind === "@ts-nocheck" ? "file" : "next-line",
    reasonPresent: reason.reasonPresent,
    hint: typeScriptHint(kind),
  };
}

function isTypeScriptSuppressionKind(value: string | undefined): value is
  | "@ts-expect-error"
  | "@ts-ignore"
  | "@ts-nocheck" {
  return value === "@ts-expect-error" || value === "@ts-ignore" || value === "@ts-nocheck";
}

function typeScriptHint(kind: "@ts-expect-error" | "@ts-ignore" | "@ts-nocheck"): string {
  switch (kind) {
    case "@ts-expect-error":
      return TS_EXPECT_ERROR_SUPPRESSION_HINT;
    case "@ts-ignore":
      return TS_IGNORE_SUPPRESSION_HINT;
    case "@ts-nocheck":
      return TS_NOCHECK_SUPPRESSION_HINT;
  }
}

const STRYKER_SUPPRESSION_RE = /^stryker\s+disable(?:\s+(next-line))?(?:\s+(.*)|$)/iu;

function parseStrykerSuppression(
  commentText: string,
  location: {
    readonly file: string;
    readonly line: number;
    readonly text: string;
  },
): ParsedSuppression | undefined {
  const match = STRYKER_SUPPRESSION_RE.exec(commentText);
  if (!match) return undefined;
  const nextLine = match[1] !== undefined;
  const reason = splitReason(match[2] ?? "");
  return {
    ...location,
    kind: nextLine ? "Stryker disable next-line" : "Stryker disable",
    target: reason.targetText.length === 0 ? "all" : reason.targetText,
    reasonPresent: reason.reasonPresent,
    hint: STRYKER_SUPPRESSION_HINT,
  };
}

function splitReason(text: string): {
  readonly targetText: string;
  readonly reasonPresent: boolean;
} {
  const marker = text.indexOf("--");
  if (marker < 0) return { targetText: text.trim(), reasonPresent: false };
  return {
    targetText: text.slice(0, marker).trim(),
    reasonPresent: text.slice(marker + 2).trim().length > 0,
  };
}

function toFinding(suppression: ParsedSuppression): DriftFinding {
  return {
    check: "suppressions",
    file: suppression.file,
    message: `new ${suppression.kind} suppression at line ${suppression.line} targets ${suppression.target} (reason: ${
      suppression.reasonPresent ? "present" : "missing"
    })`,
    hint: suppression.hint,
    details: {
      kind: suppression.kind,
      target: suppression.target,
      line: suppression.line,
      reasonPresent: suppression.reasonPresent,
      text: suppression.text,
    },
  };
}

function compareSuppressions(left: ParsedSuppression, right: ParsedSuppression): number {
  return (
    left.file.localeCompare(right.file, "en") ||
    left.line - right.line ||
    left.kind.localeCompare(right.kind, "en") ||
    left.target.localeCompare(right.target, "en")
  );
}
