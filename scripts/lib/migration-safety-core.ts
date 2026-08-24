// Analytical core of the Prisma migration safety scanner (backlog leaf 119).
//
// `scripts/migration-safety-scan.sh` is a thin exec-forwarder onto
// `migration-safety-cli.ts`. Every analytical stage that used to live inside
// that script — an awk program embedded as a quoted string, a tab-separated
// temp-file bridge between stages, and three separate walks that each re-did
// the acknowledgement lookup — lives here instead as pure, typed functions:
//
//   scanSqlText      the SQL lexer plus the four detection rules
//   parseAllowlist   `.safety-acknowledged` parsing (last duplicate wins)
//   classifyHits     acknowledged vs actionable, resolved once
//   findStaleEntries allowlist entries naming no on-disk migration
//
// The port is deliberately bug-for-bug (leaf 119 § Scope / caveats). Notably
// the lexer does NOT understand dollar-quoted (`$$`) bodies, so a destructive
// statement inside one is still reported; the rules are line-based; and
// `ADD COLUMN ... NOT NULL` fires only when DEFAULT is absent from the same
// line. Do not "fix" any of that here without a leaf that says so — the tool is
// warn-only and doctor renders its grammar verbatim.

import { basename as pathBasename, dirname as pathDirname } from "node:path/posix";

import { compareByCodepoint } from "./codepoint-compare.js";

/** The control id every finding this scanner emits is filed under. */
export const MIGRATION_SAFETY_CONTROL = "sensor/db-migration-safety";

/**
 * The four destructive-operation rules, spelled exactly as they appear in the
 * human report and in each finding's `messageId`. Closed union: adding a rule
 * means adding a guidance sentence too, which the compiler now enforces.
 */
export type MigrationRule =
  | "DROP TABLE"
  | "DROP COLUMN"
  | "ALTER COLUMN ... TYPE"
  | "ADD COLUMN ... NOT NULL without DEFAULT";

/** One rule match inside one SQL file. */
export interface RuleHit {
  /** Display path (repo-relative when the file lives under the repo root). */
  readonly path: string;
  readonly line: number;
  readonly rule: MigrationRule;
  /** The offending source line, whitespace-trimmed, unmasked. */
  readonly snippet: string;
}

/** A parsed `.safety-acknowledged` line. */
export interface AllowlistEntry {
  readonly name: string;
  /** Text after the first whitespace run; `""` when the entry has no reason. */
  readonly reason: string;
  /** 1-based line number inside the allowlist file. */
  readonly line: number;
}

/** A hit with its acknowledgement resolved once, for every downstream reader. */
export interface ClassifiedHit extends RuleHit {
  /** The allowlist reason, or `undefined` when the migration is not listed. */
  readonly acknowledgedReason: string | undefined;
  /**
   * The dedup key behind the human summary's "in N migration(s)" denominator,
   * or `undefined` when that count treats this hit as acknowledged. See
   * `summaryKeyFor` for why this is not simply `pathDirname` of an
   * unacknowledged hit.
   */
  readonly summaryKey: string | undefined;
}

/** A path that could not be scanned at all, surfaced before analysis begins. */
export interface CollectionWarning {
  readonly messageId: "missing-migrations-directory" | "missing-target";
  readonly path: string;
  readonly message: string;
  readonly howToFix: string;
}

/** Everything both renderers need, derived once. */
export interface ScanReport {
  readonly scannedFileCount: number;
  readonly hits: readonly ClassifiedHit[];
  readonly staleEntries: readonly AllowlistEntry[];
  /** Allowlist path exactly as configured (`""` when there is none). */
  readonly allowlistPath: string;
  /** Allowlist path shortened for display (`""` when there is none). */
  readonly allowlistDisplayPath: string;
  /** The allowlist's parent directory, shortened for display. */
  readonly allowlistDisplayDir: string;
  readonly collectionWarnings: readonly CollectionWarning[];
}

// gawk's POSIX `[[:space:]]`, enumerated codepoint by codepoint over the whole
// BMP (plus the astral planes, which contribute nothing) under this repo's
// `en_US.UTF-8` locale — the locale the shell scanner actually ran in. It is
// glibc `iswspace()`, so it is neither ASCII-only nor Unicode's `White_Space`:
// it deliberately EXCLUDES U+0085 NEL, U+00A0 NBSP, U+2007 FIGURE SPACE and
// U+202F NARROW NO-BREAK SPACE (as well as U+200B ZWSP and U+FEFF BOM) even
// though the first four carry `White_Space`. Spelled out rather than using
// `\s`, which matches NBSP and would widen the rules past gawk in the other
// direction during a bug-for-bug port.
//
// The one divergence this cannot preserve: gawk's set was locale-dependent and
// collapses to ASCII under `LC_ALL=C`, while a JS regex is not. Here — in the
// DETECTION rules — the UTF-8-locale set is pinned deliberately, because it is
// the detect-more side and missing a `DROP<U+2003>COLUMN` is data loss. Both
// directions are pinned by `migration-safety-core.test.ts` ("gawk's
// [[:space:]] boundary"). The acknowledgement parser must NOT share it; see
// `ALLOWLIST_SPACE_CLASS`.
const SPACE_CHARS =
  " \\t\\n\\v\\f\\r\\u1680\\u2000-\\u2006\\u2008-\\u200A\\u2028\\u2029\\u205F\\u3000";
const SPACE_CLASS = `[${SPACE_CHARS}]`;
const RULE_PATTERNS = {
  dropTable: new RegExp(`(^|[${SPACE_CHARS};])DROP${SPACE_CLASS}+TABLE(${SPACE_CLASS}|$)`, "u"),
  dropColumn: new RegExp(`DROP${SPACE_CLASS}+COLUMN(${SPACE_CLASS}|$)`, "u"),
  alterColumnType: new RegExp(
    `ALTER${SPACE_CLASS}+COLUMN${SPACE_CLASS}[^,;]*${SPACE_CLASS}TYPE(${SPACE_CLASS}|$)`,
    "u",
  ),
  addColumn: new RegExp(`ADD${SPACE_CLASS}+COLUMN(${SPACE_CLASS}|$)`, "u"),
  notNull: new RegExp(`NOT${SPACE_CLASS}+NULL([${SPACE_CHARS},;]|$)`, "u"),
  defaultClause: new RegExp(`DEFAULT(${SPACE_CLASS}|$)`, "u"),
} as const;

const LEADING_SPACE = new RegExp(`^${SPACE_CLASS}+`, "u");
const TRAILING_SPACE = new RegExp(`${SPACE_CLASS}+$`, "u");

// The allowlist parser's whitespace class, deliberately NOT `SPACE_CLASS`.
//
// The two concerns are asymmetric, and sharing one constant gets the
// acknowledgement path wrong in the data-loss direction. Detection was awk, and
// widening it can only ADD findings. Acknowledgement was Bash parameter
// expansion (`${trimmed%%[[:space:]]*}` at `3e63ac0e0`), and widening it can
// only REMOVE them: a wider separator turns a line Bash read as one unusable
// name into a name plus a reason, which SILENCES that migration's destructive
// findings from `WARN` down to `INFO` — a severity `doctor` does not count.
//
// Bash's own pattern matcher is locale-dependent the same way gawk's was.
// Enumerated over the whole BMP with `${s%%[[:space:]]*}` in bash 5.2.15: under
// `en_US.UTF-8` it matches the same 21 codepoints as `SPACE_CHARS`; under
// `LC_ALL=C` it collapses to the 6 ASCII ones. A JS regex cannot be both, so
// this path pins the `LC_ALL=C` side — the acknowledge-less, warn-more side.
// Consequence, intended: `<name><U+2003><reason>` is one (stale) name here, so
// the migration's `DROP COLUMN` still reports `WARN`.
const ALLOWLIST_SPACE_CLASS = "[ \\t\\n\\v\\f\\r]";
const ALLOWLIST_LEADING_SPACE = new RegExp(`^${ALLOWLIST_SPACE_CLASS}+`, "u");
const ALLOWLIST_FIRST_SPACE = new RegExp(ALLOWLIST_SPACE_CLASS, "u");

/** Per-rule risk guidance — one short sentence, shared by both renderers. */
const RULE_GUIDANCE: Readonly<Record<MigrationRule, string>> = {
  "DROP TABLE":
    "destroys all data in the table — confirm dependents are migrated and any export is captured first.",
  "DROP COLUMN":
    "destroys column data — confirm any backfill is complete and dependent reads are removed.",
  "ALTER COLUMN ... TYPE":
    "type change can narrow or fail — confirm the USING cast is total over existing rows.",
  "ADD COLUMN ... NOT NULL without DEFAULT":
    "will fail on tables with existing rows — add a DEFAULT, or split into add-nullable, backfill, SET NOT NULL.",
};

export function ruleGuidance(rule: MigrationRule): string {
  return RULE_GUIDANCE[rule];
}

/**
 * Uppercase the ASCII letters only — the smaller divergence from the gawk
 * `toupper` this port replaced, measured rather than assumed.
 *
 * Over every codepoint in U+0080-U+2FFFF in the repo's en_US.UTF-8 locale,
 * gawk 5.2.1 `toupper` yields an ASCII letter from exactly two of them
 * (U+0131 -> I, U+017F -> S). Neither I nor S occurs in DROP TABLE, DROP
 * COLUMN, ALTER COLUMN ... TYPE, ADD COLUMN, NOT NULL, or DEFAULT, so gawk's
 * non-ASCII folding can never complete a keyword. JS `toUpperCase()` yields an
 * ASCII letter from 17, and 11 of those (U+00DF, U+0149, U+1E97, U+1E99,
 * U+1E9A, and the U+FB00-U+FB06 ligatures) contain a letter the keywords do
 * use. None of them completes a keyword either, so the two spellings return
 * the same verdict on every input today; this one is kept because it is the
 * one that cannot manufacture an ASCII keyword letter out of non-ASCII input
 * at all, which is the conservative side of a bug-for-bug port.
 */
function asciiUpperCase(value: string): string {
  return value.replace(/[a-z]/gu, (character) => character.toUpperCase());
}

function trimSpace(value: string): string {
  return value.replace(LEADING_SPACE, "").replace(TRAILING_SPACE, "");
}

/**
 * Split file text into the records awk would have produced: one per line, with
 * no trailing empty record for a file that ends in a newline, and none at all
 * for an empty file.
 */
function toRecords(text: string): readonly string[] {
  if (text === "") return [];
  const records = text.split("\n");
  if (records.at(-1) === "") records.pop();
  return records;
}

/** Mutable cross-line lexer state; block comments span records. */
interface LexerState {
  inBlockComment: boolean;
}

/** One masked span plus the index the outer lexer should resume from. */
interface QuotedSpan {
  readonly masked: string;
  readonly endIndex: number;
}

/**
 * Consume one character of an open block comment, closing it at the comment
 * terminator. Returns the mask to append and the index to resume from.
 */
function continueBlockComment(source: string, index: number, state: LexerState): QuotedSpan {
  if (source.charAt(index) === "*" && source.charAt(index + 1) === "/") {
    state.inBlockComment = false;
    return { masked: "  ", endIndex: index + 1 };
  }
  return { masked: " ", endIndex: index };
}

/**
 * Mask a `'`- or `"`-delimited span starting at `start`, treating a doubled
 * delimiter as an escaped quote. An unterminated span runs to end of line, which
 * is what the awk original did and why the next line is lexed from scratch.
 */
function maskQuotedSpan(source: string, start: number, quote: string): QuotedSpan {
  let masked = " ";
  let index = start;
  for (index++; index < source.length; index++) {
    masked += " ";
    if (source[index] !== quote) continue;
    if (source[index + 1] === quote) {
      masked += " ";
      index++;
      continue;
    }
    break;
  }
  return { masked, endIndex: index };
}

/**
 * Mask SQL comments and quoted spans with spaces so review notes, inserted
 * text, and quoted identifiers cannot trigger destructive-pattern false
 * positives. Character positions are preserved (each masked character becomes
 * one space) and `state.inBlockComment` persists across records, exactly as the
 * awk original did. Dollar-quoted (`$$`) bodies are intentionally not handled.
 */
export function sanitizeSqlLine(source: string, state: LexerState): string {
  let out = "";
  for (let index = 0; index < source.length; index++) {
    const character = source.charAt(index);
    const next = source.charAt(index + 1);

    if (state.inBlockComment) {
      const span = continueBlockComment(source, index, state);
      out += span.masked;
      index = span.endIndex;
      continue;
    }

    if (character === "/" && next === "*") {
      out += "  ";
      state.inBlockComment = true;
      index++;
      continue;
    }

    if (character === "-" && next === "-") break;

    if (character === "'" || character === '"') {
      const span = maskQuotedSpan(source, index, character);
      out += span.masked;
      index = span.endIndex;
      continue;
    }

    out += character;
  }
  return out;
}

/** A rule match before it is attached to a file path. */
export interface SqlRuleMatch {
  readonly line: number;
  readonly rule: MigrationRule;
  readonly snippet: string;
}

function matchedRules(upper: string): readonly MigrationRule[] {
  const rules: MigrationRule[] = [];
  if (RULE_PATTERNS.dropTable.test(upper)) rules.push("DROP TABLE");
  if (RULE_PATTERNS.dropColumn.test(upper)) rules.push("DROP COLUMN");
  if (RULE_PATTERNS.alterColumnType.test(upper)) rules.push("ALTER COLUMN ... TYPE");
  if (
    RULE_PATTERNS.addColumn.test(upper) &&
    RULE_PATTERNS.notNull.test(upper) &&
    !RULE_PATTERNS.defaultClause.test(upper)
  ) {
    rules.push("ADD COLUMN ... NOT NULL without DEFAULT");
  }
  return rules;
}

/** Run the lexer and the four rules over one SQL file's whole text. */
export function scanSqlText(text: string): readonly SqlRuleMatch[] {
  const state: LexerState = { inBlockComment: false };
  const matches: SqlRuleMatch[] = [];
  toRecords(text).forEach((record, index) => {
    const raw = record.replace(/\r$/u, "");
    const upper = asciiUpperCase(sanitizeSqlLine(raw, state));
    const snippet = trimSpace(raw);
    for (const rule of matchedRules(upper)) {
      matches.push({ line: index + 1, rule, snippet });
    }
  });
  return matches;
}

/**
 * Parse an allowlist file. Each non-comment, non-empty line names a migration
 * directory; the optional reason is everything after the first whitespace run,
 * with leading whitespace stripped and trailing whitespace kept. A duplicated
 * name keeps the last occurrence's reason and line number.
 *
 * "Whitespace" here is `ALLOWLIST_SPACE_CLASS`, not the detection rules' wider
 * `SPACE_CLASS` — an acknowledgement may never be made easier to spell than
 * Bash could read it. See that constant for the measurement.
 */
export function parseAllowlist(text: string): ReadonlyMap<string, AllowlistEntry> {
  const entries = new Map<string, AllowlistEntry>();
  toRecords(text).forEach((record, index) => {
    const trimmed = record.replace(/\r$/u, "").replace(ALLOWLIST_LEADING_SPACE, "");
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const [name = ""] = trimmed.split(ALLOWLIST_FIRST_SPACE);
    const reason = trimmed.slice(name.length).replace(ALLOWLIST_LEADING_SPACE, "");
    entries.set(name, { name, reason, line: index + 1 });
  });
  return entries;
}

/**
 * Allowlist entries that name no migration on disk — a typo or a removed
 * migration. Existence is injected so the policy stays pure; the caller decides
 * what "the migration exists" means. Sorted by codepoint for stable output.
 */
export function findStaleEntries(
  allowlist: ReadonlyMap<string, AllowlistEntry>,
  migrationExists: (name: string) => boolean,
): readonly AllowlistEntry[] {
  return [...allowlist.values()]
    .filter((entry) => !migrationExists(entry.name))
    .sort((left, right) => compareByCodepoint(left.name, right.name));
}

/**
 * The migration directory name an allowlist entry would have to use for this
 * finding: paths are shaped `<dir>/<migration_name>/migration.sql`.
 *
 * The shell needed `dirname --`/`basename --` so a directory named
 * `--weird-name` was not read as a flag; `node:path/posix` is pure string
 * manipulation and has no such hazard.
 */
export function migrationNameFor(path: string): string {
  return pathBasename(pathDirname(path));
}

function compareHits(left: RuleHit, right: RuleHit): number {
  const byPath = compareByCodepoint(left.path, right.path);
  if (byPath !== 0) return byPath;
  if (left.line !== right.line) return left.line - right.line;
  return compareByCodepoint(`${left.rule}\t${left.snippet}`, `${right.rule}\t${right.snippet}`);
}

const MIGRATION_SQL_SUFFIX = "/migration.sql";

/**
 * The summary denominator's dedup key for one hit, or `undefined` when that
 * count treats the hit as acknowledged.
 *
 * Ported verbatim from the separate awk pass the shell ran over its findings
 * file (`migration-safety-scan.sh:550-559` at `3e63ac0e0`): it stripped a
 * literal `/migration.sql` suffix and otherwise kept the whole path as the key,
 * then looked acknowledgement up under the last component of that stripped path
 * rather than under `migrationNameFor`. For the conventional
 * `<dir>/<name>/migration.sql` shape the two agree exactly. They diverge only
 * for a loose `.sql` file passed by path: `x/a.sql x/b.sql` counted as two
 * migrations, not one, and a filename-keyed allowlist entry dropped such a file
 * from the count while the renderers still showed it as an unacknowledged WARN.
 * Leaf 119 is a bug-for-bug port, so both quirks are reproduced here rather
 * than rationalised into `pathDirname` — the summary sentence has to keep
 * saying what it said before.
 */
function summaryKeyFor(
  path: string,
  allowlist: ReadonlyMap<string, AllowlistEntry>,
): string | undefined {
  const key = path.endsWith(MIGRATION_SQL_SUFFIX)
    ? path.slice(0, -MIGRATION_SQL_SUFFIX.length)
    : path;
  const name = key.split("/").at(-1) ?? key;
  return allowlist.has(name) ? undefined : key;
}

/**
 * Resolve each hit's acknowledgement once and sort into report order (path,
 * then line, then rule). `has` rather than a truthy reason: an allowlist entry
 * with no reason is still an acknowledgement.
 */
export function classifyHits(
  hits: readonly RuleHit[],
  allowlist: ReadonlyMap<string, AllowlistEntry>,
): readonly ClassifiedHit[] {
  return [...hits]
    .map((hit) => {
      const entry = allowlist.get(migrationNameFor(hit.path));
      return {
        ...hit,
        acknowledgedReason: entry?.reason,
        summaryKey: summaryKeyFor(hit.path, allowlist),
      };
    })
    .sort(compareHits);
}

/** Counts every renderer needs, derived from one classified list. */
export interface ScanTotals {
  readonly total: number;
  readonly fileCount: number;
  readonly acknowledged: number;
  readonly unacknowledged: number;
  readonly unacknowledgedMigrations: number;
}

export function scanTotals(hits: readonly ClassifiedHit[]): ScanTotals {
  const acknowledged = hits.filter((hit) => hit.acknowledgedReason !== undefined).length;
  const unacknowledgedDirs = new Set<string>();
  for (const hit of hits) {
    if (hit.summaryKey !== undefined) unacknowledgedDirs.add(hit.summaryKey);
  }
  return {
    total: hits.length,
    fileCount: new Set(hits.map((hit) => hit.path)).size,
    acknowledged,
    unacknowledged: hits.length - acknowledged,
    unacknowledgedMigrations: unacknowledgedDirs.size,
  };
}
