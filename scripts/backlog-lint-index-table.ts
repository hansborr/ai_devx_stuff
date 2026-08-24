/**
 * Markdown parsing for a pack's task index.
 *
 * A pack index links its leaves two ways: a task table whose Status column
 * records each leaf's state, and inline prose links. The drift check needs the
 * table (status per linked leaf); the dangling-link and unlisted-leaf checks
 * need every same-directory link. Both are pulled out here so the pack checker
 * stays about policy, not markdown.
 */

const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
const CATALOG_REGION_BEGIN = "<!-- BEGIN GENERATED LEAF CATALOG ROUTING -->";
const CATALOG_REGION_END = "<!-- END GENERATED LEAF CATALOG ROUTING -->";
const CATALOG_DECLARATION_PATTERN = /^<!-- backlog-lint-catalog: ([^/<>\s]+\.md) -->$/gmu;
const TABLE_ROW_PREFIX = "|";
const SEPARATOR_CELL_PATTERN = /^:?-+:?$/u;
// A markdown table's data rows begin two lines after the header (header row +
// its `|---|` separator row).
const ROWS_START_OFFSET = 2;

interface IndexTaskRow {
  /** Raw text of the Status cell for this row. */
  readonly statusText: string;
  /** Same-directory leaf this row links to (basename), if any. */
  readonly leafBase?: string;
  /** 1-based line number of the row in the index text. */
  readonly line: number;
}

export interface IndexTaskTable {
  readonly rows: readonly IndexTaskRow[];
}

/** Basename of a link target that points at a sibling file in the same dir. */
function sameDirLinkBase(target: string): string | undefined {
  const withoutAnchor = target.split("#")[0] ?? "";
  const cleaned = withoutAnchor.replace(/^\.\//u, "");
  if (cleaned.length === 0 || cleaned.includes("/")) return undefined;
  if (!cleaned.toLowerCase().endsWith(".md")) return undefined;
  return cleaned;
}

/** Every same-directory leaf basename linked anywhere in the index text. */
export function indexLinkedBases(text: string): Set<string> {
  const bases = new Set<string>();
  for (const match of text.matchAll(LINK_PATTERN)) {
    const base = sameDirLinkBase(match[1] ?? "");
    if (base !== undefined) bases.add(base);
  }
  return bases;
}

/** Direct sibling catalog basenames explicitly declared by the canonical index. */
export function declaredIndexCatalogBases(text: string): Set<string> {
  const begin = text.indexOf(CATALOG_REGION_BEGIN);
  const end = text.indexOf(CATALOG_REGION_END);
  if (begin < 0 || end < 0 || begin >= end) return new Set();
  const region = text.slice(begin + CATALOG_REGION_BEGIN.length, end);
  return new Set(
    [...region.matchAll(CATALOG_DECLARATION_PATTERN)].flatMap((match) => {
      const base = match[1];
      return base === undefined ? [] : [base];
    }),
  );
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith(TABLE_ROW_PREFIX) ? trimmed.slice(1) : trimmed;
  const body = inner.endsWith(TABLE_ROW_PREFIX) ? inner.slice(0, -1) : inner;
  return body.split(TABLE_ROW_PREFIX).map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith(TABLE_ROW_PREFIX);
}

function isSeparatorRow(line: string): boolean {
  return splitTableCells(line).every((cell) => SEPARATOR_CELL_PATTERN.test(cell));
}

function statusColumnIndex(cells: readonly string[]): number {
  return cells.findIndex((cell) => cell.toLowerCase().includes("status"));
}

function firstLeafBaseInRow(line: string): string | undefined {
  for (const match of line.matchAll(LINK_PATTERN)) {
    const base = sameDirLinkBase(match[1] ?? "");
    if (base !== undefined) return base;
  }
  return undefined;
}

function rowsFromTable(
  lines: readonly string[],
  headerIndex: number,
  statusColumn: number,
): IndexTaskRow[] {
  const rows: IndexTaskRow[] = [];
  for (let index = headerIndex + ROWS_START_OFFSET; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!isTableRow(line)) break;
    if (isSeparatorRow(line)) continue;
    const cells = splitTableCells(line);
    rows.push({
      statusText: cells[statusColumn] ?? "",
      leafBase: firstLeafBaseInRow(line),
      line: index + 1,
    });
  }
  return rows;
}

/** Parse the first task table that has a Status column, if the index has one. */
export function parseIndexTaskTable(text: string): IndexTaskTable | undefined {
  const lines = text.split(/\r?\n/u);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index] ?? "";
    const separator = lines[index + 1] ?? "";
    if (!isTableRow(header) || !isTableRow(separator) || !isSeparatorRow(separator)) continue;
    const statusColumn = statusColumnIndex(splitTableCells(header));
    if (statusColumn < 0) continue;
    return { rows: rowsFromTable(lines, index, statusColumn) };
  }
  return undefined;
}
