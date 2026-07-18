import type { LintRatchetRegression } from "@musi/lint-ratchet/kernel/baseline.js";
import { isNormalizedLintRatchetPath } from "@musi/lint-ratchet/kernel/baseline-item-parse.js";
import { z } from "zod";

// Zod schema for one accepted-regression row in a committed debt-log entry.
// Unknown keys are rejected (`.strict()`) so a stray field such as `firstMessage`
// — carried on the in-memory comparator type but never persisted — cannot slip
// into the log. The shape-by-reason rules below mirror the comparator's
// producing functions in baseline-compare.ts.

// `.int()` accepts only safe integers, a deliberate tightening over the old
// Number.isInteger check: ratchet counts/lines/complexity are always small, so
// rejecting values past MAX_SAFE_INTEGER is strictly safer here.
const nonNegativeInt = z.number().int().nonnegative();

const normalizedPath = z
  .string()
  .min(1)
  .refine((value) => isNormalizedLintRatchetPath(value), { message: "path must be normalized" });

// Severity-delta fields are the optional payload the comparator attaches to a
// regression to explain *how* a path got worse. `line` is deliberately excluded:
// it is a pure location hint the comparator may add to any reason, so it is
// never required or forbidden by the shape rules.
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
  // Optional fields of which at most one may be present (new-path carries either
  // a current line count or a current complexity, never both).
  readonly atMostOne?: readonly SeverityDeltaField[];
}

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

type ParsedRegressionSeverity = Partial<Record<SeverityDeltaField, number>>;

function validateRegressionShape(
  reason: LintRatchetRegression["reason"],
  severity: ParsedRegressionSeverity,
  ctx: z.RefinementCtx,
): void {
  const rule = REGRESSION_SHAPE_RULES[reason];
  const allowedFields = new Set<SeverityDeltaField>([...rule.required, ...rule.allowed]);
  for (const field of rule.required) {
    if (severity[field] === undefined) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is required for reason "${reason}"`,
      });
    }
  }
  for (const field of SEVERITY_DELTA_FIELDS) {
    if (!allowedFields.has(field) && severity[field] !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `${field} is not allowed for reason "${reason}"`,
      });
    }
  }
  if (rule.atMostOne !== undefined) {
    const present = rule.atMostOne.filter((field) => severity[field] !== undefined);
    if (present.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: `reason "${reason}" must not carry both ${rule.atMostOne.join(" and ")}`,
      });
    }
  }
}

export const debtLogRegressionSchema = z
  .object({
    testId: z.string().min(1),
    ruleId: z.string().min(1),
    path: normalizedPath,
    baselineCount: nonNegativeInt,
    currentCount: nonNegativeInt,
    baselineLines: nonNegativeInt.optional(),
    currentLines: nonNegativeInt.optional(),
    baselineComplexity: nonNegativeInt.optional(),
    currentComplexity: nonNegativeInt.optional(),
    line: nonNegativeInt.optional(),
    reason: z.enum(["new-path", "increased-count", "increased-lines", "increased-complexity"]),
  })
  .strict()
  .superRefine((regression, ctx) => {
    // `reason` is a valid enum value here (an invalid one produced its own issue
    // and the shape rules would have no entry for it), so the lookup is total.
    if (!(regression.reason in REGRESSION_SHAPE_RULES)) return;
    validateRegressionShape(regression.reason, regression, ctx);
  });
