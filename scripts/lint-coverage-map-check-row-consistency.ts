import { RATCHET_ID_PATTERN, validStatusParts } from "./lint-coverage-map-check-findings.js";
import type { CheckFinding, PathPattern, TableRow } from "./lint-coverage-map-check-types.js";

// Row-level consistency checks that cross-reference a coverage-map row's own
// columns (A4) or a row's claimed ratchet against that ratchet's real membership
// (A5). Both are pure string/glob logic with no ESLint reach probe, so — unlike
// the reach gate — they run in every mode, including `--staged`, where a
// misclassification would otherwise slip past pre-commit entirely.

// The `Normal lint` cell leads with `yes`/`no` and may trail a parenthetical
// qualifier (e.g. `yes (project service)`); only the leading verdict is checked.
function normalLintVerdict(normalLint: string): "yes" | "no" | undefined {
  const token = normalLint.trim().toLowerCase();
  if (token.startsWith("yes")) return "yes";
  if (token.startsWith("no")) return "no";
  return undefined;
}

// A4: the `Normal lint yes|no` column and the status token encode the same fact
// (`linted` ⇔ the file is covered by `bun run lint`), so they must agree. A row
// with an unparseable status is left to `collectRowFindings` (invalid-status)
// rather than double-reported here; a row whose `Normal lint` cell is neither
// `yes` nor `no` (e.g. a not-applicable dash) is skipped.
export function collectStatusConsistencyFindings(rows: readonly TableRow[]): CheckFinding[] {
  return rows.flatMap((row): CheckFinding[] => {
    const verdict = normalLintVerdict(row.normalLint);
    if (verdict === undefined) return [];
    const statusParts = validStatusParts(row.status);
    if (statusParts.length === 0) return [];
    const claimsLinted = statusParts.includes("linted");
    if (verdict === "yes" && !claimsLinted) {
      return [
        {
          kind: "status-consistency-mismatch",
          line: row.line,
          value: `\`Normal lint\` = \`${row.normalLint}\` (yes) but status \`${row.status}\` omits \`linted\``,
        },
      ];
    }
    if (verdict === "no" && claimsLinted) {
      return [
        {
          kind: "status-consistency-mismatch",
          line: row.line,
          value: `\`Normal lint\` = \`${row.normalLint}\` (no) but status \`${row.status}\` claims \`linted\``,
        },
      ];
    }
    return [];
  });
}

interface RatchetMembershipFindingOptions {
  readonly rows: readonly TableRow[];
  readonly trackedFiles: readonly string[];
  readonly extractPathPatterns: (row: TableRow) => readonly PathPattern[];
  // Resolve a ratchet id to a membership predicate, or `undefined` when the id is
  // unknown (that case is reported by `collectRowFindings` as unknown-ratchet).
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
  const { extractPathPatterns, ratchetMembership, rows, trackedFiles } = options;
  return rows.flatMap((row): CheckFinding[] => {
    const ratchetIds = [
      ...new Set([...row.ratchets.matchAll(RATCHET_ID_PATTERN)].map((match) => match[0])),
    ];
    if (ratchetIds.length === 0) return [];
    const patterns = extractPathPatterns(row);
    const matchedFiles = trackedFiles.filter((file) => patterns.some((p) => p.matcher(file)));
    if (matchedFiles.length === 0) return [];
    return ratchetIds.flatMap((ratchetId): CheckFinding[] => {
      const isMember = ratchetMembership(ratchetId);
      if (isMember === undefined || matchedFiles.some(isMember)) return [];
      return [
        {
          kind: "ratchet-membership-mismatch",
          line: row.line,
          value: `\`${ratchetId}\` covers none of the ${String(matchedFiles.length)} tracked file(s) this row matches (e.g. \`${matchedFiles[0] ?? ""}\`)`,
        },
      ];
    });
  });
}
