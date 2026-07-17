import type { BaselineDebtAccountingFailure } from "./baseline-debt-accounting.js";
import { BASELINE_FILENAME, DEBT_LOG_FILENAME } from "./paths.js";

type LifecycleFailure = Extract<
  BaselineDebtAccountingFailure,
  { readonly kind: "missing-ratchet" | "metric-change" | "coverage-shrink" }
>;
type IncreaseFailure = Exclude<BaselineDebtAccountingFailure, LifecycleFailure>;

function isLifecycleFailure(failure: BaselineDebtAccountingFailure): failure is LifecycleFailure {
  return (
    failure.kind === "missing-ratchet" ||
    failure.kind === "metric-change" ||
    failure.kind === "coverage-shrink"
  );
}

function lifecycleDetail(increase: LifecycleFailure): string {
  if (increase.kind === "missing-ratchet") {
    return `${increase.testId}: base ratchet id is missing without an orphan-removal or proven-retirement record`;
  }
  if (increase.kind === "metric-change") {
    return `${increase.testId}: metric changed from ${increase.previousMetric} to ${increase.currentMetric} without a migration record`;
  }
  if (increase.hasShrinkRecords) {
    return `${increase.testId}: registry glob changes removed baselined path coverage; coverage-shrink records are present but do not account for: ${increase.unaccountedPaths.join(", ")}`;
  }
  return `${increase.testId}: registry glob changes removed baselined path coverage (${increase.removedPaths.join(", ")}) without a coverage-shrink record`;
}

function baselineIncreaseDetail(increase: IncreaseFailure): string {
  const prefix = `${increase.testId} ${increase.path}`;
  if (increase.kind === "new-path") {
    return `${prefix}: new path baseline is ${String(increase.currentCount)} finding(s)`;
  }
  if (increase.kind === "lines") {
    return (
      `${prefix}: effective lines increased from ` +
      `${String(increase.previousLines ?? 0)} to ${String(increase.currentLines ?? 0)}`
    );
  }
  if (increase.kind === "complexity") {
    return (
      `${prefix}: max complexity increased from ` +
      `${String(increase.previousComplexity ?? 0)} to ${String(increase.currentComplexity ?? 0)}`
    );
  }
  return (
    `${prefix}: finding count increased from ` +
    `${String(increase.previousCount)} to ${String(increase.currentCount)}`
  );
}

function increaseDetail(increase: BaselineDebtAccountingFailure): string {
  return isLifecycleFailure(increase)
    ? lifecycleDetail(increase)
    : baselineIncreaseDetail(increase);
}

export function formatBaselineDebtAccountingFailures(
  failures: readonly BaselineDebtAccountingFailure[],
): string {
  return (
    `${BASELINE_FILENAME} has ${String(failures.length)} unaccounted baseline increase(s): ` +
    `${failures.map(increaseDetail).join("; ")}; ` +
    `use --retire-ratchet for a proven promotion or accept intentional debt with ` +
    `bun run lint:ratchet:update -- --allow-worse --reason "<why>", and commit the paired ${DEBT_LOG_FILENAME} line`
  );
}
