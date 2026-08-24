import type { EditCheckRegression, EditCheckTarget } from "./edit-check.js";

// Single owner of the internal edit-check wire protocol: the tab-separated,
// line-oriented rows exchanged between the CLI and advisory shell hooks.
//
//   --edit-check-targets emits `target` rows (no ESLint run);
//   the hook writes a chosen subset to a temp file;
//   --edit-check parses that file and emits `checked` / `regression` rows.
//
// The shell contract in scripts/ai-hooks/edit-check-protocol.sh and every
// TypeScript formatter derive from EDIT_CHECK_ROW_LAYOUTS, so field order and
// counts have one owner.
//
// Only `target` rows are decoded in TypeScript — the CLI reads back the subset
// the hook chose. The result rows (`checked` / `regression` / `ratchet-covered`)
// are decoded by the shell hooks alone, so they carry formatters only; add a
// decoder when a TypeScript consumer appears.
//
// Target decode is permissive by design: a malformed row (wrong kind, wrong
// arity, or an empty path/testId/ruleId) decodes to `undefined` so the caller
// soft-skips it instead of linting a path discovery never produced. That
// matches the advisory hook's degrade-quietly contract. ruleId-vs-registry
// agreement is enforced later in groupTargets, where the registry is in scope.

interface EditCheckRowLayout {
  readonly kind: string;
  readonly fields: readonly string[];
  readonly fieldCount: number;
  readonly acceptedOptionalTrailingFields: readonly string[];
}

function defineRowLayout<
  const Kind extends string,
  const Fields extends readonly string[],
  const OptionalFields extends readonly Fields[number][],
>(
  kind: Kind,
  fields: Fields,
  acceptedOptionalTrailingFields: OptionalFields,
): EditCheckRowLayout & {
  readonly kind: Kind;
  readonly fields: Fields;
  readonly acceptedOptionalTrailingFields: OptionalFields;
} {
  return { kind, fields, fieldCount: fields.length, acceptedOptionalTrailingFields };
}

export const EDIT_CHECK_ROW_LAYOUTS = {
  target: defineRowLayout("target", ["kind", "path", "testId", "ruleId", "cacheIdentity"], []),
  checked: defineRowLayout("checked", ["kind", "path"], []),
  regression: defineRowLayout(
    "regression",
    [
      "kind",
      "path",
      "testId",
      "ruleId",
      "reason",
      "line",
      "baselineCount",
      "currentCount",
      "repairCommand",
    ],
    ["repairCommand"],
  ),
  "ratchet-covered": defineRowLayout("ratchet-covered", ["kind", "path", "ruleIds"], []),
} as const;

export interface RatchetCoverageRow {
  readonly path: string;
  readonly ruleIds: readonly string[];
}

function formatProtocolRow(layout: EditCheckRowLayout, fields: readonly string[]): string {
  if (fields.length !== layout.fieldCount) {
    throw new Error(
      `${layout.kind} formatter produced ${String(fields.length)} fields; expected ${String(layout.fieldCount)}`,
    );
  }
  return fields.join("\t");
}

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
  const layout = EDIT_CHECK_ROW_LAYOUTS.target;
  const fields = [
    layout.kind,
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
  return formatProtocolRow(layout, fields);
}

export function parseEditCheckTargetLine(line: string): EditCheckTarget | undefined {
  const layout = EDIT_CHECK_ROW_LAYOUTS.target;
  const fields = line.split("\t");
  if (fields[0] === layout.kind && fields.length !== layout.fieldCount) {
    warnProtocolSeparator(
      `target row has ${String(fields.length)} fields (expected ${String(layout.fieldCount)}); a path or id likely contains a tab; dropping`,
    );
  }
  if (fields.length !== layout.fieldCount) return undefined;
  const [kind, path, testId, ruleId, cacheIdentity] = fields;
  if (kind !== layout.kind) return undefined;
  if (!isNonEmpty(path) || !isNonEmpty(testId) || !isNonEmpty(ruleId)) return undefined;
  return isNonEmpty(cacheIdentity)
    ? { path, testId, ruleId, cacheIdentity }
    : { path, testId, ruleId };
}

export function formatEditCheckChecked(path: string): string {
  const layout = EDIT_CHECK_ROW_LAYOUTS.checked;
  return formatProtocolRow(layout, [layout.kind, path]);
}

// Regression columns: kind, path, testId, ruleId, reason, line, baselineCount,
// currentCount, repairCommand. The trailing repair column is empty for rules
// without a mechanical repair; the hook reads it positionally, so it is always
// emitted (fixed arity) rather than appended conditionally.
export function formatEditCheckRegression(regression: EditCheckRegression): string {
  const layout = EDIT_CHECK_ROW_LAYOUTS.regression;
  return formatProtocolRow(layout, [
    layout.kind,
    regression.path,
    regression.testId,
    regression.ruleId,
    regression.reason,
    regression.line === undefined ? "" : String(regression.line),
    String(regression.baselineCount),
    String(regression.currentCount),
    regression.repairCommand === undefined
      ? ""
      : sanitizeRepairCommand(regression.repairCommand, regression.ruleId),
  ]);
}

export function formatRatchetCoverageRow(row: RatchetCoverageRow): string {
  const layout = EDIT_CHECK_ROW_LAYOUTS["ratchet-covered"];
  return formatProtocolRow(layout, [layout.kind, row.path, row.ruleIds.join(", ")]);
}
