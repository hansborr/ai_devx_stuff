// Shared `git log` emit-format and argv builder for the `hotspots` subcommand.
// Every history lens (churn, co-change, thrash, fragmentation, and the
// suppression-churn second pass) walks git with the SAME base flags and format,
// so both live here in one leaf module that imports nothing else from drift-ai —
// a lens hand-rolling its own arg list is exactly how `--no-renames` silently
// drifted off one call site. The parser that reads the walk's OUTPUT lives in
// `hotspots-history.ts` (the OUT_* control bytes git expands these escapes into).

// --- git-log format ---------------------------------------------------------
//
// These are git format ESCAPES (literal `%x..` text passed to `--format`); git
// expands them to control bytes in its OUTPUT. They must NOT be raw control
// bytes here — a raw NUL inside an argv string would truncate the argument in
// execFile. `hotspots-history.ts` parses the expanded OUTPUT bytes (OUT_* there).
const FMT_RECORD = "%x00"; // NUL — commit-boundary marker (cannot occur in a path)
const FMT_FIELD = "%x1f"; // unit separator — between metadata fields
const FMT_COAUTHOR = "%x1d"; // group separator — joins multiple Co-authored-by values

// `git log` emits, per commit: the metadata line (NUL-prefixed), a blank line,
// then `added \t deleted \t path` numstat rows.
export const GIT_LOG_FORMAT = `${FMT_RECORD}%H${FMT_FIELD}%an${FMT_FIELD}%ae${FMT_FIELD}%ad${FMT_FIELD}%cd${FMT_FIELD}%s${FMT_FIELD}%(trailers:key=Co-authored-by,valueonly,separator=${FMT_COAUTHOR})`;

// Base args every hotspot history lens shares. --no-merges keeps merge commits
// from double-counting every churn signal. --no-renames is LOAD-BEARING FOR
// PARSER CORRECTNESS: with rename detection on, git emits arrow-form paths
// (`a/{old => new}/f.ts`, `{old => new}`) in the path column that corrupt the
// tab-split parser. A future "follow renames across history" feature needs a real
// arrow-form parser, NOT a flag flip — do not remove --no-renames to get it.
export const GIT_LOG_BASE_ARGS: readonly string[] = ["log", "--no-merges", "--no-renames"];

export type GitLogWalkArgsOptions = {
  readonly windowDays?: number;
  readonly since?: string | null;
  readonly maxCount?: number;
  // true → --numstat (added/deleted/path rows); false → --name-only (bare paths,
  // the blobless-clone fallback and the suppression-churn pass, which needs no
  // line counts).
  readonly numstat: boolean;
  // Optional pickaxe: appends `-G <pattern>` so the walk keeps only commits whose
  // diff added/removed a matching line (the suppression-churn lens).
  readonly pickaxe?: string;
};

// Compose a full `git log` argv from GIT_LOG_BASE_ARGS so every history walk
// shares the same base + iso-strict dates + NUL-boundary format. Windowed walks
// pass `windowDays`; bounded full-history walks pass `since`/`maxCount`.
export function buildGitLogWalkArgs(options: GitLogWalkArgsOptions): string[] {
  const args = [...GIT_LOG_BASE_ARGS];
  if (options.windowDays !== undefined) args.push(`--since=${options.windowDays}.days.ago`);
  if (options.since !== undefined && options.since !== null) args.push(`--since=${options.since}`);
  if (options.maxCount !== undefined) args.push(`--max-count=${String(options.maxCount)}`);
  args.push(
    "--date=iso-strict",
    options.numstat ? "--numstat" : "--name-only",
    `--format=${GIT_LOG_FORMAT}`,
  );
  if (options.pickaxe !== undefined) args.push("-G", options.pickaxe);
  return args;
}
