import { z } from "zod";

import { isNormalizedLintRatchetPath } from "./baseline-item-parse.js";
import { type LintRatchetMetricItem, validateMetricItem } from "./metrics.js";

// Zod schema for one orphan-removal snapshot in a committed debt-log entry: the
// committed baseline paths dropped when a renamed/removed ratchet id is accepted.
// The item *shape* (fields, types, strict keys) is validated declaratively here;
// the metric-specific rules (which fields a given metric requires or forbids, and
// the perFunction/count invariants) are owned by the metric strategies, so this
// schema delegates that cross-field check to `validateMetricItem` rather than
// forking it.

// `.int()` accepts only safe integers, a deliberate tightening over the old
// Number.isInteger check: ratchet counts/lines/complexity are always small, so
// rejecting values past MAX_SAFE_INTEGER is strictly safer here.
const nonNegativeInt = z.number().int().nonnegative();

const normalizedPath = z
  .string()
  .min(1)
  .refine((value) => isNormalizedLintRatchetPath(value), { message: "path must be normalized" });

const SHA256_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const orphanBaselineItemSchema = z
  .object({
    path: normalizedPath,
    count: nonNegativeInt,
    lines: nonNegativeInt.optional(),
    maxComplexity: nonNegativeInt.optional(),
    perFunction: z
      .array(
        z
          .object({
            line: nonNegativeInt,
            label: z.string().min(1),
            complexity: nonNegativeInt,
          })
          .strict(),
      )
      .optional(),
    messagesFingerprint: z
      .string()
      .regex(SHA256_HASH_PATTERN, { message: "messagesFingerprint must be a sha256 hash" })
      .optional(),
  })
  .strict();

const metricSchema = z.enum(["complexity-severity", "effective-line-count", "message-count"]);

function isMetric(value: string): value is z.infer<typeof metricSchema> {
  return metricSchema.safeParse(value).success;
}

export const debtLogOrphanRemovalSchema = z
  .object({
    testId: z.string().min(1),
    ruleId: z.string().min(1),
    metric: metricSchema,
    baselineItems: z.array(orphanBaselineItemSchema),
  })
  .strict()
  .superRefine((removal, ctx) => {
    // A bad metric produced its own issue; item validation is metric-specific, so
    // skip it entirely rather than dispatch on an unknown strategy (matches the
    // hand-rolled parser, which never parsed items when the metric was unknown).
    if (!isMetric(removal.metric)) return;
    removal.baselineItems.forEach((item, index) => {
      const failures: string[] = [];
      // `item` carries an extra `path`; validateMetricItem reads only the metric
      // fields, so the surplus key is inert.
      const metricItem: LintRatchetMetricItem = item;
      validateMetricItem(`baselineItems[${String(index)}]`, removal.metric, metricItem, failures);
      for (const failure of failures) {
        ctx.addIssue({ code: "custom", path: ["baselineItems", index], message: failure });
      }
    });
  });
