// Typed contract for harness.controls.json, layered ABOVE the dependency-free
// leaf reader. The split is a fixture-copy-closure boundary: harness-manifest.ts
// is copied verbatim into reduced fixture trees (see its header), and a Zod
// import there would land in every one of those copy closures — so the Zod
// contract lives here instead, and only trees that actually validate shape copy
// this file. Pure by design: no path or IO concerns live here. The two halves
// are joined in harness-manifest-loader.ts, which is what consumers import;
// see docs/guides/harness-manifest-parser.md.
//
// Division of labor (2026-07-19 design ruling): this parser owns JSON shape —
// top-level fields, the per-kind control field inventories (strict keys, so
// an unknown field is a registration typo), primitive field typing, and
// control-id uniqueness. Deep facet parsing and semantic/live-tree validation
// stay with their owning consumers and keep their test-pinned diagnostics:
// `generatedSurface` (generated-surfaces.ts), `hookWiring`
// (hook-wiring-schema.ts), `skillWiring` (skill-inventory-schema.ts), the root
// `commandPolicy` rule array (command-policy-schema.ts, which also owns its
// root carrier so one module holds the whole contract), the slot
// vocabulary inside `slots` (verify-step-schema.ts), and everything in
// harness-check that compares the manifest against the actual tree. Legacy
// slot non-emptiness plus manifest-local catalog/profile structure and
// resolution are the exceptions owned here; see slotsCarrier,
// verifySlotCatalogSchema, and resolveHarnessManifest. Successful parses
// resolve profiles before returning, so consumers still receive only
// materialized slot arrays.

import { z } from "zod";

import { CONTROL_CATEGORIES, REPAIR_KINDS } from "./control-field-validation.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";
import {
  resolveVerifyStepCatalog,
  resolveVerifyStepProfile,
  type VerifyStepBridgeReason,
} from "./verify-step-programs.js";
import { parseVerifyStepSlots, type VerifyStepSlot } from "./verify-step-schema.js";

/**
 * The `$schema` value harness.controls.json carries, pointing at the published
 * schema (scripts/harness/generate-manifest-json-schema.ts emits it there).
 * Editors and generic validators follow this relative to the manifest.
 *
 * Pinned to one literal rather than accepted as a free string: a pointer left
 * behind by a move or rename must fail the parse, not quietly send an external
 * validator at a path that is not there. Optional because the reduced fixture
 * manifests carry no schema file to point at.
 */
export const HARNESS_MANIFEST_SCHEMA_POINTER = "./schemas/harness.controls.schema.json";

/**
 * Root `description` of the published JSON Schema. It is the whole orientation
 * an external reader gets, so it states the strictness boundary explicitly:
 * what the published schema is authoritative for, what it deliberately leaves
 * open, and which rules exist only repo-side because JSON Schema cannot carry
 * them. Keep it in sync with the division-of-labor ruling in the header.
 */
const MANIFEST_ROOT_DESCRIPTION = [
  "Musi harness control manifest (harness.controls.json): the registration inventory of every enforcement control in the harness.",
  "GENERATED from the Zod parser in scripts/harness/harness-manifest-schema.ts by `bun run harness:manifest-schema`; do not edit by hand.",
  "AUTHORITATIVE HERE: the root keys, the per-kind field inventories (unknown keys are rejected, so a stray field is a registration typo), primitive field typing, the non-emptiness of `slots` and of the root `commandPolicy` rule array (whose array order is agent-command policy scan order: first hard match wins, otherwise the first soft match advises), and the structure of the ordered `verifySlotCatalog` plus per-control `slotProfile` declarations.",
  "DELIBERATELY OPEN: the interiors of the `generatedSurface`, `hookWiring` and `skillWiring` facets, the entries of the root `commandPolicy` rule array, and the command vocabulary inside materialized slots or catalog/profile slot bodies, which stay with their owning repo-side validators (generated-surfaces.ts, hook-wiring-schema.ts, skill-inventory-schema.ts, command-policy-schema.ts, verify-step-schema.ts) so their aggregated diagnostics remain authoritative.",
  "REPO-SIDE ONLY, not expressible here: control-id uniqueness, `repairCommand` being required exactly when `repairKind` is `codemod`, the slot vocabulary, catalog/profile resolution semantics (unique names, valid override targets, non-empty selected programs, and mandatory production modes), marker-bridge divergence filtering, and every check that compares the manifest against the actual tree (`bun run harness:check`). A document this schema accepts can still fail those.",
  "ASSEMBLY: readers see one manifest assembled from two files — harness.controls.json owns every kind except `lint-rule`, and the generated include harness.controls.lint-rules.generated.json owns those. This schema describes the assembled document. harness.controls.json alone is also a valid instance; the include is a `controls`-only fragment carrying no root arrays, so it is not one.",
].join(" ");

// Stated as a regex, not a `.refine`, so it survives JSON Schema emission: a
// refinement is invisible to z.toJSONSchema and the published schema would
// silently accept `"invocation": ""`. `/\S/` and `value.trim().length > 0`
// agree on every input (JS `trim` and `\s` share the same whitespace set), and
// the message is restated so parse diagnostics are unchanged.
const nonBlankString = z.string().regex(/\S/u, { message: "must be a non-empty string" });

// Facet carriers: presence and object-ness are contract here; the deep shape
// is owned by the modules named in the header so their per-record aggregated
// diagnostics stay authoritative (and test-pinned).
//
// The `.meta({ description })` calls from here down are not decoration: they are
// the only way the load-bearing comments in this module reach the published
// JSON Schema (scripts/harness/generate-manifest-json-schema.ts), which is all
// an external reader of harness.controls.json gets.
const facetObject = z.looseObject({}).meta({
  description:
    "Facet carrier. Presence and object-ness are contract here; the interior is deliberately unconstrained and validated repo-side by the facet's owning module (see the root description).",
});
// Array-ness, per-entry object-ness, and NON-EMPTINESS for legacy materialized
// arrays. The slot vocabulary (names, scripts, args, dynamic resolvers) stays
// with verify-step-schema.ts, but emptiness cannot: an empty program makes the
// marker-bridge subset check vacuous and verify-engine.sh records SUCCESS after
// iterating no checks. Profile-backed controls do not traverse this carrier;
// resolveVerifyStepProfile applies their equivalent non-empty-program guard.
const slotsCarrier = z.array(facetObject).min(1).meta({
  description:
    "Legacy materialized verify/hook slots. Array-ness, per-entry object-ness, and NON-EMPTINESS are contract; the slot vocabulary (names, scripts, args, dynamic resolvers) is repo-side. Profile-backed programs receive an equivalent non-emptiness check during repo-side resolution.",
});

// A slot body deliberately omits the catalog-owned name. Its command fields
// stay open here for the same reason the legacy `slots` carrier does: the
// verify-step parser owns names, scripts, args, env, dynamic ids, and
// fastCommitSkip. The resolver rejects a nested `name` restatement before
// composing the body with its catalog/override name.
const verifySlotBodyCarrier = z.looseObject({}).meta({
  description:
    "Verify slot command body without its catalog-owned name. The command vocabulary is validated repo-side by verify-step-schema.ts.",
});

const changedVerifySlotDispositionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("inherit") }),
  z.strictObject({
    kind: z.literal("replace"),
    reason: nonBlankString,
    slot: verifySlotBodyCarrier,
  }),
  z.strictObject({ kind: z.literal("omit"), reason: nonBlankString }),
]);

const verifySlotCatalogSchema = z
  .array(
    z.strictObject({
      name: nonBlankString,
      full: verifySlotBodyCarrier,
      // Required on every entry: there is intentionally no silent changed-mode
      // default when a contributor adds a slot.
      changed: changedVerifySlotDispositionSchema,
      // Artifact edges describe the slot, not one of its command forms, so they
      // sit beside `name` rather than inside a body. Presence and string-ness
      // are contract here; the artifact id vocabulary and its probe bindings
      // stay repo-side in verify-step-artifacts.ts.
      produces: nonBlankString.optional(),
      requiresArtifact: nonBlankString.optional(),
    }),
  )
  .min(1)
  .meta({
    description:
      "Ordered verify slot catalog. Every slot declares its full command body and an explicit changed disposition: inherit, a reasoned replacement, or a reasoned omission, plus any named build artifact the slot produces or requires. Array order is gate execution order.",
  });

const verifySlotProfileSchema = z
  .strictObject({
    mode: z.enum(["full", "changed"]),
    overrides: z
      .array(
        z.strictObject({
          name: nonBlankString,
          reason: nonBlankString,
          slot: verifySlotBodyCarrier,
        }),
      )
      .min(1)
      .optional(),
  })
  .meta({
    description:
      "Thin gate profile selecting the catalog's full or changed form, with optional reasoned whole-slot replacements. Membership still comes only from the catalog's changed dispositions.",
  });

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

const lintRuleControlSchema = z
  .strictObject({
    ...baseFields,
    kind: z.literal("lint-rule"),
    ruleName: nonBlankString,
  })
  .meta({
    description:
      "A local ESLint rule. Carries no doc vocabulary: category, principle, pairedGuide, repairKind and repairCommand are re-projected from the rule's own meta.docs, so restating any of them here is rejected. These controls are generated into harness.controls.lint-rules.generated.json rather than authored.",
  });

const ratchetControlSchema = z
  .strictObject({
    ...categorizedFields,
    kind: z.literal("ratchet"),
  })
  .meta({
    description:
      "A lint ratchet. Like every non-lint control except that `principle` is re-projected from the lint-ratchet registry, so a hand-written one is rejected.",
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
    slotProfile: verifySlotProfileSchema.optional(),
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
  z
    .strictObject({
      ...principledFields,
      kind: z.literal("hook"),
      slots: slotsCarrier.optional(),
      slotProfile: verifySlotProfileSchema.optional(),
      // Optional: several hook controls document externally-wired or
      // intentionally-disabled hooks without a hookWiring facet; the wiring
      // generator owns which hooks require one.
      hookWiring: facetObject.optional(),
    })
    .meta({
      description:
        "An agent-CLI hook. `hookWiring` is optional because several hook controls document externally-wired or intentionally-disabled hooks; which hooks require a facet is repo-side.",
    }),
  z.strictObject({
    ...principledFields,
    kind: z.literal("skill"),
    skillWiring: facetObject,
  }),
]);

/**
 * The root contract. Exported because it is also the source the published JSON
 * Schema is projected from (scripts/harness/generate-manifest-json-schema.ts);
 * in-repo consumers should use {@link safeParseHarnessManifest} or
 * {@link parseHarnessManifest} instead of parsing with it directly.
 */
export const harnessManifestSchema = z
  .strictObject({
    $schema: z.literal(HARNESS_MANIFEST_SCHEMA_POINTER).optional(),
    $comment: nonBlankString.optional(),
    scriptParityExemptions: z.array(nonBlankString),
    ciGateControlIds: z.array(nonBlankString),
    verifySlotCatalog: verifySlotCatalogSchema.optional(),
    // Root-level rather than a control facet: the ordered hard-deny rule set is
    // domain data with several consumers (the fragment generator, the policy
    // shell, the Claude-native deny array), not a description of how any one
    // control is wired — the same reason verifySlotCatalog sits at the root.
    // Carried like the facet objects and for the same reason: array-ness,
    // entry object-ness and non-emptiness here, the rule vocabulary in
    // command-policy-schema.ts, whose aggregated diagnostics stay
    // authoritative. Deliberately NOT imported from there: that module is
    // zod-heavy and this one is copied into several reduced fixture trees.
    // Optional like verifySlotCatalog: reduced fixtures project no policy.
    commandPolicy: z.array(facetObject).min(1).optional(),
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
  })
  .meta({
    description: MANIFEST_ROOT_DESCRIPTION,
  });

type ParsedHarnessManifest = z.infer<typeof harnessManifestSchema>;
type ParsedHarnessControl = ParsedHarnessManifest["controls"][number];
type SlotCarrierControl = Extract<ParsedHarnessControl, { readonly slotProfile?: unknown }>;
type MaterializedControl<Control> = Control extends SlotCarrierControl
  ? Omit<Control, "slotProfile" | "slots"> & { readonly slots?: readonly VerifyStepSlot[] }
  : Control;
type ResolvedHarnessControl = MaterializedControl<ParsedHarnessControl>;

type VerifyStepBridgeDivergenceReason = VerifyStepBridgeReason;

const FULL_VERIFY_CONTROL_ID = "verify-wrapper/verify";
const CHANGED_VERIFY_CONTROL_ID = "verify-wrapper/verify-changed";
const PARALLEL_VERIFY_CONTROL_ID = "verify-wrapper/verify-parallel";
const PRE_COMMIT_CONTROL_ID = "hook/pre-commit";
const MANDATED_VERIFY_PROFILE_MODES: ReadonlyMap<string, "full" | "changed"> = new Map([
  [FULL_VERIFY_CONTROL_ID, "full"],
  [CHANGED_VERIFY_CONTROL_ID, "changed"],
  [PARALLEL_VERIFY_CONTROL_ID, "full"],
  [PRE_COMMIT_CONTROL_ID, "changed"],
]);

function materializeSlotControl(
  control: SlotCarrierControl,
  slots: readonly VerifyStepSlot[] | undefined,
): ResolvedHarnessControl {
  const { slotProfile: _slotProfile, slots: _rawSlots, ...fields } = control;
  return slots === undefined ? fields : { ...fields, slots };
}

function validateMandatedProfileMode(control: SlotCarrierControl, failures: string[]): void {
  const mandatedMode = MANDATED_VERIFY_PROFILE_MODES.get(control.id);
  if (mandatedMode === undefined) return;
  if (control.slotProfile === undefined) {
    failures.push(`${control.id} must declare slotProfile with mode ${mandatedMode}`);
  } else if (control.slotProfile.mode !== mandatedMode) {
    failures.push(`${control.id} slotProfile mode must be ${mandatedMode}`);
  }
  if (mandatedMode === "full" && control.slotProfile?.overrides !== undefined) {
    failures.push(`${control.id} slotProfile must not declare overrides`);
  }
}

function resolveHarnessManifest(
  manifest: ParsedHarnessManifest,
  failures: string[],
): HarnessManifest {
  const catalog = resolveVerifyStepCatalog(manifest.verifySlotCatalog, failures);
  const bridgeReasons: VerifyStepBridgeDivergenceReason[] =
    catalog?.changedReasons.map((entry) => ({ ...entry, supersetId: FULL_VERIFY_CONTROL_ID })) ??
    [];
  const controls = manifest.controls.map((control) => {
    if (control.kind !== "verify-wrapper" && control.kind !== "hook") return control;
    validateMandatedProfileMode(control, failures);
    if (control.slotProfile === undefined) {
      const slots = parseVerifyStepSlots(control.slots, failures, `${control.id} `);
      return materializeSlotControl(control, slots);
    }
    if (control.slots !== undefined) {
      failures.push(`${control.id} must not declare both slots and slotProfile`);
    }
    if (catalog === undefined) {
      failures.push(`${control.id} slotProfile requires the root verifySlotCatalog`);
      return materializeSlotControl(control, []);
    }
    const profile = resolveVerifyStepProfile(catalog, control.slotProfile, failures, control.id);
    if (control.id === PRE_COMMIT_CONTROL_ID) {
      for (const reason of profile.overrideReasons) {
        bridgeReasons.push({ ...reason, supersetId: FULL_VERIFY_CONTROL_ID });
        bridgeReasons.push({ ...reason, supersetId: CHANGED_VERIFY_CONTROL_ID });
      }
    }
    return materializeSlotControl(control, profile.slots);
  });
  const { verifySlotCatalog: _verifySlotCatalog, ...rootFields } = manifest;
  return {
    ...rootFields,
    controls,
    verifyStepBridgeDivergenceReasons: bridgeReasons,
  };
}

export type HarnessManifest = Omit<ParsedHarnessManifest, "verifySlotCatalog" | "controls"> & {
  readonly controls: readonly ResolvedHarnessControl[];
  readonly verifyStepBridgeDivergenceReasons: readonly VerifyStepBridgeDivergenceReason[];
};

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
  if (!parsed.success) {
    return {
      failures: parsed.error.issues.map(
        (issue) =>
          `${HARNESS_MANIFEST_FILENAME}: ${describeIssuePath(issue.path)}: ${issue.message}`,
      ),
    };
  }
  const resolutionFailures: string[] = [];
  const manifest = resolveHarnessManifest(parsed.data, resolutionFailures);
  return resolutionFailures.length === 0
    ? { manifest }
    : {
        failures: resolutionFailures.map((failure) => `${HARNESS_MANIFEST_FILENAME}: ${failure}`),
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
