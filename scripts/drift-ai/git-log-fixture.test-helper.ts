// Shared builder for the NUL/US/GS control-byte `git log` fixture format that
// the drift-ai subcommand tests feed to their GitRunner fakes. Every drift-ai
// history lens parses the SAME `GIT_LOG_FORMAT` output (see hotspots-history.ts),
// so the tests previously re-derived this layout by hand in ~9 files — with
// inconsistent escaping (some `String.fromCharCode`, some backslash-u). That
// duplication is corruptible: a raw control byte typed into a `.ts` makes the
// file "binary" and tools silently skip it. This helper is the single source.
//
// The separators are produced via `String.fromCharCode(...)` rather than
// backslash-u escapes on purpose: tools that JSON-encode file content can decode
// a backslash-u escape back into a real byte, so char-code construction is the
// safer convention for keeping the source plain text.

const RECORD_SEPARATOR_CODE = 0; // NUL — commit-boundary marker (cannot occur in a path)
const FIELD_SEPARATOR_CODE = 0x1f; // unit separator — between metadata fields
const COAUTHOR_SEPARATOR_CODE = 0x1d; // group separator — joins Co-authored-by values

// The three control bytes git expands its `%x..` format escapes into. Named by
// role; defined by exact char code so no literal control byte is ever typed here.
export const GIT_LOG_CONTROL = {
  record: String.fromCharCode(RECORD_SEPARATOR_CODE),
  field: String.fromCharCode(FIELD_SEPARATOR_CODE),
  coAuthor: String.fromCharCode(COAUTHOR_SEPARATOR_CODE),
} as const;

// One commit's worth of `git log` output: the NUL-prefixed metadata line, then
// its numstat (`added \t deleted \t path`) or name-only (`path`) rows. Callers
// may pass rows via `numstat` here or as the second `commitBlock` argument.
export type GitLogEntry = {
  readonly hash: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authorDate: string;
  // Defaults to authorDate when omitted — the common case in these fixtures,
  // where author and committer timestamps are the same.
  readonly committerDate?: string;
  readonly subject: string;
  readonly coAuthors?: readonly string[];
  readonly numstat?: readonly string[];
};

// The NUL-prefixed metadata line git emits per commit: the seven fields joined by
// the unit separator, with co-authors joined by the group separator in the final
// field (empty when there are none) — matching GIT_LOG_FORMAT in hotspots-history.ts.
export function metaLine(entry: GitLogEntry): string {
  const coAuthorField = (entry.coAuthors ?? []).join(GIT_LOG_CONTROL.coAuthor);
  return (
    GIT_LOG_CONTROL.record +
    [
      entry.hash,
      entry.authorName,
      entry.authorEmail,
      entry.authorDate,
      entry.committerDate ?? entry.authorDate,
      entry.subject,
      coAuthorField,
    ].join(GIT_LOG_CONTROL.field)
  );
}

// One commit block as git emits it: the NUL-prefixed metadata line, a blank line,
// then the numstat/name-only rows, joined with "\n" (no blank between the last row
// of a commit and the next commit's metadata line — matching real output). Rows
// come from the explicit `rows` argument when given, else from `entry.numstat`.
export function commitBlock(entry: GitLogEntry, rows?: readonly string[]): string {
  const numstatRows = rows ?? entry.numstat ?? [];
  return [metaLine(entry), "", ...numstatRows].join("\n");
}

// Join already-built commit blocks with a single "\n" — the boundary git emits
// between commits (the NUL that prefixes the next block is its own marker, so no
// blank line is inserted here). Use this when call sites build blocks explicitly
// (e.g. to pass per-commit `rows` to `commitBlock`).
export function joinGitLogBlocks(blocks: readonly string[]): string {
  return blocks.join("\n");
}

// A full `git log` walk built directly from entries: each entry's `numstat` rows
// become its block, joined as git emits them. Equivalent to mapping `commitBlock`
// over the entries and `joinGitLogBlocks`-ing the result.
export function buildGitLogFixture(entries: readonly GitLogEntry[]): string {
  return joinGitLogBlocks(entries.map((entry) => commitBlock(entry)));
}
