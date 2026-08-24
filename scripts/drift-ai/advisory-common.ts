import { z } from "zod";

import { DriftAiError } from "./errors.js";

export const DRIFT_AI_ADVISORY_BANNER =
  "Areas to check, not defects. drift:ai makes no claim these are problems.";

// Internal to this module since unit 120: external callers consume the Zod
// fragment `windowDaysValue` below instead of the raw reader.
function parseWindowDays(value: string, exampleDays: number): number {
  const match = /^(\d+)d?$/u.exec(value.trim());
  const days = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(days) || days <= 0) {
    throw new DriftAiError(
      `--window requires a positive number of days, e.g. ${String(exampleDays)} or ${String(exampleDays)}d.`,
    );
  }
  return days;
}

// Zod value fragment for `--window`: the transform calls parseWindowDays, so
// the diagnostic (including the per-subcommand example days) stays owned by
// the reader and byte-identical to the callback-era parsers.
export function windowDaysValue(
  exampleDays: number,
): z.ZodPipe<z.ZodString, z.ZodTransform<number, string>> {
  return z.string().transform((value) => parseWindowDays(value, exampleDays));
}
