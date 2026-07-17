// Comment-segment tokenizer and suppression-pattern classifiers. The
// changed-scope diff orchestration lives in suppressions.ts.

import {
  type CommentKind,
  initialLineScanState,
  type LineScanState,
  scanLine,
} from "./line-scanner.js";
import type { DriftFinding } from "./types.js";

export const ESLINT_BROAD_SUPPRESSION_HINT =
  "prefer `eslint-disable-next-line` over a broad disable; include `-- <reason>`.";
export const ESLINT_INLINE_SUPPRESSION_HINT = "narrow the rule list and include `-- <reason>`.";
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

export type ParsedSuppression = {
  readonly file: string;
  readonly line: number;
  readonly kind: SuppressionKind;
  readonly target: string;
  readonly reasonPresent: boolean;
  readonly text: string;
  readonly hint: string;
};

export type CommentSegment = {
  readonly kind: CommentKind;
  readonly text: string;
};

export type CommentScanState = LineScanState;

export function initialCommentScanState(): CommentScanState {
  return initialLineScanState();
}

export function scanCommentSegments(
  line: string,
  state: CommentScanState,
): {
  readonly segments: readonly CommentSegment[];
  readonly state: CommentScanState;
} {
  const segments: CommentSegment[] = [];
  const nextState = scanLine(line, state, {
    onLineComment: (text) => {
      segments.push({ kind: "line", text });
    },
    onBlockComment: (text) => {
      segments.push({ kind: "block", text });
    },
  });
  return { segments, state: nextState };
}

export function detectSuppressions(
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

function isEslintSuppressionKind(
  value: string | undefined,
): value is "eslint-disable" | "eslint-disable-next-line" | "eslint-disable-line" {
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

function isTypeScriptSuppressionKind(
  value: string | undefined,
): value is "@ts-expect-error" | "@ts-ignore" | "@ts-nocheck" {
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

export function toFinding(suppression: ParsedSuppression): DriftFinding {
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

export function compareSuppressions(left: ParsedSuppression, right: ParsedSuppression): number {
  return (
    left.file.localeCompare(right.file, "en") ||
    left.line - right.line ||
    left.kind.localeCompare(right.kind, "en") ||
    left.target.localeCompare(right.target, "en")
  );
}
