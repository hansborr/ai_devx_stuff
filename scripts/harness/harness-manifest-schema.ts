// Typed contract for harness.controls.json, layered ABOVE the dependency-free
// leaf reader (harness-manifest.ts must stay free of non-builtin imports so
// the portable lint-ratchet copy set can ship it; this module is the repo-side
// seam and is deliberately NOT part of that copy set). Pure by design: no
// path or IO concerns live here — callers compose `readHarnessManifest`
// (leaf) with `safeParseHarnessManifest` / `parseHarnessManifest` (this
// module).
//
// Division of labor (2026-07-19 design ruling): this parser owns JSON shape —
// top-level fields, the per-kind control field inventories (strict keys, so
// an unknown field is a registration typo), primitive field typing, and
// control-id uniqueness. Deep facet parsing and semantic/live-tree validation
// stay with their owning consumers and keep their test-pinned diagnostics:
// `generatedSurface` (generated-surfaces.ts), `hookWiring`
// (hook-wiring-schema.ts), `skillWiring` (skill-inventory-schema.ts), `slots`
// (verify-step-schema.ts), and everything in harness-check that compares the
// manifest against the actual tree.

import { z } from "zod";

import { CONTROL_CATEGORIES, REPAIR_KINDS } from "./control-field-validation.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";

const nonBlankString = z
  .string()
  .refine((value) => value.trim().length > 0, { message: "must be a non-empty string" });

// Facet carriers: presence and object-ness are contract here; the deep shape
// is owned by the modules named in the header so their per-record aggregated
// diagnostics stay authoritative (and test-pinned).
const facetObject = z.looseObject({});
const slotsCarrier = z.array(facetObject).min(1);

const baseFields = {
  id: nonBlankString,
  source: nonBlankString,
  invocation: nonBlankString,
};

// Non-lint controls carry the doc vocabulary; `principle` is present on all of
// them EXCEPT ratchets, whose principle is re-projected from the lint-ratchet
// registry (a hand-written value is rejected by the consumers' restatement
// rule, so the schema must not accept one either).
const categorizedFields = {
  ...baseFields,
  category: z.enum(CONTROL_CATEGORIES),
  pairedGuide: nonBlankString,
  repairKind: z.enum(REPAIR_KINDS),
  // Presence semantics (required iff repairKind is codemod) are consumer-owned
  // (validateRepairCommandPresence); the schema types the field when present.
  repairCommand: nonBlankString.optional(),
};

const principledFields = {
  ...categorizedFields,
  principle: nonBlankString,
};

const lintRuleControlSchema = z.strictObject({
  ...baseFields,
  kind: z.literal("lint-rule"),
  ruleName: nonBlankString,
});

const ratchetControlSchema = z.strictObject({
  ...categorizedFields,
  kind: z.literal("ratchet"),
});

const harnessControlSchema = z.discriminatedUnion("kind", [
  lintRuleControlSchema,
  ratchetControlSchema,
  z.strictObject({ ...principledFields, kind: z.literal("sensor") }),
  z.strictObject({ ...principledFields, kind: z.literal("doctor-check") }),
  z.strictObject({ ...principledFields, kind: z.literal("drift-scope") }),
  z.strictObject({ ...principledFields, kind: z.literal("logs-audit") }),
  z.strictObject({ ...principledFields, kind: z.literal("codemod") }),
  z.strictObject({
    ...principledFields,
    kind: z.literal("verify-wrapper"),
    slots: slotsCarrier.optional(),
  }),
  z.strictObject({
    ...principledFields,
    kind: z.literal("check"),
    generatedSurface: facetObject.optional(),
  }),
  z.strictObject({
    ...principledFields,
    kind: z.literal("doc-generator"),
    generatedSurface: facetObject.optional(),
  }),
  z.strictObject({
    ...principledFields,
    kind: z.literal("hook"),
    slots: slotsCarrier.optional(),
    // Optional: several hook controls document externally-wired or
    // intentionally-disabled hooks without a hookWiring facet; the wiring
    // generator owns which hooks require one.
    hookWiring: facetObject.optional(),
  }),
  z.strictObject({
    ...principledFields,
    kind: z.literal("skill"),
    skillWiring: facetObject,
  }),
]);

const harnessManifestSchema = z
  .strictObject({
    $comment: nonBlankString.optional(),
    scriptParityExemptions: z.array(nonBlankString),
    ciGateControlIds: z.array(nonBlankString),
    controls: z.array(harnessControlSchema).min(1),
  })
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const [index, control] of manifest.controls.entries()) {
      if (seen.has(control.id)) {
        context.addIssue({
          code: "custom",
          path: ["controls", index, "id"],
          message: `duplicate control id: ${control.id}`,
        });
      }
      seen.add(control.id);
    }
  });

export type HarnessManifest = z.infer<typeof harnessManifestSchema>;

// Parity with the shared kind vocabulary (KINDS in
// control-field-validation.ts) is pinned by the schema test's
// every-kind-parses case; adding a kind there without a schema arm fails it.

/**
 * Loose narrowing schema over the categorized (non-lint) control fields, for
 * consumers that accumulate their own granular, test-pinned field diagnostics
 * first (the harness-controls doc generator) and only need a typed view at
 * the success path — retiring the per-field casts that used to stand in for
 * this narrowing. Loose on purpose: unknown-key strictness and kind
 * discrimination belong to {@link harnessControlSchema}.
 */
export const categorizedControlFieldsSchema = z.looseObject({
  category: z.enum(CONTROL_CATEGORIES),
  principle: nonBlankString.optional(),
  pairedGuide: nonBlankString,
  repairKind: z.enum(REPAIR_KINDS),
  repairCommand: nonBlankString.optional(),
  source: nonBlankString,
  invocation: nonBlankString,
});

export type SafeParseHarnessManifestResult =
  | { readonly manifest: HarnessManifest; readonly failures?: undefined }
  | { readonly manifest?: undefined; readonly failures: readonly string[] };

function describeIssuePath(path: ReadonlyArray<PropertyKey>): string {
  return path.length === 0 ? "(root)" : path.map(String).join(".");
}

/**
 * Parse an already-read manifest value (see `readHarnessManifest` for the IO
 * half). Returns every schema failure as one flat, human-readable list so a
 * registration mistake surfaces in a single run.
 */
export function safeParseHarnessManifest(value: unknown): SafeParseHarnessManifestResult {
  const parsed = harnessManifestSchema.safeParse(value);
  if (parsed.success) return { manifest: parsed.data };
  return {
    failures: parsed.error.issues.map(
      (issue) => `${HARNESS_MANIFEST_FILENAME}: ${describeIssuePath(issue.path)}: ${issue.message}`,
    ),
  };
}

/** Throwing variant of {@link safeParseHarnessManifest} for generator-style callers. */
export function parseHarnessManifest(value: unknown): HarnessManifest {
  const result = safeParseHarnessManifest(value);
  if (result.failures !== undefined) {
    throw new Error(
      [`${HARNESS_MANIFEST_FILENAME} failed schema validation:`, ...result.failures].join("\n- "),
    );
  }
  return result.manifest;
}
