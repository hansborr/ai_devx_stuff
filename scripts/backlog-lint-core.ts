import { formatBacklogLintResult } from "./backlog-lint-format.js";
import type { ParsedBacklogNote } from "./backlog-lint-grammar.js";
import { invalidDateToken, parseBacklogNote } from "./backlog-lint-grammar.js";
import { collectPackFindings } from "./backlog-lint-packs.js";
import { terminalStatus } from "./backlog-lint-status.js";
import type {
  BacklogLintFile,
  BacklogLintFinding,
  BacklogLintOptions,
  BacklogLintResult,
} from "./backlog-lint-types.js";

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
  note: ParsedBacklogNote,
  requireFrontMatter: boolean,
): BacklogLintFinding[] {
  const metadata = note.metadata;
  if (metadata.status === undefined) {
    if (!requireFrontMatter) return [];
    return [
      {
        kind: "missing-status",
        path: note.path,
        message: "missing Status front-matter in the leading note header",
      },
    ];
  }
  if (metadata.status.value.length === 0) {
    return [
      {
        kind: "empty-status",
        path: note.path,
        line: metadata.status.line,
        message: "Status front-matter is present but empty",
      },
    ];
  }
  return [];
}

function collectDateFindings(
  note: ParsedBacklogNote,
  requireFrontMatter: boolean,
): BacklogLintFinding[] {
  const metadata = note.metadata;
  if (metadata.date !== undefined) {
    const invalidToken = invalidDateToken(metadata.date.value);
    if (invalidToken !== undefined) {
      return [
        {
          kind: "invalid-date",
          path: note.path,
          line: metadata.date.line,
          message: `Date front-matter contains invalid ISO date ${invalidToken}`,
        },
      ];
    }
  }
  if (note.date === undefined) {
    if (!requireFrontMatter) return [];
    return [
      {
        kind: "missing-date",
        path: note.path,
        message: "missing Date/Created/Updated front-matter or dated backlog path",
      },
    ];
  }
  return [];
}

function collectStaleFindings(
  note: ParsedBacklogNote,
  context: StaleCheckContext,
): BacklogLintFinding[] {
  const date = note.date;
  if (date === undefined || (note.statusValue !== undefined && terminalStatus(note.statusValue))) {
    return [];
  }
  if (date.value >= staleCutoff(context.now, context.staleMonths)) return [];
  return [
    {
      kind: "stale-note",
      path: note.path,
      line: date.line,
      message: `latest front-matter date ${formatIsoDate(date.value)} is older than ${String(context.staleMonths)} month(s)`,
    },
  ];
}

function collectFileFindings(
  file: BacklogLintFile,
  context: FileCheckContext,
): BacklogLintFinding[] {
  const note = parseBacklogNote(file);
  return [
    ...collectStatusFindings(note, context.requireFrontMatter),
    ...collectDateFindings(note, context.requireFrontMatter),
    ...(context.checkStaleness ? collectStaleFindings(note, context) : []),
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
