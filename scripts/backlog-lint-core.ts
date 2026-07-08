import { formatBacklogLintResult } from "./backlog-lint-format.js";
import type {
  BacklogLintFile,
  BacklogLintFinding,
  BacklogLintOptions,
  BacklogLintResult,
} from "./backlog-lint-types.js";

interface MetadataField {
  readonly name: string;
  readonly value: string;
  readonly line: number;
}

interface NoteMetadata {
  readonly status?: MetadataField;
  readonly date?: MetadataField;
  readonly allFields: readonly MetadataField[];
}

interface DateCandidate {
  readonly value: Date;
  readonly line?: number;
}

interface StaleCheckContext {
  readonly now: Date;
  readonly staleMonths: number;
}

interface FileCheckContext extends StaleCheckContext {
  readonly checkStaleness: boolean;
  readonly requireFrontMatter: boolean;
}

const DEFAULT_STALE_MONTHS = 6;
const FRONT_MATTER_SCAN_LINES = 30;
const BOLD_MARKER = "**";
const BOLD_MARKER_LENGTH = BOLD_MARKER.length;
const DATE_FIELD_NAMES = new Set(["date", "created", "updated", "last triaged"]);
const STATUS_FIELD_NAME = "status";
const ISO_DATE_TOKEN_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/u;
const ISO_MONTH_TOKEN_PATTERN = /\b(\d{4})-(\d{2})[a-z]?\b/u;
const FIELD_NAME_PATTERN = /^[a-z][a-z -]*$/u;
const TERMINAL_STATUS_TOKENS = [
  "closed",
  "decided",
  "done",
  "drained",
  "implemented",
  "rejected",
  "shipped",
  "superseded",
] as const;

function normalizeMetadataLine(line: string): string {
  let normalized = line.trim();
  if (normalized.startsWith(">")) normalized = normalized.slice(1).trim();
  return normalized;
}

function stripWrappingBold(value: string): string {
  let stripped = value.trim();
  if (stripped.startsWith(BOLD_MARKER)) {
    stripped = stripped.slice(BOLD_MARKER_LENGTH).trimStart();
  }
  if (stripped.endsWith(BOLD_MARKER)) {
    stripped = stripped.slice(0, -BOLD_MARKER_LENGTH).trimEnd();
  }
  return stripped;
}

function splitMetadataField(
  line: string,
): { readonly name: string; readonly value: string } | undefined {
  let normalized = normalizeMetadataLine(line);
  if (normalized.startsWith(BOLD_MARKER)) {
    normalized = normalized.slice(BOLD_MARKER_LENGTH).trimStart();
  }
  const colonIndex = normalized.indexOf(":");
  if (colonIndex < 0) return undefined;
  const name = normalized.slice(0, colonIndex).trim();
  if (!FIELD_NAME_PATTERN.test(name.toLowerCase())) return undefined;
  let value = normalized.slice(colonIndex + 1).trim();
  if (value.startsWith(BOLD_MARKER)) {
    value = value.slice(BOLD_MARKER_LENGTH).trimStart();
  }
  return { name, value: stripWrappingBold(value) };
}

function isMetadataFieldLine(line: string): boolean {
  return splitMetadataField(line) !== undefined;
}

function continuationValue(lines: readonly string[], startIndex: number): string {
  const parts: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = normalizeMetadataLine(lines[index] ?? "");
    if (trimmed.length === 0 || trimmed.startsWith("#") || isMetadataFieldLine(trimmed)) break;
    parts.push(stripWrappingBold(trimmed));
  }
  return parts.join(" ").trim();
}

function updateKnownFields(
  field: MetadataField,
  known: { status?: MetadataField; date?: MetadataField },
): void {
  if (field.name === STATUS_FIELD_NAME && known.status === undefined) known.status = field;
  if (DATE_FIELD_NAMES.has(field.name) && known.date === undefined) known.date = field;
}

function extractMetadata(text: string): NoteMetadata {
  const lines = text.split(/\r?\n/u).slice(0, FRONT_MATTER_SCAN_LINES);
  const allFields: MetadataField[] = [];
  const known: { status?: MetadataField; date?: MetadataField } = {};
  for (let index = 0; index < lines.length; index += 1) {
    const split = splitMetadataField(lines[index] ?? "");
    if (split === undefined) continue;
    const directValue = split.value.trim();
    const field = {
      name: split.name.toLowerCase(),
      value: directValue.length > 0 ? directValue : continuationValue(lines, index),
      line: index + 1,
    };
    allFields.push(field);
    updateKnownFields(field, known);
  }
  return { status: known.status, date: known.date, allFields };
}

function validDateFromParts(year: number, month: number, day: number): Date | undefined {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year) return undefined;
  if (parsed.getUTCMonth() !== month - 1) return undefined;
  if (parsed.getUTCDate() !== day) return undefined;
  return parsed;
}

function dateFromMatch(match: RegExpMatchArray, defaultDay?: number): Date | undefined {
  const yearText = match[1];
  const monthText = match[2];
  const dayText = defaultDay === undefined ? match[3] : String(defaultDay);
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return undefined;
  }
  return validDateFromParts(Number(yearText), Number(monthText), Number(dayText));
}

function parseIsoDateToken(text: string): Date | undefined {
  const match = text.match(ISO_DATE_TOKEN_PATTERN);
  return match === null ? undefined : dateFromMatch(match);
}

function parseIsoMonthToken(text: string): Date | undefined {
  const match = text.match(ISO_MONTH_TOKEN_PATTERN);
  return match === null ? undefined : dateFromMatch(match, 1);
}

function invalidDateToken(text: string): string | undefined {
  const match = text.match(ISO_DATE_TOKEN_PATTERN);
  if (match === null || parseIsoDateToken(text) !== undefined) return undefined;
  return match[0];
}

function dateCandidateFromField(field: MetadataField): DateCandidate | undefined {
  const parsed = parseIsoDateToken(field.value);
  return parsed === undefined ? undefined : { value: parsed, line: field.line };
}

function dateCandidateFromPath(path: string): DateCandidate | undefined {
  const exact = parseIsoDateToken(path);
  if (exact !== undefined) return { value: exact };
  const month = parseIsoMonthToken(path);
  return month === undefined ? undefined : { value: month };
}

function firstDateCandidate(path: string, metadata: NoteMetadata): DateCandidate | undefined {
  if (metadata.date !== undefined) return dateCandidateFromField(metadata.date);
  if (metadata.status !== undefined) {
    const statusDate = dateCandidateFromField(metadata.status);
    if (statusDate !== undefined) return statusDate;
  }
  for (const field of metadata.allFields) {
    const fieldDate = dateCandidateFromField(field);
    if (fieldDate !== undefined) return fieldDate;
  }
  return dateCandidateFromPath(path);
}

function terminalStatus(status: string): boolean {
  const lower = status.toLowerCase();
  return TERMINAL_STATUS_TOKENS.some((token) => lower.includes(token));
}

function staleCutoff(now: Date, staleMonths: number): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - staleMonths, now.getUTCDate()),
  );
}

function formatIsoDate(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(BOLD_MARKER_LENGTH, "0");
  const dd = String(date.getUTCDate()).padStart(BOLD_MARKER_LENGTH, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function collectStatusFindings(
  file: BacklogLintFile,
  metadata: NoteMetadata,
  requireFrontMatter: boolean,
): BacklogLintFinding[] {
  if (metadata.status === undefined) {
    if (!requireFrontMatter) return [];
    return [
      {
        kind: "missing-status",
        path: file.path,
        message: "missing Status front-matter in the leading note header",
      },
    ];
  }
  if (metadata.status.value.length === 0) {
    return [
      {
        kind: "empty-status",
        path: file.path,
        line: metadata.status.line,
        message: "Status front-matter is present but empty",
      },
    ];
  }
  return [];
}

function collectDateFindings(
  file: BacklogLintFile,
  metadata: NoteMetadata,
  date: DateCandidate | undefined,
  requireFrontMatter: boolean,
): BacklogLintFinding[] {
  if (metadata.date !== undefined) {
    const invalidToken = invalidDateToken(metadata.date.value);
    if (invalidToken !== undefined) {
      return [
        {
          kind: "invalid-date",
          path: file.path,
          line: metadata.date.line,
          message: `Date front-matter contains invalid ISO date ${invalidToken}`,
        },
      ];
    }
  }
  if (date === undefined) {
    if (!requireFrontMatter) return [];
    return [
      {
        kind: "missing-date",
        path: file.path,
        message: "missing Date/Created/Updated front-matter or dated backlog path",
      },
    ];
  }
  return [];
}

function collectStaleFindings(
  file: BacklogLintFile,
  metadata: NoteMetadata,
  date: DateCandidate | undefined,
  context: StaleCheckContext,
): BacklogLintFinding[] {
  if (
    date === undefined ||
    metadata.status === undefined ||
    terminalStatus(metadata.status.value)
  ) {
    return [];
  }
  if (date.value >= staleCutoff(context.now, context.staleMonths)) return [];
  return [
    {
      kind: "stale-note",
      path: file.path,
      line: date.line,
      message: `latest front-matter date ${formatIsoDate(date.value)} is older than ${String(context.staleMonths)} month(s)`,
    },
  ];
}

function collectFileFindings(
  file: BacklogLintFile,
  context: FileCheckContext,
): BacklogLintFinding[] {
  const metadata = extractMetadata(file.text);
  const date = firstDateCandidate(file.path, metadata);
  return [
    ...collectStatusFindings(file, metadata, context.requireFrontMatter),
    ...collectDateFindings(file, metadata, date, context.requireFrontMatter),
    ...(context.checkStaleness ? collectStaleFindings(file, metadata, date, context) : []),
  ];
}

export function checkBacklogFiles(options: BacklogLintOptions): BacklogLintResult {
  const files = [...options.files].sort((left, right) => left.path.localeCompare(right.path));
  const now = options.now ?? new Date();
  const staleMonths = options.staleMonths ?? DEFAULT_STALE_MONTHS;
  const checkStaleness = options.checkStaleness ?? true;
  const requireFrontMatter = options.requireFrontMatter ?? false;
  const context = { now, staleMonths, checkStaleness, requireFrontMatter };
  const findings = files.flatMap((file) => collectFileFindings(file, context));
  return {
    exitCode: 0,
    stdout: formatBacklogLintResult(files.length, findings),
    stderr: "",
    checkedCount: files.length,
    findings,
  };
}
