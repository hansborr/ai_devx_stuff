import type { EditCheckRegression, EditCheckTarget } from "./edit-check.js";

// Single owner of the internal edit-check wire protocol — the tab-separated,
// line-oriented rows exchanged between the two CLI steps and the advisory shell
// hook in scripts/ai-hooks/ratchet-regression-check.sh:
//
//   --edit-check-targets emits `target` rows (no ESLint run);
//   the hook writes a chosen subset to a temp file;
//   --edit-check parses that file and emits `checked` / `regression` rows.
//
// The CLI produces `checked`/`regression` rows and consumes `target` rows, so
// this module formats all three kinds but only parses `target`. Keep the column
// order and counts here in sync with that hook's `read -r` field lists.
//
// Decode is permissive by design: a malformed `target` row (wrong kind, wrong
// arity, or an empty path/testId/ruleId) decodes to `undefined` so the caller
// soft-skips it instead of linting a path discovery never produced. That
// matches the advisory hook's degrade-quietly contract. ruleId-vs-registry
// agreement is enforced later in groupTargets, where the registry is in scope.

const TARGET_KIND = "target";
const CHECKED_KIND = "checked";
const REGRESSION_KIND = "regression";

// Exact column count of a `target` row: kind, path, testId, ruleId, cacheIdentity.
const TARGET_FIELD_COUNT = 5;

// The wire protocol is tab-separated and line-oriented, so a field that itself
// contains a tab, newline, or carriage return cannot round-trip: it either
// splits a row into extra columns or a target across lines, and the row is
// dropped on decode. Git-tracked paths never contain these, so the assumption
// is safe, but a violation is announced (below) instead of vanishing silently.
function containsProtocolSeparator(value: string): boolean {
  return /[\t\r\n]/u.test(value);
}

function warnProtocolSeparator(detail: string): void {
  console.error(`edit-check-protocol: ${detail}`);
}

// A regression row's identity fields round-tripped through validated `target`
// rows, `reason` is an internal literal, and the counts are numbers — none can
// carry a separator. `repairCommand` is the one field sourced from human-edited
// rule docs (`meta.docs.repairCommand`), so an accidental tab or newline there
// would truncate or split the fixed-arity row the advisory hook reads
// positionally. Collapse separators to single spaces (the command stays
// readable advisory text) and announce, mirroring the target-row loudness.
function sanitizeRepairCommand(value: string, ruleId: string): string {
  if (!containsProtocolSeparator(value)) return value;
  warnProtocolSeparator(
    `repair command for '${ruleId}' contains a tab or newline; collapsed to spaces to keep the row intact`,
  );
  return value.replace(/[\t\r\n]+/gu, " ");
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export function formatEditCheckTarget(target: EditCheckTarget): string {
  const fields = [
    TARGET_KIND,
    target.path,
    target.testId,
    target.ruleId,
    target.cacheIdentity ?? "",
  ];
  if (fields.some(containsProtocolSeparator)) {
    warnProtocolSeparator(
      `target for '${target.path}' contains a tab or newline and will not round-trip; it will be dropped on decode`,
    );
  }
  return fields.join("\t");
}

export function parseEditCheckTargetLine(line: string): EditCheckTarget | undefined {
  const fields = line.split("\t");
  if (fields[0] === TARGET_KIND && fields.length !== TARGET_FIELD_COUNT) {
    warnProtocolSeparator(
      `target row has ${String(fields.length)} fields (expected ${String(TARGET_FIELD_COUNT)}); a path or id likely contains a tab; dropping`,
    );
  }
  if (fields.length !== TARGET_FIELD_COUNT) return undefined;
  const [kind, path, testId, ruleId, cacheIdentity] = fields;
  if (kind !== TARGET_KIND) return undefined;
  if (!isNonEmpty(path) || !isNonEmpty(testId) || !isNonEmpty(ruleId)) return undefined;
  return isNonEmpty(cacheIdentity)
    ? { path, testId, ruleId, cacheIdentity }
    : { path, testId, ruleId };
}

export function formatEditCheckChecked(path: string): string {
  return [CHECKED_KIND, path].join("\t");
}

// Regression columns: kind, path, testId, ruleId, reason, line, baselineCount,
// currentCount, repairCommand. The trailing repair column is empty for rules
// without a mechanical repair; the hook reads it positionally, so it is always
// emitted (fixed arity) rather than appended conditionally.
export function formatEditCheckRegression(regression: EditCheckRegression): string {
  return [
    REGRESSION_KIND,
    regression.path,
    regression.testId,
    regression.ruleId,
    regression.reason,
    regression.line ?? "",
    String(regression.baselineCount),
    String(regression.currentCount),
    regression.repairCommand === undefined
      ? ""
      : sanitizeRepairCommand(regression.repairCommand, regression.ruleId),
  ].join("\t");
}
