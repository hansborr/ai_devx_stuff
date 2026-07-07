import { DriftAiError } from "./errors.js";

export const DRIFT_AI_ADVISORY_BANNER =
  "Areas to check, not defects. drift:ai makes no claim these are problems.";

export function parseWindowDays(value: string, exampleDays: number): number {
  const match = /^(\d+)d?$/u.exec(value.trim());
  const days = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(days) || days <= 0) {
    throw new DriftAiError(
      `--window requires a positive number of days, e.g. ${String(exampleDays)} or ${String(exampleDays)}d.`,
    );
  }
  return days;
}
