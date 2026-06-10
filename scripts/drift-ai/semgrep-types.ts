// Data shapes for the Semgrep prototype-lane adapter (semgrep plan, slice 2).
// These model the slice of Semgrep's `--json` scan output that the advisory
// builder consumes: findings with rule metadata for grouping/ranking, scan
// errors and skipped rules for degradation disclosure, and engine provenance.
//
// Deliberately absent: `extra.lines` and `extra.fingerprint`. Logged-out
// Semgrep CE redacts both to the literal "requires login", and the snippet
// policy (plan decision 5) keeps source snippets out of advisory output
// either way, so the adapter never reads them.

export const SEMGREP_TOOL = "semgrep" as const;

// Optional rule metadata surfaced for grouping and display rank (plan
// decision 4). Semgrep rules declare cwe/owasp/subcategory as either a scalar
// or a list; the parser normalizes all of them to lists.
export type SemgrepFindingMetadata = {
  readonly confidence: string | null;
  readonly likelihood: string | null;
  readonly impact: string | null;
  readonly category: string | null;
  readonly subcategory: readonly string[];
  readonly cwe: readonly string[];
  readonly owasp: readonly string[];
  readonly references: readonly string[];
};

// One Semgrep result row. `checkId` is reported as Semgrep namespaces it (a
// local rule config's path stem prefixes the bare rule id, e.g. `tmp.x` for
// rule `x` in `/tmp/rules.yml`), so consumers must not assume bare ids.
// `message` is the RENDERED message: Semgrep interpolates matched metavariable
// values into it, so it can embed matched source text (including secrets) even
// though `extra.lines` is never read. The advisory layer withholds it from
// default output (`--include-rule-messages` opts in).
export type SemgrepFinding = {
  readonly checkId: string;
  readonly path: string;
  readonly startLine: number;
  readonly startCol: number | null;
  readonly endLine: number;
  readonly endCol: number | null;
  readonly message: string;
  readonly severity: string | null;
  readonly metadata: SemgrepFindingMetadata;
};

// One `errors[]` entry from the scan JSON (parse errors, invalid rules,
// per-file timeouts). Preserved as degradation DATA, never findings.
export type SemgrepScanError = {
  readonly message: string;
  readonly level: string | null;
  readonly type: string | null;
  readonly path: string | null;
};

export type SemgrepScanOutput = {
  // Top-level `version` from the scan JSON (engine provenance).
  readonly engineVersion: string | null;
  readonly findings: readonly SemgrepFinding[];
  // Result rows that did not carry the required check_id/path/range fields.
  // Counted (a partial-parse disclosure), never silently dropped.
  readonly malformedResultCount: number;
  readonly errors: readonly SemgrepScanError[];
  // Rule ids Semgrep skipped as invalid (`skipped_rules`).
  readonly skippedRules: readonly string[];
  // Count of `paths.scanned`, when present, for scan-scope disclosure.
  readonly scannedCount: number | null;
};

// Parsing produces DATA either way: an unreadable document is a degraded
// prototype run (the runner maps it to `run-failed`), never an exception and
// never a drift finding.
export type SemgrepScanParse =
  | { readonly ok: true; readonly scan: SemgrepScanOutput }
  | { readonly ok: false; readonly error: string };
