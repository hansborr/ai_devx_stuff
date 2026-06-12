import {
  isRecord,
  parseOptionalNonNegativeInteger,
  rejectUnknownKeys,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNormalizedPath,
} from "./debt-log-parse-helpers.js";
import type { LintRatchetRegression } from "./lint-ratchet-baseline.js";

const REGRESSION_KEYS: ReadonlySet<string> = new Set([
  "testId",
  "ruleId",
  "path",
  "baselineCount",
  "currentCount",
  "baselineLines",
  "currentLines",
  "baselineComplexity",
  "currentComplexity",
  "line",
  "reason",
]);

function isRegressionReason(value: unknown): value is LintRatchetRegression["reason"] {
  return (
    value === "new-path" ||
    value === "increased-count" ||
    value === "increased-lines" ||
    value === "increased-complexity"
  );
}

type OptionalRegressionInts = {
  -readonly [K in
    | "baselineLines"
    | "currentLines"
    | "baselineComplexity"
    | "currentComplexity"
    | "line"]?: LintRatchetRegression[K];
};

const OPTIONAL_REGRESSION_INT_FIELDS: readonly (keyof OptionalRegressionInts)[] = [
  "baselineLines",
  "currentLines",
  "baselineComplexity",
  "currentComplexity",
  "line",
];

// Severity-delta fields are the optional payload the comparator attaches to a
// regression to explain *how* a path got worse. `line` is excluded: it is a
// pure location hint the comparator may add to any reason, so it is never
// required or forbidden here.
type SeverityDeltaField =
  | "baselineLines"
  | "currentLines"
  | "baselineComplexity"
  | "currentComplexity";

const SEVERITY_DELTA_FIELDS: readonly SeverityDeltaField[] = [
  "baselineLines",
  "currentLines",
  "baselineComplexity",
  "currentComplexity",
];

interface RegressionShapeRule {
  // Fields that must be present for this reason.
  readonly required: readonly SeverityDeltaField[];
  // Fields that may be present in addition to `required`; everything else in
  // SEVERITY_DELTA_FIELDS is forbidden for this reason.
  readonly allowed: readonly SeverityDeltaField[];
  // Optional fields of which at most one may be present (new-path carries
  // either a current line count or a current complexity, never both).
  readonly atMostOne?: readonly SeverityDeltaField[];
}

// Mirrors the comparator's producing functions in
// lint-ratchet-baseline-compare.ts: increasedLinesRegression,
// increasedComplexityRegression, countIncreaseRegression, and
// newPathSeverityPayload.
const REGRESSION_SHAPE_RULES: Readonly<
  Record<LintRatchetRegression["reason"], RegressionShapeRule>
> = {
  "increased-lines": { required: ["baselineLines", "currentLines"], allowed: [] },
  "increased-complexity": { required: ["baselineComplexity", "currentComplexity"], allowed: [] },
  "increased-count": { required: [], allowed: [] },
  "new-path": {
    required: [],
    allowed: ["currentLines", "currentComplexity"],
    atMostOne: ["currentLines", "currentComplexity"],
  },
};

function validateRegressionShape(
  reason: LintRatchetRegression["reason"],
  optional: OptionalRegressionInts,
  path: string,
  failures: string[],
): boolean {
  const rule = REGRESSION_SHAPE_RULES[reason];
  const allowedFields = new Set<SeverityDeltaField>([...rule.required, ...rule.allowed]);
  let ok = true;
  for (const field of rule.required) {
    if (optional[field] === undefined) {
      failures.push(`${path}.${field} is required for reason "${reason}"`);
      ok = false;
    }
  }
  for (const field of SEVERITY_DELTA_FIELDS) {
    if (!allowedFields.has(field) && optional[field] !== undefined) {
      failures.push(`${path}.${field} is not allowed for reason "${reason}"`);
      ok = false;
    }
  }
  if (rule.atMostOne !== undefined) {
    const present = rule.atMostOne.filter((field) => optional[field] !== undefined);
    if (present.length > 1) {
      failures.push(
        `${path} reason "${reason}" must not carry both ${rule.atMostOne.join(" and ")}`,
      );
      ok = false;
    }
  }
  return ok;
}

function parseOptionalRegressionInts(
  value: Record<string, unknown>,
  path: string,
  failures: string[],
): OptionalRegressionInts {
  const parsed: OptionalRegressionInts = {};
  for (const field of OPTIONAL_REGRESSION_INT_FIELDS) {
    const result = parseOptionalNonNegativeInteger(value[field], `${path}.${field}`, failures);
    if (result !== undefined) parsed[field] = result;
  }
  return parsed;
}

type RequiredRegressionFields = Pick<
  LintRatchetRegression,
  "testId" | "ruleId" | "path" | "baselineCount" | "currentCount"
>;

function parseRequiredRegressionFields(
  value: Record<string, unknown>,
  path: string,
  failures: string[],
): RequiredRegressionFields | undefined {
  const testId = requireNonEmptyString(value.testId, `${path}.testId`, failures);
  const ruleId = requireNonEmptyString(value.ruleId, `${path}.ruleId`, failures);
  const itemPath = requireNormalizedPath(value.path, `${path}.path`, failures);
  const baselineCount = requireNonNegativeInteger(
    value.baselineCount,
    `${path}.baselineCount`,
    failures,
  );
  const currentCount = requireNonNegativeInteger(
    value.currentCount,
    `${path}.currentCount`,
    failures,
  );
  if (
    testId === undefined ||
    ruleId === undefined ||
    itemPath === undefined ||
    baselineCount === undefined ||
    currentCount === undefined
  ) {
    return undefined;
  }
  return { testId, ruleId, path: itemPath, baselineCount, currentCount };
}

export function parseDebtLogRegression(
  value: unknown,
  path: string,
  failures: string[],
): LintRatchetRegression | undefined {
  if (!isRecord(value)) {
    failures.push(`${path} must be an object`);
    return undefined;
  }
  rejectUnknownKeys(value, REGRESSION_KEYS, path, failures);
  // Parse every field before short-circuiting so one malformed entry surfaces
  // all of its problems in a single pass.
  const required = parseRequiredRegressionFields(value, path, failures);
  const optional = parseOptionalRegressionInts(value, path, failures);
  const reason = isRegressionReason(value.reason) ? value.reason : undefined;
  if (reason === undefined) {
    failures.push(
      `${path}.reason must be new-path, increased-count, increased-lines, or increased-complexity`,
    );
  }
  const shapeValid =
    reason !== undefined && validateRegressionShape(reason, optional, path, failures);
  if (required === undefined || reason === undefined || !shapeValid) {
    return undefined;
  }
  return { ...required, reason, ...optional };
}
