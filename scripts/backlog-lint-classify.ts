/**
 * Record-class and lifecycle classification for every tracked backlog note.
 *
 * `docs/agent_notes/backlog/` holds four different kinds of thing at once —
 * open workstreams, closed audit packs retained as provenance, ledgers, and an
 * audit's working artifacts — and the directory name predicts none of it. This
 * module answers "what is this file, and is it still actionable?" mechanically,
 * so the question does not require opening every file.
 *
 * Two deliberate constraints:
 *
 * - Classification reads the note's **own** parsed `Status:` header through
 *   `backlog-lint-grammar.ts`, never a full-text scan. Backlog notes routinely
 *   report on the state of other items; a grep for "Done" reads those.
 * - Lifecycle meaning stays owned by `backlog-lint-status.ts`. This module
 *   adds no status words and no second vocabulary.
 *
 * The result is a state projection. It deliberately does not rank, order, or
 * schedule anything: dispatch is owned by the hand-curated ready queue.
 */

import type { BacklogLocation, PackShape, ParsedBacklogNote } from "./backlog-lint-grammar.js";
import {
  buildPackShapes,
  isLeafBase,
  locateInBacklog,
  parseBacklogNote,
} from "./backlog-lint-grammar.js";
import { lifecycleFromStatus } from "./backlog-lint-status.js";
import type { BacklogLintFile } from "./backlog-lint-types.js";

/** What role a file plays in the namespace. */
export type BacklogRecordClass =
  /** The pack's task index (canonical `00-index.md`, or a de-facto index). */
  | "pack-index"
  /** An `NN-*.md` task note inside a pack. */
  | "leaf"
  /** A non-leaf pack companion: constraints, run ledgers, provenance records. */
  | "ledger"
  /** A `.md` note living directly in the backlog root. */
  | "standalone-note"
  /** A file below a pack's immediate members: `working/`, `prompts/`, `findings/`. */
  | "working-artifact";

/** Whether a note still asks for work. `unknown` means it declares no status. */
type BacklogLifecycleState = "actionable" | "terminal" | "unknown";

export interface ClassifiedBacklogNote {
  readonly path: string;
  readonly base: string;
  /** Owning pack directory, absent only for notes in the backlog root. */
  readonly pack?: string;
  readonly recordClass: BacklogRecordClass;
  readonly lifecycle: BacklogLifecycleState;
  readonly statusValue?: string;
}

export type LifecycleCounts = Readonly<Record<BacklogLifecycleState, number>>;

export interface PackRollup {
  /** Pack directory name relative to the backlog root. */
  readonly name: string;
  readonly indexPath?: string;
  readonly indexIsCanonical: boolean;
  /** Lifecycle counts over the pack's immediate members: index, leaves, ledgers. */
  readonly counts: LifecycleCounts;
  readonly total: number;
  /** Files in the pack's subdirectories (`working/`, `prompts/`, `findings/`). */
  readonly workingArtifacts: number;
}

export interface BacklogCatalog {
  readonly notes: readonly ClassifiedBacklogNote[];
  readonly packs: readonly PackRollup[];
  readonly standalone: readonly ClassifiedBacklogNote[];
  readonly ledgers: readonly ClassifiedBacklogNote[];
  readonly byRecordClass: Readonly<Record<BacklogRecordClass, LifecycleCounts>>;
  readonly totals: LifecycleCounts;
}

export interface ClassifyBacklogOptions {
  readonly files: readonly BacklogLintFile[];
  readonly backlogDir: string;
}

/** The record classes in catalog presentation order. */
export const BACKLOG_RECORD_CLASSES = [
  "pack-index",
  "leaf",
  "ledger",
  "standalone-note",
  "working-artifact",
] as const satisfies readonly BacklogRecordClass[];

function emptyCounts(): Record<BacklogLifecycleState, number> {
  return { actionable: 0, terminal: 0, unknown: 0 };
}

function countBy(notes: readonly ClassifiedBacklogNote[]): LifecycleCounts {
  const counts = emptyCounts();
  for (const note of notes) counts[note.lifecycle] += 1;
  return counts;
}

function lifecycleOf(statusValue: string | undefined): BacklogLifecycleState {
  if (statusValue === undefined || statusValue.trim().length === 0) return "unknown";
  return lifecycleFromStatus(statusValue);
}

function recordClassOf(
  base: string,
  location: BacklogLocation,
  indexBaseByPackDir: ReadonlyMap<string, string>,
): BacklogRecordClass {
  if (location.packDir === undefined) return "standalone-note";
  if (!location.immediateMember) return "working-artifact";
  if (indexBaseByPackDir.get(location.packDir) === base) return "pack-index";
  return isLeafBase(base) ? "leaf" : "ledger";
}

function classifyNote(
  parsed: ParsedBacklogNote,
  location: BacklogLocation,
  indexBaseByPackDir: ReadonlyMap<string, string>,
): ClassifiedBacklogNote {
  return {
    path: parsed.path,
    base: parsed.base,
    ...(location.packDir === undefined ? {} : { pack: location.packDir }),
    recordClass: recordClassOf(parsed.base, location, indexBaseByPackDir),
    lifecycle: lifecycleOf(parsed.statusValue),
    ...(parsed.statusValue === undefined ? {} : { statusValue: parsed.statusValue }),
  };
}

function rollUpPack(
  shape: PackShape,
  backlogDir: string,
  byPack: ReadonlyMap<string, ClassifiedBacklogNote[]>,
): PackRollup {
  const owned = byPack.get(shape.dir) ?? [];
  // The rollup describes the pack's task surface. Its `working/` artifacts are
  // counted separately so 100 audit packets cannot swamp a pack's real state.
  const members = owned.filter((note) => note.recordClass !== "working-artifact");
  return {
    name: shape.dir.slice(`${backlogDir}/`.length),
    ...(shape.indexBase === undefined ? {} : { indexPath: `${shape.dir}/${shape.indexBase}` }),
    indexIsCanonical: shape.indexIsCanonical,
    counts: countBy(members),
    total: members.length,
    workingArtifacts: owned.length - members.length,
  };
}

function countByRecordClass(
  notes: readonly ClassifiedBacklogNote[],
): Readonly<Record<BacklogRecordClass, LifecycleCounts>> {
  // The literal keys make the record exhaustive by type rather than by an
  // assertion, and one pass replaces five filtered passes over `notes`.
  const counts: Record<BacklogRecordClass, Record<BacklogLifecycleState, number>> = {
    "pack-index": emptyCounts(),
    leaf: emptyCounts(),
    ledger: emptyCounts(),
    "standalone-note": emptyCounts(),
    "working-artifact": emptyCounts(),
  };
  for (const note of notes) counts[note.recordClass][note.lifecycle] += 1;
  return counts;
}

/**
 * Classify every backlog file into a record class and lifecycle state, with a
 * per-pack rollup. Files outside `backlogDir` are ignored; results are sorted
 * by path so the projection is stable.
 */
export function classifyBacklogTree(options: ClassifyBacklogOptions): BacklogCatalog {
  const files = [...options.files].sort((left, right) => left.path.localeCompare(right.path));
  // One `locateInBacklog` call per file answers both "is this in the backlog?"
  // and "which pack owns it, and is it an immediate member?"; a file outside
  // the backlog is dropped before it is parsed.
  const located = files.flatMap((file) => {
    const location = locateInBacklog(file.path, options.backlogDir);
    return location === undefined ? [] : [{ note: parseBacklogNote(file), location }];
  });
  const shapes = buildPackShapes(
    located.map((entry) => entry.note),
    options.backlogDir,
  );
  const indexBaseByPackDir = new Map(
    shapes.flatMap((shape) =>
      shape.indexBase === undefined ? [] : [[shape.dir, shape.indexBase]],
    ),
  );
  const notes = located.map((entry) =>
    classifyNote(entry.note, entry.location, indexBaseByPackDir),
  );

  const byPack = new Map<string, ClassifiedBacklogNote[]>();
  for (const note of notes) {
    if (note.pack === undefined) continue;
    const bucket = byPack.get(note.pack) ?? [];
    bucket.push(note);
    byPack.set(note.pack, bucket);
  }

  return {
    notes,
    packs: shapes.map((shape) => rollUpPack(shape, options.backlogDir, byPack)),
    standalone: notes.filter((note) => note.recordClass === "standalone-note"),
    ledgers: notes.filter((note) => note.recordClass === "ledger"),
    byRecordClass: countByRecordClass(notes),
    totals: countBy(notes),
  };
}
