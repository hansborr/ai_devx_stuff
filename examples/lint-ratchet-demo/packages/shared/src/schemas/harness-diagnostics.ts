import { z } from "zod";

export const HARNESS_DIAGNOSTICS_SCHEMA_VERSION = "1" as const;

// The envelope's tool id is a permissive transport value: any non-empty string.
// The closed set of tool ids a given harness recognizes is a repo-side concern
// (Musi enforces its own inventory in scripts/harness-emit-envelope.ts),
// deliberately kept out of this shared schema so an adopter can name their own
// tools without editing a file the adoption guide tells them to copy verbatim.
export const harnessDiagnosticToolSchema = z.string().min(1);

export type HarnessDiagnosticTool = z.infer<typeof harnessDiagnosticToolSchema>;

export const harnessFindingSeveritySchema = z.enum(["block", "warn", "info"]);

export type HarnessFindingSeverity = z.infer<typeof harnessFindingSeveritySchema>;

export const harnessFindingRepairKindSchema = z.enum([
  "autofix",
  "suggestion",
  "codemod",
  "manual",
]);

export type HarnessFindingRepairKind = z.infer<typeof harnessFindingRepairKindSchema>;

const harnessFindingKindSchema = z.enum(["regression", "improvement", "info"]);

const controlIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)+$/u, {
    message:
      "control must be a namespaced lowercase id like 'sensor/blob-size' or 'lint/local/<rule-name>'",
  });

export const harnessFindingSchema = z
  .object({
    control: controlIdSchema,
    severity: harnessFindingSeveritySchema,
    path: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    ruleId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    kind: harnessFindingKindSchema.optional(),
    reason: z.string().min(1).optional(),
    baselineCount: z.number().int().nonnegative().optional(),
    currentCount: z.number().int().nonnegative().optional(),
    baselineLines: z.number().int().nonnegative().optional(),
    currentLines: z.number().int().nonnegative().optional(),
    baselineComplexity: z.number().int().nonnegative().optional(),
    currentComplexity: z.number().int().nonnegative().optional(),
    why: z.string().min(1),
    howToFix: z.string().min(1),
    repairKind: harnessFindingRepairKindSchema,
    repairCommand: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((finding, ctx) => {
    if (finding.repairKind === "codemod" && finding.repairCommand === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["repairCommand"],
        message: "repairKind 'codemod' requires repairCommand",
      });
    }

    if (finding.repairKind !== "codemod" && finding.repairCommand !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["repairCommand"],
        message: "repairCommand is only allowed when repairKind is 'codemod'",
      });
    }

    if (finding.line !== undefined && finding.path === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["line"],
        message: "line requires path",
      });
    }
  });

export type HarnessFinding = z.infer<typeof harnessFindingSchema>;

export const harnessDiagnosticNoteSchema = z
  .object({
    kind: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*$/u, {
        message: "kind must be a lowercase note id such as 'recovery-command'",
      }),
    message: z.string().min(1),
    command: z.string().min(1).optional(),
  })
  .strict();

export type HarnessDiagnosticNote = z.infer<typeof harnessDiagnosticNoteSchema>;

export const harnessDiagnosticsSummarySchema = z
  .object({
    blocking: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
    byControl: z.record(controlIdSchema, z.number().int().nonnegative()),
  })
  .strict();

export type HarnessDiagnosticsSummary = z.infer<typeof harnessDiagnosticsSummarySchema>;

function validateEnvelopeSummary(
  envelope: {
    findings: readonly HarnessFinding[];
    summary: HarnessDiagnosticsSummary;
  },
  ctx: z.RefinementCtx,
): void {
  const expected = summarizeHarnessFindings(envelope.findings);

  if (
    envelope.summary.blocking !== expected.blocking ||
    envelope.summary.warning !== expected.warning ||
    envelope.summary.info !== expected.info
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["summary"],
      message:
        `summary counts disagree with findings: ` +
        `expected blocking=${String(expected.blocking)} ` +
        `warning=${String(expected.warning)} info=${String(expected.info)}`,
    });
  }

  for (const [control, count] of Object.entries(expected.byControl)) {
    if (envelope.summary.byControl[control] !== count) {
      ctx.addIssue({
        code: "custom",
        path: ["summary", "byControl", control],
        message: `summary.byControl["${control}"] expected ${String(count)}, got ${String(envelope.summary.byControl[control])}`,
      });
    }
  }

  for (const control of Object.keys(envelope.summary.byControl)) {
    if (!(control in expected.byControl)) {
      ctx.addIssue({
        code: "custom",
        path: ["summary", "byControl", control],
        message: `summary.byControl["${control}"] has no matching finding`,
      });
    }
  }
}

export const harnessDiagnosticsSchema = z
  .object({
    version: z.literal(HARNESS_DIAGNOSTICS_SCHEMA_VERSION),
    tool: harnessDiagnosticToolSchema,
    findings: z.array(harnessFindingSchema),
    notes: z.array(harnessDiagnosticNoteSchema).optional(),
    summary: harnessDiagnosticsSummarySchema,
  })
  .strict()
  .superRefine(validateEnvelopeSummary);

export type HarnessDiagnostics = z.infer<typeof harnessDiagnosticsSchema>;

export function compareHarnessFindings(left: HarnessFinding, right: HarnessFinding): number {
  const controlCompare = left.control.localeCompare(right.control);
  if (controlCompare !== 0) return controlCompare;
  const pathCompare = (left.path ?? "").localeCompare(right.path ?? "");
  if (pathCompare !== 0) return pathCompare;
  const lineCompare = (left.line ?? 0) - (right.line ?? 0);
  if (lineCompare !== 0) return lineCompare;
  return left.why.localeCompare(right.why);
}

export function buildHarnessDiagnostics(
  tool: HarnessDiagnosticTool,
  findings: readonly HarnessFinding[],
  options: { readonly notes?: readonly HarnessDiagnosticNote[] } = {},
): HarnessDiagnostics {
  const orderedFindings = [...findings].sort(compareHarnessFindings);
  return {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool,
    findings: orderedFindings,
    ...(options.notes === undefined ? {} : { notes: [...options.notes] }),
    summary: summarizeHarnessFindings(orderedFindings),
  };
}

export function summarizeHarnessFindings(
  findings: readonly HarnessFinding[],
): HarnessDiagnosticsSummary {
  const summary: HarnessDiagnosticsSummary = {
    blocking: 0,
    warning: 0,
    info: 0,
    byControl: {},
  };

  for (const finding of findings) {
    if (finding.severity === "block") summary.blocking += 1;
    else if (finding.severity === "warn") summary.warning += 1;
    else summary.info += 1;

    summary.byControl[finding.control] = (summary.byControl[finding.control] ?? 0) + 1;
  }

  return summary;
}
