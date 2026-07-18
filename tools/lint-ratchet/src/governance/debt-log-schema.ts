import type {
  LintRatchetOrphanRemoval,
  LintRatchetRegression,
  LintRatchetRetirementOptionsAttestation,
} from "@musi/lint-ratchet/kernel/baseline.js";
import { isJsonValue } from "@musi/lint-ratchet/kernel/baseline-hash.js";
import type { JsonValue } from "@musi/lint-ratchet/kernel/config-types.js";
import { isRatchetRegressionReasonPlaceholder } from "@musi/lint-ratchet/kernel/recovery-command.js";
import { z } from "zod";

import {
  coverageShrinkLogEntrySchema,
  type LintRatchetCoverageShrinkLogEntry,
} from "./debt-log-coverage-shrink-schema.js";
import { debtLogOrphanRemovalSchema } from "./debt-log-orphan-schema.js";
import { debtLogRegressionSchema } from "./debt-log-regression-schema.js";

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

export type { LintRatchetCoverageShrinkLogEntry } from "./debt-log-coverage-shrink-schema.js";

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
