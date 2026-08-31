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

import type { DriftLeaf, DriftLinkSource } from "./backlog-lint-drift.js";
import { collectDriftFindings } from "./backlog-lint-drift.js";
import type { ParsedBacklogNote } from "./backlog-lint-grammar.js";
import {
  buildPackShapes,
  isIndexCandidate,
  isLeafBase,
  packDirOf,
  parseBacklogNote,
} from "./backlog-lint-grammar.js";
import { declaredIndexCatalogBases } from "./backlog-lint-index-table.js";
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

interface Pack {
  readonly dir: string;
  /** The pack's immediate members, each parsed exactly once. */
  readonly members: readonly ParsedBacklogNote[];
  readonly index?: ParsedBacklogNote;
  readonly indexIsCanonical: boolean;
}

/**
 * How a finding becomes relevant in `--file` mode:
 * - `dir`: revealed when an edit touches any file in the pack directory.
 * - `paths`: revealed when any source or leaf related to the finding is edited.
 */
type RevealOn = "dir" | "paths";

interface ScopedFinding {
  readonly finding: BacklogLintFinding;
  readonly packDir: string;
  readonly revealOn: RevealOn;
  readonly revealPaths?: readonly string[];
}

const MIN_PACK_LEAVES = 2;

/**
 * Pack shape (membership, leaf naming, index choice) is owned by
 * `backlog-lint-grammar.ts`; this module only adds the policy on top of it.
 */
function buildPacks(options: PackCheckOptions): Pack[] {
  const notes = options.corpus.map((file) => parseBacklogNote(file));
  return buildPackShapes(notes, options.backlogDir).map((shape) => {
    const index = shape.members.find((member) => member.base === shape.indexBase);
    return {
      dir: shape.dir,
      members: shape.members,
      ...(index === undefined ? {} : { index }),
      indexIsCanonical: shape.indexIsCanonical,
    };
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
        path: pack.index.path,
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
      path: member.path,
      statusValue: member.statusValue,
    }));
}

function declaredCatalogMembers(pack: Pack): DriftLinkSource[] {
  if (pack.index === undefined) return [];
  const memberByBase = new Map(pack.members.map((member) => [member.base, member]));
  return [...declaredIndexCatalogBases(pack.index.text)].flatMap((base) => {
    const member = memberByBase.get(base);
    return member === undefined ? [] : [{ base, path: member.path, text: member.text }];
  });
}

function packDriftFindings(pack: Pack): ScopedFinding[] {
  // Drift, dangling links, and unlisted leaves only make sense against the
  // canonical task index; a pack that has not adopted 00-index.md is already
  // flagged by structuralFindings and its de-facto index is not parsed here.
  if (pack.index === undefined || !pack.indexIsCanonical) return [];
  const indexPath = pack.index.path;
  const drift = collectDriftFindings({
    indexPath,
    indexBase: pack.index.base,
    indexText: pack.index.text,
    catalogs: declaredCatalogMembers(pack),
    memberBases: new Set(pack.members.map((member) => member.base)),
    leaves: driftLeaves(pack),
  });
  return drift.map((entry) => ({
    finding: entry.finding,
    packDir: pack.dir,
    revealOn: "paths",
    revealPaths: entry.revealPaths,
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
    case "paths":
      return scoped.revealPaths?.some((path) => focus.paths.has(path)) ?? false;
  }
}

// The status-vocabulary (typo) check targets task leaves only: NN-*.md members
// that are neither the pack's index nor an index-shaped companion (a report or
// README whose "status" is a role label, not a lifecycle state).
function statusCheckLeaves(pack: Pack): ParsedBacklogNote[] {
  return pack.members.filter(
    (member) =>
      isLeafBase(member.base) && member.base !== pack.index?.base && !isIndexCandidate(member),
  );
}

function unknownStatusFindings(
  leaves: readonly ParsedBacklogNote[],
  focus: ReadonlySet<string> | undefined,
): BacklogLintFinding[] {
  const findings: BacklogLintFinding[] = [];
  for (const member of leaves) {
    if (focus !== undefined && !focus.has(member.path)) continue;
    const status = member.metadata.status;
    if (status === undefined || status.value.length === 0) continue;
    if (recognizedStatus(status.value)) continue;
    findings.push({
      kind: "unknown-status",
      path: member.path,
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
