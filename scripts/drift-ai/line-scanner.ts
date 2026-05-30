export type StringDelim = '"' | "'" | "`";

export type LineScanState = {
  readonly inBlockComment: boolean;
  readonly inString: StringDelim | false;
};

export type CommentKind = "line" | "block";

export type LineScanVisitor = {
  readonly onCode?: (text: string) => void;
  readonly onCommentStart?: (kind: CommentKind) => void;
  readonly onLineComment?: (text: string) => void;
  readonly onBlockComment?: (text: string) => void;
};

export function initialLineScanState(): LineScanState {
  return { inBlockComment: false, inString: false };
}

export function scanLine(
  line: string,
  state: LineScanState,
  visitor: LineScanVisitor = {},
): LineScanState {
  let cursor: LineScanCursor = { ...state, index: 0 };

  while (cursor.index < line.length) {
    cursor = scanNext(line, cursor, visitor);
  }

  return { inBlockComment: cursor.inBlockComment, inString: cursor.inString };
}

type LineScanCursor = LineScanState & {
  readonly index: number;
};

function scanNext(line: string, cursor: LineScanCursor, visitor: LineScanVisitor): LineScanCursor {
  if (cursor.inBlockComment) return scanBlockComment(line, cursor, visitor);
  if (cursor.inString) return scanString(line, cursor, visitor);
  return scanCode(line, cursor, visitor);
}

function scanBlockComment(
  line: string,
  cursor: LineScanCursor,
  visitor: LineScanVisitor,
): LineScanCursor {
  const end = line.indexOf("*/", cursor.index);
  if (end < 0) {
    visitor.onBlockComment?.(line.slice(cursor.index));
    return { ...cursor, index: line.length };
  }
  visitor.onBlockComment?.(line.slice(cursor.index, end));
  return { inBlockComment: false, inString: cursor.inString, index: end + 2 };
}

function scanString(
  line: string,
  cursor: LineScanCursor,
  visitor: LineScanVisitor,
): LineScanCursor {
  const ch = line.charAt(cursor.index);
  visitor.onCode?.(ch);
  if (ch === "\\") return { ...cursor, index: cursor.index + 2 };
  if (ch === cursor.inString) return { ...cursor, inString: false, index: cursor.index + 1 };
  return { ...cursor, index: cursor.index + 1 };
}

function scanCode(line: string, cursor: LineScanCursor, visitor: LineScanVisitor): LineScanCursor {
  const ch = line.charAt(cursor.index);
  const next = line[cursor.index + 1];
  if (ch === "/" && next === "/") return scanLineComment(line, cursor, visitor);
  if (ch === "/" && next === "*") return startBlockComment(cursor, visitor);

  visitor.onCode?.(ch);
  return {
    ...cursor,
    inString: stringDelimiter(ch),
    index: cursor.index + 1,
  };
}

function scanLineComment(
  line: string,
  cursor: LineScanCursor,
  visitor: LineScanVisitor,
): LineScanCursor {
  visitor.onCommentStart?.("line");
  visitor.onLineComment?.(line.slice(cursor.index + 2));
  return { ...cursor, index: line.length };
}

function startBlockComment(cursor: LineScanCursor, visitor: LineScanVisitor): LineScanCursor {
  visitor.onCommentStart?.("block");
  return { ...cursor, inBlockComment: true, index: cursor.index + 2 };
}

function stringDelimiter(ch: string): StringDelim | false {
  if (ch === '"' || ch === "'" || ch === "`") return ch;
  return false;
}
