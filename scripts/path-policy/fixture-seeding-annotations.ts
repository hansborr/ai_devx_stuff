// The explicit, reviewable escape hatch for what the static sandbox model
// cannot decide, plus the report it emits when a seeding form is invisible to
// that model.
//
// The rule this enforces: a guard that silently skips a fixture is worse than
// one that admits it. When a `cp` seeds a sandbox from an expression built at
// runtime, the copy set cannot be read, so the fixture must either be seeded
// literally or say out loud that it is not modelled.
//
// An annotation sits in the comment block directly above the `cp` it governs
// and carries a reason:
//
//   # fixture-closure: not-an-entry - <why this copied module never runs here>
//   # fixture-closure: unmodelled-copy - <why the copy set is not literal>
//
// A marker that governs nothing is itself a failure, so annotations cannot rot
// in place after the statement below them changes.

import { capture, entryPathPattern } from "./fixture-copy-expressions.js";

const seedingAnnotationPattern = /^#\s*fixture-closure:\s*([a-z-]+)\s+-\s+\S.*$/u;
const notAnEntryAnnotation = "not-an-entry";
const unmodelledCopyAnnotation = "unmodelled-copy";
const seedingAnnotationKinds = new Set([notAnEntryAnnotation, unmodelledCopyAnnotation]);

export interface AppliedCopy {
  /** Repository paths the copy seeded into the sandbox. */
  readonly copied: readonly string[];
  /** Source operands that look like paths but the model could not read. */
  readonly unreadable: readonly string[];
}

/**
 * The annotation kind on a comment line: a known kind, `undefined` when the
 * line is not an annotation, or the raw text when the kind is unrecognized.
 */
export function parseSeedingAnnotation(
  trimmed: string,
): { readonly kind: string; readonly known: boolean } | undefined {
  const match = seedingAnnotationPattern.exec(trimmed);
  if (match === null) return undefined;
  const kind = capture(match, 1);
  return { kind, known: seedingAnnotationKinds.has(kind) };
}

/**
 * Apply the annotations sitting above a `cp` and report what the copy leaves
 * unmodelled. `nonEntryPaths` is the sandbox set that suppresses entry walking
 * for the paths `not-an-entry` covers.
 */
export function applySeedingAnnotations(
  fixturePath: string,
  fixtureRoot: string,
  annotations: readonly string[],
  applied: AppliedCopy,
): { readonly failures: readonly string[]; readonly nonEntryPaths: readonly string[] } {
  const failures: string[] = [];
  const nonEntryPaths: string[] = [];
  if (annotations.includes(notAnEntryAnnotation)) {
    const entries = applied.copied.filter((path) => entryPathPattern.test(path));
    if (entries.length === 0) {
      failures.push(
        `${fixturePath} fixture-closure annotation 'not-an-entry' governs a cp that copies no scripts/** entry`,
      );
    }
    nonEntryPaths.push(...entries);
  }
  const acknowledged = annotations.includes(unmodelledCopyAnnotation);
  if (acknowledged && applied.unreadable.length === 0) {
    failures.push(
      `${fixturePath} fixture-closure annotation 'unmodelled-copy' governs a cp whose sources all resolve`,
    );
  }
  if (!acknowledged) {
    for (const operand of applied.unreadable) {
      failures.push(
        `${fixturePath} fixture ${fixtureRoot} seeds from ${operand}, which this model cannot resolve; ` +
          "annotate the call site with `# fixture-closure: unmodelled-copy - <reason>` or seed it literally",
      );
    }
  }
  return { failures, nonEntryPaths };
}
