/**
 * Pack-level advisory checks for the backlog lint.
 *
 * A "pack" is an immediate subdirectory of the backlog root that collects a set
 * of leaf notes (`NN-*.md`) behind a task index. These checks flag structural
 * drift a single-file front-matter check cannot see: a pack with no index, an
 * index living under a non-canonical name, and (added by later commits) rows
 * whose recorded state disagrees with the leaf they link to.
 *
 * The checks build their view of each pack from a corpus of files. In a full
 * run the corpus is every backlog note; in `--file` mode the CLI loads the
 * edited file plus its pack siblings, and `focusPaths` scopes the reported
 * findings back down to what the edit is actually about.
 */

import type { DriftLeaf } from "./backlog-lint-drift.js";
import { collectDriftFindings } from "./backlog-lint-drift.js";
import { extractMetadata } from "./backlog-lint-metadata.js";
import { recognizedStatus } from "./backlog-lint-status.js";
import type { BacklogLintFile, BacklogLintFinding } from "./backlog-lint-types.js";

export interface PackCheckOptions {
  /** Files used to build pack structure (immediate pack members are honored). */
  readonly corpus: readonly BacklogLintFile[];
  /** Backlog root directory, used to decide which files are pack members. */
  readonly backlogDir: string;
  /** When set (file mode), findings are scoped to edits touching these paths. */
  readonly focusPaths?: readonly string[];
}

/** A file that lives directly inside a pack directory. */
interface PackMember {
  readonly file: BacklogLintFile;
  readonly base: string;
}

interface Pack {
  readonly dir: string;
  readonly members: readonly PackMember[];
  readonly index?: PackMember;
  readonly indexIsCanonical: boolean;
}

/**
 * How a finding becomes relevant in `--file` mode:
 * - `dir`: revealed when an edit touches any file in the pack directory.
 * - `leaf`: revealed when the linked leaf itself, or the pack index, is edited.
 * - `index`: revealed only when the pack index is edited.
 */
type RevealOn = "dir" | "leaf" | "index";

interface ScopedFinding {
  readonly finding: BacklogLintFinding;
  readonly packDir: string;
  readonly revealOn: RevealOn;
  readonly leafPath?: string;
  readonly indexPath?: string;
}

const CANONICAL_INDEX_BASE = "00-index.md";
const LEAF_BASE_PATTERN = /^\d+[a-z]?-.+\.md$/iu;
const NN_PREFIX_PATTERN = /^\d+[a-z]?-/iu;
const MIN_PACK_LEAVES = 2;
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

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

/** The pack directory a file belongs to, or undefined if it is not a member. */
function packDirOf(path: string, backlogDir: string): string | undefined {
  const prefix = `${backlogDir}/`;
  if (!path.startsWith(prefix)) return undefined;
  const rest = path.slice(prefix.length);
  const segments = rest.split("/");
  // Exactly <pack>/<file>: immediate members only, so the backlog root itself
  // and deeper rule/finding subdirectories are never treated as packs.
  if (segments.length !== PACK_MEMBER_SEGMENTS) return undefined;
  return `${backlogDir}/${segments[0] ?? ""}`;
}

function isLeafBase(base: string): boolean {
  return LEAF_BASE_PATTERN.test(base);
}

function indexKeywordRank(base: string): number {
  const stripped = base.replace(NN_PREFIX_PATTERN, "").replace(/\.md$/iu, "").toLowerCase();
  const rank = INDEX_NAME_KEYWORDS.indexOf(stripped);
  return rank < 0 ? Number.POSITIVE_INFINITY : rank;
}

// A note that names itself the pack's index — "Task index", "Parked task
// index", "Index" — rather than merely mentioning the word (e.g. a leaf whose
// status says it ran `module:index`).
const SELF_INDEX_PATTERN = /\btask index\b|^index\b/u;

function selfDeclaresIndex(file: BacklogLintFile): boolean {
  const status = extractMetadata(file.text).status;
  return status !== undefined && SELF_INDEX_PATTERN.test(status.value.trim().toLowerCase());
}

interface IndexCandidate {
  readonly member: PackMember;
  readonly selfIndex: boolean;
  readonly nameRank: number;
}

function indexCandidate(member: PackMember): IndexCandidate | undefined {
  const nameRank = indexKeywordRank(member.base);
  const selfIndex = selfDeclaresIndex(member.file);
  if (nameRank === Number.POSITIVE_INFINITY && !selfIndex) return undefined;
  return { member, selfIndex, nameRank };
}

function betterCandidate(left: IndexCandidate, right: IndexCandidate): IndexCandidate {
  if (left.selfIndex !== right.selfIndex) return left.selfIndex ? left : right;
  if (left.nameRank !== right.nameRank) return left.nameRank < right.nameRank ? left : right;
  return left.member.base.localeCompare(right.member.base) <= 0 ? left : right;
}

function chooseIndex(members: readonly PackMember[]): {
  readonly index?: PackMember;
  readonly canonical: boolean;
} {
  const canonical = members.find((member) => member.base === CANONICAL_INDEX_BASE);
  if (canonical !== undefined) return { index: canonical, canonical: true };
  let best: IndexCandidate | undefined;
  for (const member of members) {
    const candidate = indexCandidate(member);
    if (candidate === undefined) continue;
    best = best === undefined ? candidate : betterCandidate(best, candidate);
  }
  return { index: best?.member, canonical: false };
}

function buildPacks(options: PackCheckOptions): Pack[] {
  const byDir = new Map<string, PackMember[]>();
  for (const file of options.corpus) {
    const dir = packDirOf(file.path, options.backlogDir);
    if (dir === undefined) continue;
    const bucket = byDir.get(dir) ?? [];
    bucket.push({ file, base: baseName(file.path) });
    byDir.set(dir, bucket);
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, members]) => {
      const { index, canonical } = chooseIndex(members);
      return { dir, members, index, indexIsCanonical: canonical };
    });
}

function leafCount(pack: Pack): number {
  return pack.members.filter(
    (member) => isLeafBase(member.base) && member.base !== pack.index?.base,
  ).length;
}

function structuralFindings(pack: Pack): ScopedFinding[] {
  if (pack.index === undefined) {
    if (leafCount(pack) < MIN_PACK_LEAVES) return [];
    return [
      {
        finding: {
          kind: "missing-index",
          path: pack.dir,
          message: `pack has ${String(leafCount(pack))} leaf notes but no 00-index.md task index`,
        },
        packDir: pack.dir,
        revealOn: "dir",
      },
    ];
  }
  if (pack.indexIsCanonical) return [];
  return [
    {
      finding: {
        kind: "nonstandard-index-name",
        path: pack.index.file.path,
        message: "de-facto pack index has a non-canonical name (expected 00-index.md)",
      },
      packDir: pack.dir,
      revealOn: "dir",
    },
  ];
}

function driftLeaves(pack: Pack): DriftLeaf[] {
  return pack.members
    .filter((member) => isLeafBase(member.base) && member.base !== pack.index?.base)
    .map((member) => ({
      base: member.base,
      path: member.file.path,
      statusValue: extractMetadata(member.file.text).status?.value,
    }));
}

function packDriftFindings(pack: Pack): ScopedFinding[] {
  // Drift, dangling links, and unlisted leaves only make sense against the
  // canonical task index; a pack that has not adopted 00-index.md is already
  // flagged by structuralFindings and its de-facto index is not parsed here.
  if (pack.index === undefined || !pack.indexIsCanonical) return [];
  const indexPath = pack.index.file.path;
  const drift = collectDriftFindings({
    indexPath,
    indexBase: pack.index.base,
    indexText: pack.index.file.text,
    memberBases: new Set(pack.members.map((member) => member.base)),
    leaves: driftLeaves(pack),
  });
  return drift.map((entry) => ({
    finding: entry.finding,
    packDir: pack.dir,
    revealOn: entry.reveal,
    leafPath: entry.leafPath,
    indexPath,
  }));
}

interface FocusContext {
  readonly paths: ReadonlySet<string>;
  readonly dirs: ReadonlySet<string>;
}

function keepScoped(scoped: ScopedFinding, focus: FocusContext): boolean {
  switch (scoped.revealOn) {
    case "dir":
      return focus.dirs.has(scoped.packDir);
    case "leaf":
      return (
        (scoped.leafPath !== undefined && focus.paths.has(scoped.leafPath)) ||
        (scoped.indexPath !== undefined && focus.paths.has(scoped.indexPath))
      );
    case "index":
      return scoped.indexPath !== undefined && focus.paths.has(scoped.indexPath);
  }
}

function isIndexShaped(member: PackMember): boolean {
  return (
    indexKeywordRank(member.base) !== Number.POSITIVE_INFINITY || selfDeclaresIndex(member.file)
  );
}

// The status-vocabulary (typo) check targets task leaves only: NN-*.md members
// that are neither the pack's index nor an index-shaped companion (a report or
// README whose "status" is a role label, not a lifecycle state).
function statusCheckLeaves(pack: Pack): PackMember[] {
  return pack.members.filter(
    (member) =>
      isLeafBase(member.base) && member.base !== pack.index?.base && !isIndexShaped(member),
  );
}

function unknownStatusFindings(
  leaves: readonly PackMember[],
  focus: ReadonlySet<string> | undefined,
): BacklogLintFinding[] {
  const findings: BacklogLintFinding[] = [];
  for (const member of leaves) {
    if (focus !== undefined && !focus.has(member.file.path)) continue;
    const status = extractMetadata(member.file.text).status;
    if (status === undefined || status.value.length === 0) continue;
    if (recognizedStatus(status.value)) continue;
    findings.push({
      kind: "unknown-status",
      path: member.file.path,
      line: status.line,
      message: `Status "${status.value}" contains no recognized status token`,
    });
  }
  return findings;
}

export function collectPackFindings(options: PackCheckOptions): BacklogLintFinding[] {
  const packs = buildPacks(options);
  const scoped = packs.flatMap((pack) => [...structuralFindings(pack), ...packDriftFindings(pack)]);
  const leaves = packs.flatMap((pack) => statusCheckLeaves(pack));
  const focusSet = options.focusPaths === undefined ? undefined : new Set(options.focusPaths);
  const unknown = unknownStatusFindings(leaves, focusSet);
  if (options.focusPaths === undefined) {
    return [...scoped.map((entry) => entry.finding), ...unknown];
  }
  const focus: FocusContext = {
    paths: new Set(options.focusPaths),
    dirs: new Set(
      options.focusPaths
        .map((path) => packDirOf(path, options.backlogDir))
        .filter((dir): dir is string => dir !== undefined),
    ),
  };
  const structural = scoped
    .filter((entry) => keepScoped(entry, focus))
    .map((entry) => entry.finding);
  return [...structural, ...unknown];
}
