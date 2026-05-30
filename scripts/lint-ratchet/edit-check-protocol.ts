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

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

export function formatEditCheckTarget(target: EditCheckTarget): string {
  return [TARGET_KIND, target.path, target.testId, target.ruleId, target.cacheIdentity ?? ""].join(
    "\t",
  );
}

export function parseEditCheckTargetLine(line: string): EditCheckTarget | undefined {
  const fields = line.split("\t");
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
  ].join("\t");
}
