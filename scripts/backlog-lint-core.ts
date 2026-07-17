import { formatBacklogLintResult } from "./backlog-lint-format.js";
import type { MetadataField, NoteMetadata } from "./backlog-lint-metadata.js";
import { extractMetadata } from "./backlog-lint-metadata.js";
import { collectPackFindings } from "./backlog-lint-packs.js";
import { terminalStatus } from "./backlog-lint-status.js";
import type {
  BacklogLintFile,
  BacklogLintFinding,
  BacklogLintOptions,
  BacklogLintResult,
} from "./backlog-lint-types.js";

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
const DEFAULT_BACKLOG_DIR = "docs/agent_notes/backlog";
const ISO_DATE_PART_WIDTH = 2;
const ISO_DATE_TOKEN_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/u;
const ISO_MONTH_TOKEN_PATTERN = /\b(\d{4})-(\d{2})[a-z]?\b/u;

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
  return dateCandidateFromPath(path);
}

function staleCutoff(now: Date, staleMonths: number): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - staleMonths, now.getUTCDate()),
  );
}

function formatIsoDate(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(ISO_DATE_PART_WIDTH, "0");
  const dd = String(date.getUTCDate()).padStart(ISO_DATE_PART_WIDTH, "0");
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
    (metadata.status !== undefined && terminalStatus(metadata.status.value))
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
  const fileFindings = files.flatMap((file) => collectFileFindings(file, context));
  const backlogDir = options.backlogDir ?? DEFAULT_BACKLOG_DIR;
  const packFindings = collectPackFindings({
    corpus: options.packCorpus ?? files,
    backlogDir,
    focusPaths: options.focusPaths,
  });
  const findings = [...fileFindings, ...packFindings];
  return {
    exitCode: 0,
    stdout: formatBacklogLintResult(files.length, findings),
    stderr: "",
    checkedCount: files.length,
    findings,
  };
}
