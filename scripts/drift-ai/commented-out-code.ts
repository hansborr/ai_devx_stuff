// Commented-out-code drift sensor. Flags consecutive pure-comment regions whose
// stripped text parses cleanly as TypeScript/JavaScript and contains at least one
// operative construct (a declaration, control-flow statement, call, assignment,
// import/export, etc.). This is a different refactor-residue signal from the
// `comments` ratio sensor: a tombstoned code block left behind in comments, not a
// file that is merely over-narrated.
//
// Evidence, not a verdict: a row says the block *looks like* commented-out code,
// never that the code is unreachable or safe to delete. The whole region must
// parse with zero syntax errors, which is what separates a commented-out block
// from prose — ordinary sentences and JSDoc do not parse as statements. Pure
// analysis (findCommentedOutRegions) is exported so fixture coverage can pin the
// classifier without touching disk; the runner depends only on an injectable file
// reader, mirroring the comments check.

import { DEFAULT_COMMENTED_OUT_CODE_MIN_LINES } from "./commented-out-code-config-values.js";
import { codeShapedConstruct } from "./commented-out-code-operative.js";
import { pathHasAnyPrefix } from "./config-match.js";
import { hashFeature } from "./feature-hash.js";
import { initialLineScanState, type LineScanState, scanLine } from "./line-scanner.js";
import { isSourceLike, toPosix } from "./path-util.js";
import type { RepoFileReader } from "./repo-io.js";
import type { DetectorScope } from "./scope.js";
import type { DriftFinding } from "./types.js";

export { defaultFileReader } from "./repo-io.js";

// First-line previews are truncated so text output never dumps a whole block
// (the row carries a hash + first-line preview, not the source).
const PREVIEW_MAX_LENGTH = 80;

export const COMMENTED_OUT_CODE_HINT =
  "if this is dead code, delete it — version control preserves the history; if it records intent, rewrite it as prose. Text-shape evidence only: it does not assert the code is unreachable or safe to remove.";

export type FileReader = RepoFileReader;

// One detected region within a single file. Line numbers are 1-based and inclusive
// over the physical comment lines; `construct` names the first operative statement
// found (evidence for why the block reads as code).
export type CommentedOutRegion = {
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
  readonly construct: string;
  readonly snippetHash: string;
  readonly preview: string;
};

type CommentSegment = { readonly kind: "line" | "block"; readonly text: string };

type ScannedLine = {
  readonly hasCode: boolean;
  readonly segments: readonly CommentSegment[];
};

export type FindCommentedOutRegionsOptions = {
  readonly minLines?: number;
};

// Walks a file's source once, threading string/block-comment state across line
// boundaries (so a `//` inside a multi-line template literal stays code, not a
// comment), groups consecutive pure-comment lines, and emits a region for each run
// of >= minLines that parses cleanly as operative code.
export function findCommentedOutRegions(
  source: string,
  options: FindCommentedOutRegionsOptions = {},
): CommentedOutRegion[] {
  const minLines = options.minLines ?? DEFAULT_COMMENTED_OUT_CODE_MIN_LINES;
  const lines = splitLines(source);

  const regions: CommentedOutRegion[] = [];
  let scanState = initialLineScanState();
  let runStart = -1;
  let runTexts: string[] = [];

  const flush = (endIndex: number): void => {
    if (runStart >= 0) {
      const region = evaluateRun(runStart, endIndex, runTexts, minLines);
      if (region !== undefined) regions.push(region);
    }
    runStart = -1;
    runTexts = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const scanned = classifyLine(lines[index] ?? "", scanState);
    scanState = scanned.next;
    if (isPureComment(scanned.line)) {
      if (runStart < 0) runStart = index;
      runTexts.push(reconstructLine(scanned.line.segments));
    } else {
      flush(index - 1);
    }
  }
  flush(lines.length - 1);

  return regions;
}

function evaluateRun(
  startIndex: number,
  endIndex: number,
  texts: readonly string[],
  minLines: number,
): CommentedOutRegion | undefined {
  const lineCount = endIndex - startIndex + 1;
  if (lineCount < minLines) return undefined;
  const snippet = texts.join("\n");
  if (snippet.trim().length === 0) return undefined;
  const construct = codeShapedConstruct(snippet);
  if (construct === undefined) return undefined;
  return {
    startLine: startIndex + 1,
    endLine: endIndex + 1,
    lineCount,
    construct,
    snippetHash: hashFeature(snippet),
    preview: previewOf(texts),
  };
}

function isPureComment(line: ScannedLine): boolean {
  return !line.hasCode && line.segments.length > 0;
}

// Rebuild the candidate source line from a pure-comment line's segments. Block
// segments shed a leading ` * ` JSDoc-style decoration so a `*`-prefixed
// commented-out block still parses; line (`//`) segments keep their text verbatim.
function reconstructLine(segments: readonly CommentSegment[]): string {
  return segments
    .map((segment) => (segment.kind === "block" ? stripBlockStar(segment.text) : segment.text))
    .join("");
}

function stripBlockStar(text: string): string {
  return text.replace(/^\s*\*\s?/u, "");
}

function classifyLine(
  line: string,
  scanState: LineScanState,
): { readonly line: ScannedLine; readonly next: LineScanState } {
  let hasCode = false;
  const segments: CommentSegment[] = [];
  const next = scanLine(line, scanState, {
    onCode: (text) => {
      if (text !== " " && text !== "\t") hasCode = true;
    },
    onLineComment: (text) => {
      segments.push({ kind: "line", text });
    },
    onBlockComment: (text) => {
      segments.push({ kind: "block", text });
    },
  });
  return { line: { hasCode, segments }, next };
}

function previewOf(texts: readonly string[]): string {
  const firstContent = texts.map((text) => text.trim()).find((text) => text.length > 0) ?? "";
  if (firstContent.length <= PREVIEW_MAX_LENGTH) return firstContent;
  return `${firstContent.slice(0, PREVIEW_MAX_LENGTH - 1)}…`;
}

function splitLines(source: string): string[] {
  return source.replace(/\r\n/gu, "\n").split("\n");
}

export type RunCommentedOutCodeCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly readFile: FileReader;
  readonly minLines?: number;
  readonly excludePrefixes?: readonly string[];
};

export function runCommentedOutCodeCheck(options: RunCommentedOutCodeCheckOptions): DriftFinding[] {
  const minLines = options.minLines ?? DEFAULT_COMMENTED_OUT_CODE_MIN_LINES;
  const excludePrefixes = options.excludePrefixes ?? [];
  const findings: DriftFinding[] = [];
  for (const filePath of candidatePaths(options.detectorScope, excludePrefixes)) {
    const source = options.readFile(filePath);
    if (source === undefined) continue;
    for (const region of findCommentedOutRegions(source, { minLines })) {
      findings.push(toFinding(filePath, region));
    }
  }
  return findings;
}

function candidatePaths(
  detectorScope: DetectorScope,
  excludePrefixes: readonly string[],
): string[] {
  const candidates: string[] = [];
  for (const file of detectorScope.files) {
    if (detectorScope.scopeMode === "changed") {
      if (file.scope !== "changed" || file.status === "deleted") continue;
    } else if (file.scope !== "current") {
      continue;
    }
    if (!isCandidate(file.path, excludePrefixes)) continue;
    candidates.push(file.path);
  }
  return candidates.sort((left, right) => left.localeCompare(right, "en"));
}

function isCandidate(filePath: string, excludePrefixes: readonly string[]): boolean {
  const posix = toPosix(filePath);
  if (!isSourceLike(posix)) return false;
  if (posix.endsWith(".d.ts")) return false;
  return !pathHasAnyPrefix(posix, excludePrefixes);
}

function toFinding(filePath: string, region: CommentedOutRegion): DriftFinding {
  return {
    check: "commented-out-code",
    file: filePath,
    message: `lines ${region.startLine}-${region.endLine}: ${region.lineCount} consecutive comment lines parse as ${region.construct} code — appears to be commented-out code, not prose`,
    hint: COMMENTED_OUT_CODE_HINT,
    details: {
      startLine: region.startLine,
      endLine: region.endLine,
      lineCount: region.lineCount,
      construct: region.construct,
      snippetHash: region.snippetHash,
      preview: region.preview,
    },
  };
}
