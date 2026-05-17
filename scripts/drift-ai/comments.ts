// Comment-ratio drift sensor. Flags changed source files where comments
// crowd out code without punishing the invariant/concurrency/authorization
// notes that are intentionally dense in this repo.
//
// Pure analysis (analyzeCommentMetrics) is exported so fixture coverage in
// comments.test.ts can pin the line classifier without touching disk. The
// runner depends only on an injectable file reader so the same shape can be
// tested in isolation and wired into drift-ai.ts at the integration layer.

import { readFileSync } from "node:fs";
import path from "node:path";

import type { DriftFinding } from "../drift-ai.js";

import { pathHasAnyPrefix } from "./config.js";
import type { DetectorScope } from "./scope.js";

// 120 effective code lines is large enough that a real file can earn its
// invariant comments without warning. Tighten only after we have real reports
// to look at.
const DEFAULT_EFFECTIVE_LINES_THRESHOLD = 120;

// 40% comment lines among non-blank lines: the conservative end of the
// 35-40% range in docs/agent_notes/in_progress/ai-drift-sensors.md. Higher
// keeps false positives down while the sensor is report-only.
const DEFAULT_COMMENT_RATIO_WARN = 0.4;

export const COMMENTS_REPAIR_HINT =
  "keep comments that explain invariants, concurrency, authorization, or rules provenance; remove narration that restates code.";

const SOURCE_LIKE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export type CommentMetrics = {
  readonly effective: number;
  readonly comment: number;
  readonly blank: number;
  readonly total: number;
};

type StringDelim = '"' | "'" | "`";

type LineState = {
  readonly hasCode: boolean;
  readonly hasComment: boolean;
  readonly endInBlockComment: boolean;
  readonly endInString: StringDelim | false;
};

// Single-pass classifier: walks the source once, tracking string and block
// comment state across line boundaries. Each line is classified as:
//   - effective: any non-whitespace code outside a comment
//   - comment:   no code, but at least one character inside a comment
//   - blank:     neither (whitespace only)
// `//` and `/*` inside string literals do not start a comment; `"..."` and
// backtick template-literal contents inside a block comment do not start a
// string. Both block-comment and string state persist across line boundaries
// so multi-line template literals (and `\`-continued single/double quoted
// strings) keep their continuation lines marked as code rather than letting
// a stray `//` inside the literal flip the line into a comment.
// Template-literal expressions (`${...}`) are treated as code: lines
// containing them already have non-whitespace before/after the literal in
// practice, and the line counter only cares whether code is present at all.
export function analyzeCommentMetrics(source: string): CommentMetrics {
  const normalized = source.replace(/\r\n/gu, "\n");
  // A trailing newline produces a final empty segment from split; drop it so a
  // file like "a\nb\n" reports two lines, not three. A file with no trailing
  // newline keeps every segment.
  const segments = normalized.split("\n");
  if (segments.length > 0 && segments[segments.length - 1] === "") segments.pop();

  let inBlockComment = false;
  let inString: StringDelim | false = false;
  let effective = 0;
  let comment = 0;
  let blank = 0;
  for (const line of segments) {
    const result = classifyLine(line, inBlockComment, inString);
    inBlockComment = result.endInBlockComment;
    inString = result.endInString;
    if (result.hasCode) effective += 1;
    else if (result.hasComment) comment += 1;
    else blank += 1;
  }
  return { effective, comment, blank, total: segments.length };
}

function classifyLine(
  line: string,
  startInBlockComment: boolean,
  startInString: StringDelim | false,
): LineState {
  let inBlockComment = startInBlockComment;
  let inLineComment = false;
  let inString: StringDelim | false = startInString;
  let hasCode = false;
  let hasComment = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i] ?? "";
    const next = line[i + 1];
    if (inBlockComment) {
      hasComment = true;
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inLineComment) {
      hasComment = true;
      i += 1;
      continue;
    }
    if (inString) {
      // A line that only continues a multi-line string (no other tokens
      // beyond the string body) is still code, not a comment line.
      if (ch !== " " && ch !== "\t") hasCode = true;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      hasComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      hasComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      hasCode = true;
      i += 1;
      continue;
    }
    if (ch !== " " && ch !== "\t") {
      hasCode = true;
    }
    i += 1;
  }
  return {
    hasCode,
    hasComment,
    endInBlockComment: inBlockComment,
    endInString: inString,
  };
}

// Path-level filter for the comments check. Tests, fixtures, and declaration
// files stay out by default; project-specific tooling prefixes belong in
// drift-ai.config.json so non-Musi repositories are not filtered by Musi's
// source layout.
function isExcludedFromComments(filePath: string, excludePrefixes: readonly string[]): boolean {
  const posix = toPosix(filePath);
  if (posix.endsWith(".d.ts")) return true;
  if (pathHasAnyPrefix(posix, excludePrefixes)) return true;
  const segments = posix.split("/");
  if (segments.includes("__tests__")) return true;
  if (segments.includes("fixtures") || segments.includes("__fixtures__")) return true;
  const base = segments[segments.length - 1] ?? "";
  if (/\.(test|spec|fixture)\.[cm]?[jt]sx?$/u.test(base)) return true;
  return false;
}

function isSourceLike(filePath: string): boolean {
  return SOURCE_LIKE_EXTS.has(path.extname(filePath).toLowerCase());
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function nonBlank(metrics: CommentMetrics): number {
  return metrics.effective + metrics.comment;
}

function ratio(metrics: CommentMetrics): number {
  const denom = nonBlank(metrics);
  return denom === 0 ? 0 : metrics.comment / denom;
}

function formatPercent(value: number): number {
  return Math.round(value * 100);
}

export type FileReader = (filePath: string) => string | undefined;

// Defense in depth mirroring defaultDirectoryListing: changed-file paths are
// git-tracked, but a `..` segment or absolute path in scope would otherwise
// let `path.resolve` walk outside the repo. Collapse first, verify the result
// is contained in the repo root, then read.
export function defaultFileReader(repoRoot: string): FileReader {
  const root = path.resolve(repoRoot);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return (filePath) => {
    const target = path.resolve(root, filePath);
    if (target !== root && !target.startsWith(rootWithSep)) return undefined;
    try {
      return readFileSync(target, "utf8");
    } catch {
      return undefined;
    }
  };
}

export type RunCommentsCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly readFile: FileReader;
  readonly excludePrefixes?: readonly string[];
  readonly effectiveLinesThreshold?: number;
  readonly ratioWarn?: number;
};

export function runCommentsCheck(options: RunCommentsCheckOptions): DriftFinding[] {
  const threshold = options.effectiveLinesThreshold ?? DEFAULT_EFFECTIVE_LINES_THRESHOLD;
  const warnRatio = options.ratioWarn ?? DEFAULT_COMMENT_RATIO_WARN;
  const excludePrefixes = options.excludePrefixes ?? [];
  const candidates = commentCandidates(options.detectorScope, excludePrefixes);
  const findings: DriftFinding[] = [];
  for (const filePath of candidates) {
    const finding = scoreCommentCandidate(filePath, options.readFile, threshold, warnRatio);
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
}

function commentCandidates(
  detectorScope: DetectorScope,
  excludePrefixes: readonly string[],
): string[] {
  if (detectorScope.scopeMode === "current") {
    return currentCommentCandidates(detectorScope, excludePrefixes);
  }
  return changedCommentCandidates(detectorScope, excludePrefixes);
}

function changedCommentCandidates(
  detectorScope: DetectorScope,
  excludePrefixes: readonly string[],
): string[] {
  const candidates: string[] = [];
  for (const file of detectorScope.files) {
    if (file.scope !== "changed" || file.status === "deleted") continue;
    if (!isCommentCandidate(file.path, excludePrefixes)) continue;
    candidates.push(file.path);
  }
  return candidates.sort((left, right) => left.localeCompare(right, "en"));
}

function currentCommentCandidates(
  detectorScope: DetectorScope,
  excludePrefixes: readonly string[],
): string[] {
  const candidates: string[] = [];
  for (const file of detectorScope.files) {
    if (file.scope !== "current") continue;
    if (!isCommentCandidate(file.path, excludePrefixes)) continue;
    candidates.push(file.path);
  }
  return candidates.sort((left, right) => left.localeCompare(right, "en"));
}

function isCommentCandidate(filePath: string, excludePrefixes: readonly string[]): boolean {
  if (!isSourceLike(filePath)) return false;
  return !isExcludedFromComments(filePath, excludePrefixes);
}

function scoreCommentCandidate(
  filePath: string,
  readFile: FileReader,
  threshold: number,
  warnRatio: number,
): DriftFinding | undefined {
  const source = readFile(filePath);
  if (source === undefined) return undefined;
  const metrics = analyzeCommentMetrics(source);
  if (metrics.effective <= threshold) return undefined;
  const r = ratio(metrics);
  if (r < warnRatio) return undefined;
  return {
    check: "comments",
    file: filePath,
    message: `${formatPercent(r)}% of non-blank lines are comments over ${metrics.effective} effective code lines (warn at ${formatPercent(warnRatio)}% on files with more than ${threshold} effective lines)`,
    hint: COMMENTS_REPAIR_HINT,
  };
}
