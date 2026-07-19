import type {
  LintRatchetOrphanRemoval,
  LintRatchetRegression,
  LintRatchetRetirementOptionsAttestation,
} from "@musi/lint-ratchet/kernel/baseline.js";
import { isJsonValue } from "@musi/lint-ratchet/kernel/baseline-hash.js";
import { isNormalizedLintRatchetPath } from "@musi/lint-ratchet/kernel/baseline-item-parse.js";
import type { JsonValue } from "@musi/lint-ratchet/kernel/config-types.js";
import { validateMetricItem } from "@musi/lint-ratchet/kernel/metric-strategies.js";
import type { LintRatchetMetricItem } from "@musi/lint-ratchet/kernel/metrics-types.js";
import { isRatchetRegressionReasonPlaceholder } from "@musi/lint-ratchet/kernel/recovery-command.js";
import { z } from "zod";

// Zod schemas for one committed debt-log line. The repo's Zod-first policy holds
// here just as it does for the shared harness-diagnostics envelope this engine
// already emits (leaf 08 validation ruling, 2026-07-17). The persisted interfaces
// stay hand-written and reuse the comparator's LintRatchetRegression /
// LintRatchetOrphanRemoval / LintRatchetRetirementOptionsAttestation, so a future
// shape change is a TypeScript compile error here and in the writer/renderer; the
// Zod schemas validate against exactly those shapes.

export interface LintRatchetAcceptedDebtLogEntry {
  readonly version: "1";
  readonly acceptanceReason: string;
  readonly regressions: readonly LintRatchetRegression[];
  readonly orphansRemoved: readonly LintRatchetOrphanRemoval[];
}

export interface LintRatchetRetirementLogEntry {
  readonly version: "1";
  readonly kind: "retirement";
  readonly ratchetId: string;
  readonly promotionProof: "normal-lint-error";
  readonly optionsAttestation?: LintRatchetRetirementOptionsAttestation;
}

export interface LintRatchetMetricMigrationLogEntry {
  readonly version: "1";
  readonly kind: "metric-migration";
  readonly ratchetId: string;
  readonly fromMetric: "message-count" | "effective-line-count" | "complexity-severity";
  readonly toMetric: "message-count" | "effective-line-count" | "complexity-severity";
  readonly reason: string;
}

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

export type LintRatchetDebtLogEntry =
  | LintRatchetAcceptedDebtLogEntry
  | LintRatchetRetirementLogEntry
  | LintRatchetMetricMigrationLogEntry
  | LintRatchetCoverageShrinkLogEntry;

export function isAcceptedDebtLogEntry(
  entry: LintRatchetDebtLogEntry,
): entry is LintRatchetAcceptedDebtLogEntry {
  return "acceptanceReason" in entry;
}

export function isRetirementLogEntry(
  entry: LintRatchetDebtLogEntry,
): entry is LintRatchetRetirementLogEntry {
  return "kind" in entry && entry.kind === "retirement";
}

export function isMetricMigrationLogEntry(
  entry: LintRatchetDebtLogEntry,
): entry is LintRatchetMetricMigrationLogEntry {
  return "kind" in entry && entry.kind === "metric-migration";
}

export function isCoverageShrinkLogEntry(
  entry: LintRatchetDebtLogEntry,
): entry is LintRatchetCoverageShrinkLogEntry {
  return "kind" in entry && entry.kind === "coverage-shrink";
}

export interface ParsedLintRatchetDebtLogEntry {
  readonly entry?: LintRatchetDebtLogEntry;
  readonly failures: string[];
}

const metricEnum = z.enum(["message-count", "effective-line-count", "complexity-severity"]);

// parseNonEmptyString semantics: rejects whitespace-only strings too.
const nonBlankString = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "must be a non-empty string" });

const jsonValue = z.custom<JsonValue>((value) => isJsonValue(value), {
  message: "must be a JSON value",
});

// `.int()` accepts only safe integers, a deliberate tightening over the old
// Number.isInteger check: ratchet counts/lines/complexity are always small, so
// rejecting values past MAX_SAFE_INTEGER is strictly safer here.
const nonNegativeInt = z.number().int().nonnegative();

const normalizedPath = z
  .string()
  .min(1)
  .refine((value) => isNormalizedLintRatchetPath(value), { message: "path must be normalized" });

// Zod schema for one accepted-regression row in a committed debt-log entry.
// Unknown keys are rejected (`.strict()`) so a stray field such as `firstMessage`
// — carried on the in-memory comparator type but never persisted — cannot slip
// into the log. The shape-by-reason rules below mirror the comparator's
// producing functions in baseline-compare.ts.

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

const debtLogRegressionSchema = z
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

// Zod schema for one orphan-removal snapshot in a committed debt-log entry: the
// committed baseline paths dropped when a renamed/removed ratchet id is accepted.
// The item *shape* (fields, types, strict keys) is validated declaratively here;
// the metric-specific rules (which fields a given metric requires or forbids, and
// the perFunction/count invariants) are owned by the metric strategies, so this
// schema delegates that cross-field check to `validateMetricItem` rather than
// forking it.

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

const orphanMetricSchema = z.enum(["complexity-severity", "effective-line-count", "message-count"]);

function isMetric(value: string): value is z.infer<typeof orphanMetricSchema> {
  return orphanMetricSchema.safeParse(value).success;
}

const debtLogOrphanRemovalSchema = z
  .object({
    testId: z.string().min(1),
    ruleId: z.string().min(1),
    metric: orphanMetricSchema,
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

const coverageShrinkLogEntrySchema = z
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

const optionsAttestationSchema = z
  .object({
    reason: nonBlankString,
    ratchetOptions: z.array(jsonValue),
    normalLintOptions: z.array(z.array(jsonValue)),
  })
  .strict();

const acceptanceReasonSchema = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: "acceptanceReason must be a non-empty string",
  })
  .refine((value) => !isRatchetRegressionReasonPlaceholder(value), {
    message: "acceptanceReason must be a real reason, not the placeholder",
  });

const acceptedEntrySchema = z
  .object({
    version: z.literal("1"),
    acceptanceReason: acceptanceReasonSchema,
    regressions: z.array(debtLogRegressionSchema),
    orphansRemoved: z.array(debtLogOrphanRemovalSchema),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.regressions.length === 0 && entry.orphansRemoved.length === 0) {
      ctx.addIssue({ code: "custom", path: [], message: "entry must contain accepted debt" });
    }
  });

const retirementEntrySchema = z
  .object({
    version: z.literal("1"),
    kind: z.literal("retirement"),
    ratchetId: nonBlankString,
    promotionProof: z.literal("normal-lint-error"),
    optionsAttestation: optionsAttestationSchema.optional(),
  })
  .strict();

const metricMigrationEntrySchema = z
  .object({
    version: z.literal("1"),
    kind: z.literal("metric-migration"),
    ratchetId: nonBlankString,
    fromMetric: metricEnum,
    toMetric: metricEnum,
    reason: nonBlankString,
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.fromMetric === entry.toMetric) {
      ctx.addIssue({
        code: "custom",
        path: ["toMetric"],
        message: "metric-migration fromMetric and toMetric must differ",
      });
    }
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issuesToFailures(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join(".");
    if (issue.code === "unrecognized_keys") {
      const keys = issue.keys.join(", ");
      return path.length > 0 ? `${path}: unknown key(s): ${keys}` : `unknown key(s): ${keys}`;
    }
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

type SafeParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: z.ZodError };

function toParsed<T extends LintRatchetDebtLogEntry>(
  result: SafeParseResult<T>,
): ParsedLintRatchetDebtLogEntry {
  return result.success
    ? { entry: result.data, failures: [] }
    : { failures: issuesToFailures(result.error) };
}

export function parseLintRatchetDebtLogEntry(value: unknown): ParsedLintRatchetDebtLogEntry {
  if (!isRecord(value)) return { failures: ["debt-log entry must be an object"] };
  switch (value.kind) {
    case "retirement":
      return toParsed(retirementEntrySchema.safeParse(value));
    case "metric-migration":
      return toParsed(metricMigrationEntrySchema.safeParse(value));
    case "coverage-shrink":
      return toParsed(coverageShrinkLogEntrySchema.safeParse(value));
    default:
      return toParsed(acceptedEntrySchema.safeParse(value));
  }
}
