/**
 * The accepted backlog-note and pack grammar, named and fenced.
 *
 * `docs/agent_notes/backlog/` is not a schema-validated corpus. Notes were
 * written by hand over many months, and the advisory lint has grown a set of
 * tolerant readings so it can say something useful about all of them. Those
 * readings used to be scattered across the lint's private helpers, which made
 * them invisible to contributors and impossible to build on deliberately.
 *
 * This module is the one place that names them, splits them into two tiers, and
 * exposes a single parsed model (`parseBacklogNote`) plus a single pack model
 * (`buildPackShapes`) for every consumer — the advisory checks and the
 * generated catalog alike.
 *
 * **Canonical header contract.** A backlog note opens with a leading header
 * block of `Name: value` lines (optionally bold- or blockquote-wrapped). Two
 * fields are contractual: `Status:` and a date field (`Date`/`Created`/
 * `Updated`/`Last triaged`). New notes should carry both, in the opening block;
 * item 1 below records how much more tolerant the reader actually is. Everything a
 * consumer decides about a note's own lifecycle comes from its own `Status:`
 * value — never from a full-text scan of the body, which routinely names the
 * state of *other* items.
 *
 * **Compatibility fallbacks.** Everything below the canonical contract is a
 * tolerance for notes that predate it. Fallbacks are read only when the
 * canonical field is absent, they are never required of a new note, and no
 * fallback may be promoted into a mandatory format without a ruling. The list
 * is closed: a consumer that needs a new tolerant reading adds it here first.
 *
 * **The accepted grammar, canonical surfaces first.**
 *
 * 1. `header-block-scan` (canonical, `backlog-lint-metadata.ts`) — the "header
 *    block" has no delimiter. Fields are collected from the first 30 lines
 *    (`FRONT_MATTER_SCAN_LINES`), and a line that is not a `Name: value` field —
 *    a blank, a heading, a paragraph — is skipped rather than ending the block.
 *    So a `Status:` below the note's opening prose is still in contract. A field
 *    whose value is empty takes it from the lines that follow, joined with
 *    single spaces, up to the first blank line, heading, or next field.
 * 2. `status-header` (canonical, `backlog-lint-metadata.ts`) — a `Status:
 *    <value>` field in that block, optionally bold- or blockquote-wrapped. A
 *    note's own lifecycle state is read from this value and nothing else.
 * 3. `date-header` (canonical, `backlog-lint-metadata.ts`) — a
 *    `Date:`/`Created:`/`Updated:`/`Last triaged:` field in the same block,
 *    carrying an ISO `YYYY-MM-DD` token.
 * 4. `status-prose-date` (fallback, this module) — with no date field, an ISO
 *    date token embedded in the free-form Status value is read as the date.
 * 5. `pathname-date` (fallback, this module) — with no header date at all, a
 *    `YYYY-MM-DD` or `YYYY-MM` token in the pathname (usually the dated pack
 *    directory) is read as the date.
 * 6. `status-clause-interpretation` (fallback, `backlog-lint-status.ts`) —
 *    Status values are free-form prose, so they are read clause by clause with
 *    whole-word token matching, negation, and hedge handling rather than as a
 *    closed enum.
 * 7. `index-name-guess` (fallback, this module) — a pack without the canonical
 *    `00-index.md` gets a de-facto index guessed from a ranked keyword list
 *    over basenames (index, promotion-map, readme, report, …).
 * 8. `self-declared-index` (fallback, this module) — a pack member whose Status
 *    value names itself the pack's task index outranks the name guess.
 * 9. `same-directory-links` (fallback, `backlog-lint-index-table.ts`) —
 *    Markdown links whose target is a sibling `.md` file are read as the
 *    index's claim to own that leaf.
 * 10. `first-status-table` (fallback, `backlog-lint-index-table.ts`) — a pack
 *     index's task table is the first Markdown table whose header row contains
 *     a Status column.
 *
 * Terminal/active meaning itself is not owned here — it stays in
 * `backlog-lint-status.ts`, the single status vocabulary.
 */

import { extractMetadata, type MetadataField, type NoteMetadata } from "./backlog-lint-metadata.js";
import type { BacklogLintFile } from "./backlog-lint-types.js";

interface NoteDate {
  readonly value: Date;
  /** 1-based header line the date came from; absent for the pathname fallback. */
  readonly line?: number;
}

/**
 * One coherent parsed model of a backlog note, canonical fields kept distinct.
 * It carries the source `text` it was parsed from, so a consumer that needs the
 * raw body (an index's task table, say) never re-reads the file behind the
 * model's back.
 */
export interface ParsedBacklogNote extends BacklogLintFile {
  readonly base: string;
  readonly metadata: NoteMetadata;
  /** Canonical `Status:` value, or undefined when the note carries no header. */
  readonly statusValue?: string;
  readonly date?: NoteDate;
  /** `self-declared-index` fallback. */
  readonly selfDeclaresIndex: boolean;
  /** `index-name-guess` fallback rank; `Infinity` when the name is not index-like. */
  readonly indexNameRank: number;
}

const ISO_DATE_TOKEN_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/u;
const ISO_MONTH_TOKEN_PATTERN = /\b(\d{4})-(\d{2})[a-z]?\b/u;

const CANONICAL_INDEX_BASE = "00-index.md";
const LEAF_BASE_PATTERN = /^\d+[a-z]?-.+\.md$/iu;
const NN_PREFIX_PATTERN = /^\d+[a-z]?-/iu;
const PACK_MEMBER_SEGMENTS = 2;

// Non-canonical names that still read as a pack's task index, most-index-like
// first. Matched against the basename with any `NN-` prefix and `.md` removed.
const INDEX_NAME_KEYWORDS: readonly string[] = [
  "index",
  "promotion-map",
  "readme",
  "report",
  "overview",
  "summary",
  "contents",
  "toc",
];

// A note that names itself the pack's index — "Task index", "Parked task
// index", "Index" — rather than merely mentioning the word (e.g. a leaf whose
// status says it ran `module:index`).
const SELF_INDEX_PATTERN = /\btask index\b|^index\b/u;

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

/** Parse the first ISO `YYYY-MM-DD` token in `text`, if it is a real date. */
function parseIsoDateToken(text: string): Date | undefined {
  const match = text.match(ISO_DATE_TOKEN_PATTERN);
  return match === null ? undefined : dateFromMatch(match);
}

/** The first ISO date token in `text` when it is present but not a real date. */
export function invalidDateToken(text: string): string | undefined {
  const match = text.match(ISO_DATE_TOKEN_PATTERN);
  if (match === null || parseIsoDateToken(text) !== undefined) return undefined;
  return match[0];
}

function parseIsoMonthToken(text: string): Date | undefined {
  const match = text.match(ISO_MONTH_TOKEN_PATTERN);
  return match === null ? undefined : dateFromMatch(match, 1);
}

function dateFromField(field: MetadataField): NoteDate | undefined {
  const parsed = parseIsoDateToken(field.value);
  return parsed === undefined ? undefined : { value: parsed, line: field.line };
}

function dateFromPath(path: string): NoteDate | undefined {
  const exact = parseIsoDateToken(path);
  if (exact !== undefined) return { value: exact };
  const month = parseIsoMonthToken(path);
  return month === undefined ? undefined : { value: month };
}

/**
 * Resolve a note's date through the canonical `date-header` surface, then the
 * `status-prose-date` and `pathname-date` fallbacks, in that order. A `Date:`
 * field that carries no parseable token suppresses the fallbacks: the note
 * declared a date and got it wrong, which the lint reports separately.
 */
function resolveNoteDate(path: string, metadata: NoteMetadata): NoteDate | undefined {
  if (metadata.date !== undefined) return dateFromField(metadata.date);
  if (metadata.status !== undefined) {
    const fromStatus = dateFromField(metadata.status);
    if (fromStatus !== undefined) return fromStatus;
  }
  return dateFromPath(path);
}

/** The basename of a repo-relative path. */
function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

/** `index-name-guess` rank of a basename; `Infinity` when it is not index-like. */
function indexNameRank(base: string): number {
  const stripped = base.replace(NN_PREFIX_PATTERN, "").replace(/\.md$/iu, "").toLowerCase();
  const rank = INDEX_NAME_KEYWORDS.indexOf(stripped);
  return rank < 0 ? Number.POSITIVE_INFINITY : rank;
}

function selfDeclaresIndex(metadata: NoteMetadata): boolean {
  const status = metadata.status;
  return status !== undefined && SELF_INDEX_PATTERN.test(status.value.trim().toLowerCase());
}

/** Parse one backlog note into the single model every consumer reads. */
export function parseBacklogNote(file: BacklogLintFile): ParsedBacklogNote {
  const metadata = extractMetadata(file.text);
  const status = metadata.status;
  const base = baseName(file.path);
  const date = resolveNoteDate(file.path, metadata);
  return {
    path: file.path,
    text: file.text,
    base,
    metadata,
    ...(status === undefined ? {} : { statusValue: status.value }),
    ...(date === undefined ? {} : { date }),
    selfDeclaresIndex: selfDeclaresIndex(metadata),
    indexNameRank: indexNameRank(base),
  };
}

/** Where a file sits under the backlog root. One split answers both questions. */
export interface BacklogLocation {
  /** The owning pack directory at any depth; absent for a file in the root. */
  readonly packDir?: string;
  /**
   * True for exactly `<pack>/<file>`. Deeper files (`<pack>/working/x.md`) are
   * owned by the pack but are not members of its task surface.
   */
  readonly immediateMember: boolean;
}

/** Locate a file under `backlogDir`, or undefined when it lies outside it. */
export function locateInBacklog(path: string, backlogDir: string): BacklogLocation | undefined {
  const prefix = `${backlogDir}/`;
  if (!path.startsWith(prefix)) return undefined;
  const segments = path.slice(prefix.length).split("/");
  if (segments.length < PACK_MEMBER_SEGMENTS) return { immediateMember: false };
  return {
    packDir: `${backlogDir}/${segments[0] ?? ""}`,
    immediateMember: segments.length === PACK_MEMBER_SEGMENTS,
  };
}

/**
 * The pack directory a file is an immediate member of, or undefined otherwise —
 * so the backlog root itself and deeper working/finding subdirectories are
 * never treated as packs.
 */
export function packDirOf(path: string, backlogDir: string): string | undefined {
  const location = locateInBacklog(path, backlogDir);
  return location?.immediateMember === true ? location.packDir : undefined;
}

/** True when a basename has the `NN-` task-leaf shape. */
export function isLeafBase(base: string): boolean {
  return LEAF_BASE_PATTERN.test(base);
}

/**
 * True when a pack member could be the pack's index: its name ranks under
 * `index-name-guess`, or its own status declares it one (`self-declared-index`).
 */
export function isIndexCandidate(note: ParsedBacklogNote): boolean {
  return note.indexNameRank !== Number.POSITIVE_INFINITY || note.selfDeclaresIndex;
}

function betterCandidate(left: ParsedBacklogNote, right: ParsedBacklogNote): ParsedBacklogNote {
  if (left.selfDeclaresIndex !== right.selfDeclaresIndex) {
    return left.selfDeclaresIndex ? left : right;
  }
  if (left.indexNameRank !== right.indexNameRank) {
    return left.indexNameRank < right.indexNameRank ? left : right;
  }
  return left.base.localeCompare(right.base) <= 0 ? left : right;
}

/**
 * Choose a pack's task index: the canonical `00-index.md` when present,
 * otherwise the `self-declared-index` and `index-name-guess` fallbacks. Both
 * fallbacks are read off the parsed model, so index choice cannot drift from
 * what `parseBacklogNote` decided about the same note.
 */
export function chooseIndexBase(members: readonly ParsedBacklogNote[]): {
  readonly base?: string;
  readonly canonical: boolean;
} {
  const canonical = members.find((member) => member.base === CANONICAL_INDEX_BASE);
  if (canonical !== undefined) return { base: CANONICAL_INDEX_BASE, canonical: true };
  let best: ParsedBacklogNote | undefined;
  for (const member of members) {
    if (!isIndexCandidate(member)) continue;
    best = best === undefined ? member : betterCandidate(best, member);
  }
  return best === undefined ? { canonical: false } : { base: best.base, canonical: false };
}

/** A backlog pack: an immediate subdirectory of the backlog root. */
export interface PackShape {
  readonly dir: string;
  readonly members: readonly ParsedBacklogNote[];
  readonly indexBase?: string;
  readonly indexIsCanonical: boolean;
}

/**
 * Group parsed backlog notes into packs and resolve each pack's task index.
 * Callers parse once (`parseBacklogNote`) and pass the model in, so a pack
 * member is never parsed twice in one run.
 */
export function buildPackShapes(
  notes: readonly ParsedBacklogNote[],
  backlogDir: string,
): PackShape[] {
  const byDir = new Map<string, ParsedBacklogNote[]>();
  for (const note of notes) {
    const dir = packDirOf(note.path, backlogDir);
    if (dir === undefined) continue;
    const bucket = byDir.get(dir) ?? [];
    bucket.push(note);
    byDir.set(dir, bucket);
  }
  return [...byDir.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dir, members]) => {
      const { base, canonical } = chooseIndexBase(members);
      return {
        dir,
        members,
        ...(base === undefined ? {} : { indexBase: base }),
        indexIsCanonical: canonical,
      };
    });
}
