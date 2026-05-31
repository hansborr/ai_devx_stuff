// Shared core for the non-function structural-duplication checks
// (duplicate-types, duplicate-schemas, duplicate-literals, duplicate-constants).
//
// Each of those checks is an EXACT structural-hash detector: it extracts shape
// entries from the AST, canonicalizes each into a stable key string, and groups
// entries with an identical key across the project. Identical canonical hash =>
// near-zero false positives (only a configurable triviality filter), so this core
// deliberately does NOT use the Dice-similarity machinery near-duplicates needs.
//
// The four checks are thin: each supplies a per-check `extract` (walk one parsed
// source file -> ShapeEntry[]) plus the finding message/hint/details, and reuses
// this walk -> canonicalize -> hash -> group cross-file -> build findings pipeline.
// Report builds share a parsed-source collection across selected duplicate-shape
// checks, while direct single-check calls still use the same collection path
// without a cache.
//
// Evidence, not verdicts: a finding surfaces the duplicate GROUP with every member
// location, the canonical hash, and per-check details. It does not adjudicate which
// member is "wrong" and does not drop "generated-looking" files — only the user's
// configured ignore/excludeGlobs and the per-check triviality guards filter input.

import type { ts } from "ts-morph";

import type { CheckOutcome, CheckRunContext, CheckServiceEnv } from "./check-plugin.js";
import type { DriftAiIgnoreConfig } from "./config.js";
import { globsForIgnoredPaths, matchesAnyGlob } from "./config-match.js";
import { hashFeature } from "./feature-hash.js";
import {
  collectParsedSourceFiles,
  type ParsedSourceFileCache,
  parsedSourceFileCacheForReport,
} from "./parsed-source-cache.js";
import { changedFilesFromScope, sortFindingsByFileMessage, toPosix } from "./path-util.js";
import type { DetectorScope } from "./scope.js";
import type { DriftCheckId, DriftFinding, FindingProvenance } from "./types.js";

// The provenance every duplicate-shape finding carries: this is drift:ai's OWN
// structural analysis (not a target tool's verdict), so configSource is
// "drift-baseline" and the engine is "ts-morph" (the bundled TypeScript parser the
// extractors run on), matching how near-duplicates stamps its ts-morph engine.
export const DUPLICATE_SHAPE_PROVENANCE: FindingProvenance = {
  configSource: "drift-baseline",
  tool: "ts-morph",
};

export type DuplicateShapeDetailValue = string | number | boolean | readonly string[];
export type DuplicateShapeDetails = Readonly<Record<string, DuplicateShapeDetailValue>>;

// One extracted, canonicalized shape occurrence. `canonicalKey` is the structural
// identity (e.g. a sorted prop bag, a normalized z.object key set, a literal value)
// that groups entries; `label` is the human-readable name shown in findings (a type
// name, a const name, the literal value). `extra` carries per-check structured
// specifics folded into finding details.
export type ShapeEntry<TExtra = unknown> = {
  readonly canonicalKey: string;
  readonly label: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly extra: TExtra;
};

// A per-check extractor: parse one source file (already done for it) and yield the
// shape occurrences it cares about. The parsed `ts.SourceFile` is shared so a check
// never re-parses within a single file.
export type DuplicateShapeExtractor<TExtra = unknown> = (
  filePath: string,
  source: string,
  sourceFile: ts.SourceFile,
) => readonly ShapeEntry<TExtra>[];

export type CollectShapeEntriesInput<TExtra = unknown> = {
  readonly repoRoot: string;
  readonly roots: readonly string[];
  readonly sourceExtensions: ReadonlySet<string>;
  readonly ignore: DriftAiIgnoreConfig;
  readonly excludeGlobs: readonly string[];
  readonly parsedSourceCache?: ParsedSourceFileCache;
  readonly extract: DuplicateShapeExtractor<TExtra>;
};

export type DuplicateShapeServices = {
  readonly parsedSourceCache?: ParsedSourceFileCache;
};

export function resolveDuplicateShapeServices(env: CheckServiceEnv): DuplicateShapeServices {
  return { parsedSourceCache: parsedSourceFileCacheForReport(env.reportCache) };
}

// Walk the configured roots (honoring ignore rules, source extensions, and .d.ts
// exclusion — exactly the inventory near-duplicates uses), parse each surviving
// file once per source cache, then apply this check's excludeGlobs before running
// the extractor.
export function collectShapeEntries<TExtra>(
  input: CollectShapeEntriesInput<TExtra>,
): readonly ShapeEntry<TExtra>[] {
  const parsedSources =
    input.parsedSourceCache?.collect({
      repoRoot: input.repoRoot,
      roots: input.roots,
      sourceExtensions: input.sourceExtensions,
      ignore: input.ignore,
    }) ??
    collectParsedSourceFiles({
      repoRoot: input.repoRoot,
      roots: input.roots,
      sourceExtensions: input.sourceExtensions,
      ignore: input.ignore,
    });
  const entries: ShapeEntry<TExtra>[] = [];
  for (const parsedSource of parsedSources) {
    if (matchesPathOrAncestorGlob(parsedSource.filePath, input.excludeGlobs)) continue;
    entries.push(
      ...input.extract(
        toPosix(parsedSource.filePath),
        parsedSource.source,
        parsedSource.sourceFile,
      ),
    );
  }
  return entries;
}

function matchesPathOrAncestorGlob(filePath: string, globs: readonly string[]): boolean {
  if (matchesAnyGlob(filePath, globs)) return true;
  const parts = filePath.split("/");
  for (let length = parts.length - 1; length > 0; length -= 1) {
    if (matchesAnyGlob(parts.slice(0, length).join("/"), globs)) return true;
  }
  return false;
}

// A cross-file group of structurally identical shapes. `members` are every
// occurrence (sorted by location); `distinctFileCount` is how many files the group
// spans; `hash` is the stable FNV-1a fold of the canonical key.
export type DuplicateShapeGroup<TExtra = unknown> = {
  readonly hash: string;
  readonly canonicalKey: string;
  readonly members: readonly ShapeEntry<TExtra>[];
  readonly distinctFileCount: number;
};

export type GroupDuplicateShapesOptions = {
  // Minimum number of DISTINCT files a canonical key must appear in to be a group.
  // 2 for the cross-file checks; configurable (the literals check exposes it as N).
  readonly minDistinctFiles: number;
};

export function groupDuplicateShapes<TExtra>(
  entries: readonly ShapeEntry<TExtra>[],
  options: GroupDuplicateShapesOptions,
): DuplicateShapeGroup<TExtra>[] {
  const byKey = new Map<string, ShapeEntry<TExtra>[]>();
  for (const entry of entries) {
    const bucket = byKey.get(entry.canonicalKey) ?? [];
    bucket.push(entry);
    byKey.set(entry.canonicalKey, bucket);
  }
  const groups: DuplicateShapeGroup<TExtra>[] = [];
  for (const [canonicalKey, members] of byKey) {
    const distinctFileCount = new Set(members.map((member) => member.filePath)).size;
    if (distinctFileCount < options.minDistinctFiles) continue;
    groups.push({
      hash: hashFeature(canonicalKey),
      canonicalKey,
      members: sortMembers(members),
      distinctFileCount,
    });
  }
  return sortGroups(groups);
}

function sortMembers<TExtra>(members: readonly ShapeEntry<TExtra>[]): ShapeEntry<TExtra>[] {
  return [...members].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath, "en") || left.startLine - right.startLine,
  );
}

function sortGroups<TExtra>(
  groups: readonly DuplicateShapeGroup<TExtra>[],
): DuplicateShapeGroup<TExtra>[] {
  return [...groups].sort((left, right) => {
    const leftPrimary = left.members[0];
    const rightPrimary = right.members[0];
    if (leftPrimary === undefined || rightPrimary === undefined) return 0;
    return (
      leftPrimary.filePath.localeCompare(rightPrimary.filePath, "en") ||
      leftPrimary.startLine - rightPrimary.startLine ||
      left.hash.localeCompare(right.hash, "en")
    );
  });
}

export function firstDuplicateShapeMember<TExtra>(
  group: DuplicateShapeGroup<TExtra>,
): ShapeEntry<TExtra> {
  const first = group.members[0];
  if (first === undefined) throw new Error("duplicate-shapes group has no members");
  return first;
}

export type DuplicateShapeFindingOptions<TExtra = unknown> = {
  readonly check: DriftCheckId;
  readonly detectorScope: DetectorScope;
  readonly provenance: FindingProvenance;
  readonly messageForGroup: (group: DuplicateShapeGroup<TExtra>) => string;
  readonly hint: string;
  // Per-check structured specifics merged into details alongside the always-present
  // groupHash / memberCount / distinctFileCount.
  readonly detailsForGroup: (group: DuplicateShapeGroup<TExtra>) => DuplicateShapeDetails;
};

export function buildDuplicateShapeFindings<TExtra>(
  groups: readonly DuplicateShapeGroup<TExtra>[],
  options: DuplicateShapeFindingOptions<TExtra>,
): DriftFinding[] {
  const changed = changedFileSet(options.detectorScope);
  const findings: DriftFinding[] = [];
  for (const group of groups) {
    if (!groupTouchesScope(group, options.detectorScope, changed)) continue;
    findings.push(groupFinding(group, changed, options));
  }
  return sortFindingsByFileMessage(findings);
}

function groupFinding<TExtra>(
  group: DuplicateShapeGroup<TExtra>,
  changed: ReadonlySet<string> | null,
  options: DuplicateShapeFindingOptions<TExtra>,
): DriftFinding {
  const primary = primaryMember(group, changed);
  const others = group.members.filter((member) => member !== primary);
  return {
    check: options.check,
    file: formatLocation(primary),
    message: options.messageForGroup(group),
    hint: options.hint,
    relatedFiles: others.map(formatLocation),
    details: {
      groupHash: group.hash,
      memberCount: group.members.length,
      distinctFileCount: group.distinctFileCount,
      ...options.detailsForGroup(group),
    },
    provenance: options.provenance,
  };
}

function primaryMember<TExtra>(
  group: DuplicateShapeGroup<TExtra>,
  changed: ReadonlySet<string> | null,
): ShapeEntry<TExtra> {
  const fallback = firstDuplicateShapeMember(group);
  if (changed === null) return fallback;
  return group.members.find((member) => changed.has(member.filePath)) ?? fallback;
}

function changedFileSet(detectorScope: DetectorScope): ReadonlySet<string> | null {
  if (detectorScope.scopeMode === "current") return null;
  return new Set(changedFilesFromScope(detectorScope).map((file) => toPosix(file.path)));
}

function groupTouchesScope<TExtra>(
  group: DuplicateShapeGroup<TExtra>,
  detectorScope: DetectorScope,
  changed: ReadonlySet<string> | null,
): boolean {
  if (detectorScope.scopeMode === "current") return true;
  if (changed === null) return false;
  return group.members.some((member) => changed.has(member.filePath));
}

function formatLocation<TExtra>(entry: ShapeEntry<TExtra>): string {
  return `${entry.filePath}:${String(entry.startLine)}-${String(entry.endLine)}`;
}

// --- shared check runner ----------------------------------------------------
// The four duplicate-shape checks (types/schemas/literals/constants) all run the
// same pipeline: resolve the effective excludeGlobs (per-check defaults + the
// repo's ignore globs + the check's configured excludeGlobs), collect shape
// entries with the check's extractor, group cross-file, and build findings. Each
// check supplies only its extractor and finding text via this helper, so the
// `*-check.ts` files stay thin. None of these checks resolve adapter services.
export type DuplicateShapeCheckParams<TExtra = unknown> = {
  readonly check: DriftCheckId;
  readonly extract: DuplicateShapeExtractor<TExtra>;
  readonly minDistinctFiles: number;
  readonly configExcludeGlobs: readonly string[];
  readonly messageForGroup: (group: DuplicateShapeGroup<TExtra>) => string;
  readonly hint: string;
  readonly detailsForGroup: (group: DuplicateShapeGroup<TExtra>) => DuplicateShapeDetails;
};

export function runDuplicateShapeCheck<TExtra>(
  ctx: CheckRunContext<DuplicateShapeServices>,
  params: DuplicateShapeCheckParams<TExtra>,
): CheckOutcome {
  // Input filtering is intentionally limited to what the user configured: the
  // repo's ignore rules (also applied by walkSourceFiles, which additionally skips
  // .d.ts) plus this check's own excludeGlobs. There is NO built-in test/fixture
  // content exclusion — silently dropping a test member from a prod+test duplicate
  // group (or a whole test-only group) would hide real evidence. Removing a file
  // from analysis stays the user's explicit job via ignore/excludeGlobs.
  const entries = collectShapeEntries({
    repoRoot: ctx.repoRoot,
    roots: ctx.roots,
    sourceExtensions: ctx.sourceExtensions,
    ignore: ctx.config.ignore,
    excludeGlobs: [...globsForIgnoredPaths(ctx.config.ignore), ...params.configExcludeGlobs],
    parsedSourceCache: ctx.services.parsedSourceCache,
    extract: params.extract,
  });
  const groups = groupDuplicateShapes(entries, { minDistinctFiles: params.minDistinctFiles });
  return {
    status: "ran",
    findings: buildDuplicateShapeFindings(groups, {
      check: params.check,
      detectorScope: ctx.detectorScope,
      provenance: DUPLICATE_SHAPE_PROVENANCE,
      messageForGroup: params.messageForGroup,
      hint: params.hint,
      detailsForGroup: params.detailsForGroup,
    }),
  };
}
