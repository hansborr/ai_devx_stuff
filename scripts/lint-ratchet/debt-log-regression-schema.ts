import type { LintRatchetRegression } from "../lint-ratchet-baseline.js";
import {
  isRecord,
  parseOptionalNonNegativeInteger,
  rejectUnknownKeys,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNormalizedPath,
} from "./debt-log-parse-helpers.js";

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
  const optional = parseOptionalRegressionInts(value, path, failures);
  if (!isRegressionReason(value.reason)) {
    failures.push(
      `${path}.reason must be new-path, increased-count, increased-lines, or increased-complexity`,
    );
  }
  if (
    testId === undefined ||
    ruleId === undefined ||
    itemPath === undefined ||
    baselineCount === undefined ||
    currentCount === undefined ||
    !isRegressionReason(value.reason)
  ) {
    return undefined;
  }
  return {
    testId,
    ruleId,
    path: itemPath,
    baselineCount,
    currentCount,
    reason: value.reason,
    ...optional,
  };
}
