import { RATCHET_ID_PATTERN } from "./lint-coverage-map-check-findings.js";
import type { CheckFinding, CoverageRow } from "./lint-coverage-map-check-types.js";

// The one row-level consistency check that cannot be a schema invariant: a row's
// claimed ratchet against that ratchet's real membership (A5). It is pure
// glob logic with no ESLint reach probe, so — unlike the reach gate, which only
// the full-verify `docs:lint-coverage-map:audit` turns on — it runs in every
// mode, including the committing gate, where a misclassification would
// otherwise slip past pre-commit entirely.
//
// Its sibling check (A4, `Normal lint` vs the `linted` status token) moved into
// `lint-coverage-map-manifest-schema.ts`: `normalLint.covered` and the status
// enum are one typed pair now, so disagreement fails at manifest load instead of
// being rediscovered by re-parsing two Markdown cells.

interface RatchetMembershipFindingOptions {
  readonly rows: readonly CoverageRow[];
  readonly trackedFiles: readonly string[];
  // Resolve a ratchet id to a membership predicate, or `undefined` when the id is
  // unknown (that case is reported by `collectUnknownRatchetFindings`).
  readonly ratchetMembership: (ratchetId: string) => ((file: string) => boolean) | undefined;
}

// A5 (membership half): a row may name `ratchet/<id>` only when at least one
// tracked file it matches is actually a member of that ratchet's glob (its
// `files` minus `ignores`). Validating the id exists is not enough — the prose
// linking a row to a ratchet rots silently when the ratchet's membership moves
// away from the row's files. A row that matches no tracked files at all is left
// to `collectStalePathFindings`; only matched files with zero membership overlap
// are flagged here. Partial overlap (some matched files are members, some are
// not) is legitimate — rows routinely name a ratchet that covers only a slice of
// their files.
export function collectRatchetMembershipFindings(
  options: RatchetMembershipFindingOptions,
): CheckFinding[] {
  const { ratchetMembership, rows, trackedFiles } = options;
  return rows.flatMap((row): CheckFinding[] => {
    const ratchetIds = [
      ...new Set([...row.ratchetProse.matchAll(RATCHET_ID_PATTERN)].map((match) => match[0])),
    ];
    if (ratchetIds.length === 0) return [];
    const matchedFiles = trackedFiles.filter((file) =>
      row.patterns.some((pattern) => pattern.matcher(file)),
    );
    if (matchedFiles.length === 0) return [];
    return ratchetIds.flatMap((ratchetId): CheckFinding[] => {
      const isMember = ratchetMembership(ratchetId);
      if (isMember === undefined || matchedFiles.some(isMember)) return [];
      return [
        {
          kind: "ratchet-membership-mismatch",
          entry: row.id,
          value: `\`${ratchetId}\` covers none of the ${String(matchedFiles.length)} tracked file(s) this row matches (e.g. \`${matchedFiles[0] ?? ""}\`)`,
        },
      ];
    });
  });
}
