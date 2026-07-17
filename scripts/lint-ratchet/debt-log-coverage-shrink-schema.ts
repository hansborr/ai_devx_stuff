import { z } from "zod";

import { isRatchetRegressionReasonPlaceholder } from "./recovery-command.js";

// Zod schema for a coverage-shrink debt-log entry: the reasoned record written
// when a ratchet's file/ignore globs narrow and committed paths drop out of
// coverage. `removedPaths` must name at least one dropped path, and `reason` must
// be a real explanation rather than the update command's placeholder.

const nonEmptyStringArray = z.array(z.string().min(1));

const realReason = z
  .string()
  .min(1)
  .refine((value) => !isRatchetRegressionReasonPlaceholder(value), {
    message: "reason must be a real reason, not the placeholder",
  });

export const coverageShrinkLogEntrySchema = z
  .object({
    version: z.literal("1"),
    kind: z.literal("coverage-shrink"),
    ratchetId: z.string().min(1),
    previousFiles: nonEmptyStringArray,
    currentFiles: nonEmptyStringArray,
    previousIgnores: nonEmptyStringArray,
    currentIgnores: nonEmptyStringArray,
    removedPaths: nonEmptyStringArray.min(1, {
      message: "coverage-shrink must record at least one removed path",
    }),
    reason: realReason,
  })
  .strict();

// Hand-written rather than `z.infer` so the persisted shape keeps its `readonly`
// arrays: the writer's `buildLintRatchetCoverageShrinkLogEntry` copies
// `readonly string[]` fields straight off the update decision into this type.
export interface LintRatchetCoverageShrinkLogEntry {
  readonly version: "1";
  readonly kind: "coverage-shrink";
  readonly ratchetId: string;
  readonly previousFiles: readonly string[];
  readonly currentFiles: readonly string[];
  readonly previousIgnores: readonly string[];
  readonly currentIgnores: readonly string[];
  readonly removedPaths: readonly string[];
  readonly reason: string;
}
