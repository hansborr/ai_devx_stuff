// Stale-marker scanner for the coldspots `stale-markers` lens (spec: the
// "Companion lens — stale-marker aging" in docs/agent_notes/backlog/
// drift-ai-next-checks-brainstorm.md). Finds the maintenance-marker keywords listed
// in STALE_MARKER_KINDS below, restricted to COMMENT REGIONS so a string literal in
// data (a keyword stored as a value, not a note) does not false-positive.
//
// Comment-region restriction reuses `line-scanner.ts` (the same single-pass scanner
// the comments check uses): it tracks string and block-comment state across line
// boundaries and hands back only the text INSIDE line/block comments via its
// `onLineComment` / `onBlockComment` visitors. We match marker keywords only against
// that comment text, never the code/string spans. `@deprecated` is a JSDoc tag, so
// it also lives in comments — the same restriction covers it for free.
//
// Evidence, not verdicts: a marker is surfaced as an aged note, never as a defect.

import { initialLineScanState, scanLine } from "./line-scanner.js";

export const STALE_MARKER_KINDS = ["TODO", "FIXME", "HACK", "XXX", "@deprecated"] as const;

export type StaleMarkerKind = (typeof STALE_MARKER_KINDS)[number];

export type StaleMarker = {
  readonly kind: StaleMarkerKind;
  readonly lineNumber: number; // 1-based, matching `git blame -L`
  readonly text: string; // the trimmed comment text the marker appeared in
};

// Word-boundary keyword patterns. The keyword-family entries use \b so a longer
// word (e.g. `TODOLIST`, `FIXMENOW`) does not match; `@deprecated` is anchored on
// the `@` (no leading \b, since `@` is not a word char) and a trailing boundary so
// `@deprecatedFoo` does not match. Case-insensitive; the kind is normalized to the
// canonical form below.
const MARKER_PATTERNS: ReadonlyArray<{ readonly kind: StaleMarkerKind; readonly pattern: RegExp }> =
  [
    { kind: "TODO", pattern: /\bTODO\b/iu },
    { kind: "FIXME", pattern: /\bFIXME\b/iu },
    { kind: "HACK", pattern: /\bHACK\b/iu },
    { kind: "XXX", pattern: /\bXXX\b/iu },
    { kind: "@deprecated", pattern: /@deprecated\b/iu },
  ];

// Scan source for stale markers in comment regions. Returns markers in source
// order (by line, then by the keyword order above for multiple on one line).
export function scanStaleMarkers(source: string): StaleMarker[] {
  const markers: StaleMarker[] = [];
  const normalized = source.replace(/\r\n/gu, "\n");
  let state = initialLineScanState();
  let lineNumber = 0;
  for (const line of normalized.split("\n")) {
    lineNumber += 1;
    // Accumulate only the comment text on this line; the visitor fires for line
    // comments and (possibly multiple) block-comment spans, never code/strings.
    let commentText = "";
    state = scanLine(line, state, {
      onLineComment: (text) => {
        commentText += ` ${text}`;
      },
      onBlockComment: (text) => {
        commentText += ` ${text}`;
      },
    });
    if (commentText.length === 0) continue;
    collectMarkers(commentText.trim(), lineNumber, markers);
  }
  return markers;
}

function collectMarkers(commentText: string, lineNumber: number, out: StaleMarker[]): void {
  for (const { kind, pattern } of MARKER_PATTERNS) {
    if (pattern.test(commentText)) {
      out.push({ kind, lineNumber, text: commentText });
    }
  }
}
