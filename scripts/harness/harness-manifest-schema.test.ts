import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KINDS } from "./control-field-validation.js";
import { MANIFEST_JSON_SCHEMA_OUTPUT_PATH } from "./generate-manifest-json-schema.js";
import { HARNESS_MANIFEST_FILENAME, readHarnessManifest } from "./harness-manifest.js";
import {
  HARNESS_MANIFEST_SCHEMA_POINTER,
  parseHarnessManifest,
  safeParseHarnessManifest,
} from "./harness-manifest-schema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The authored root's `$schema` value, read without going through the parser. */
function manifestPointer(manifest: unknown): unknown {
  return (manifest as { $schema?: unknown }).$schema;
}

/** The `kind` literal of each discriminated-union arm in the published schema. */
function publishedControlArms(schema: unknown): readonly string[] {
  const published = schema as {
    properties: { controls: { items: { oneOf: { properties: { kind: { const: string } } }[] } } };
  };
  return published.properties.controls.items.oneOf.map((arm) => arm.properties.kind.const);
}

function minimalControl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sensor/example",
    kind: "sensor",
    category: "maintainability",
    principle: "Example principle text.",
    pairedGuide: "none",
    repairKind: "manual",
    source: "scripts/example.sh",
    invocation: "bun run example",
    ...overrides,
  };
}

function minimalManifest(controls: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    scriptParityExemptions: [],
    ciGateControlIds: [],
    controls,
  };
}

describe("safeParseHarnessManifest (whole-manifest contract)", () => {
  it("accepts the real checked-in manifest", () => {
    const result = safeParseHarnessManifest(readHarnessManifest(repoRoot));
    expect(result.failures).toBeUndefined();
    expect(result.manifest?.controls.length).toBeGreaterThan(0);
    expect(result.manifest?.scriptParityExemptions).toBeDefined();
    expect(result.manifest?.ciGateControlIds).toBeDefined();
  });

  it("accepts a minimal manifest and exposes typed top-level fields", () => {
    const result = safeParseHarnessManifest(minimalManifest([minimalControl()]));
    expect(result.failures).toBeUndefined();
    expect(result.manifest?.controls[0]?.kind).toBe("sensor");
  });

  it("rejects a missing top-level field: the arrays are contract too", () => {
    const result = safeParseHarnessManifest({ controls: [minimalControl()] });
    expect(result.failures?.join("\n")).toContain("scriptParityExemptions");
    expect(result.failures?.join("\n")).toContain("ciGateControlIds");
  });

  it("pins the $schema pointer, and only that value", () => {
    // Pinned so a pointer left behind by a move or rename fails the parse
    // instead of silently sending an external validator at a path that is not
    // there. Optional so the reduced fixture manifests, which carry no schema
    // file, still parse.
    const pointing = safeParseHarnessManifest({
      ...minimalManifest([minimalControl()]),
      $schema: HARNESS_MANIFEST_SCHEMA_POINTER,
    });
    expect(pointing.failures).toBeUndefined();

    const stale = safeParseHarnessManifest({
      ...minimalManifest([minimalControl()]),
      $schema: "./schemas/moved.json",
    });
    expect(stale.failures?.join("\n")).toContain("$schema");

    const absent = safeParseHarnessManifest(minimalManifest([minimalControl()]));
    expect(absent.failures).toBeUndefined();
  });

  it("resolves the pinned pointer to the emitted schema, and the real manifest declares it", () => {
    // The pointer is a literal in the contract and the output path is a
    // literal in the emitter; this is what keeps the two from drifting apart.
    expect(HARNESS_MANIFEST_SCHEMA_POINTER).toBe(`./${MANIFEST_JSON_SCHEMA_OUTPUT_PATH}`);
    expect(existsSync(join(repoRoot, MANIFEST_JSON_SCHEMA_OUTPUT_PATH))).toBe(true);

    const manifest: unknown = JSON.parse(
      readFileSync(join(repoRoot, HARNESS_MANIFEST_FILENAME), "utf8"),
    );
    expect(manifestPointer(manifest)).toBe(HARNESS_MANIFEST_SCHEMA_POINTER);
  });

  it("rejects an unknown top-level key", () => {
    const result = safeParseHarnessManifest({
      ...minimalManifest([minimalControl()]),
      extraTopLevel: true,
    });
    expect(result.failures?.join("\n")).toContain("extraTopLevel");
  });

  it("rejects an unknown per-kind field as a registration typo", () => {
    const result = safeParseHarnessManifest(
      minimalManifest([minimalControl({ generatedSurface: {} })]),
    );
    expect(result.failures?.join("\n")).toContain("generatedSurface");
  });

  it("rejects a lint-rule entry restating doc fields", () => {
    // lint-rule fields are re-projected from meta.docs; the strict per-kind
    // key set rejects a restated category at the shape level.
    const result = safeParseHarnessManifest(
      minimalManifest([
        {
          id: "lint/example",
          kind: "lint-rule",
          ruleName: "local/example",
          source: "eslint-rules/example.js",
          invocation: "bun run lint",
          category: "maintainability",
        },
      ]),
    );
    expect(result.failures?.join("\n")).toContain("category");
  });

  it("rejects a ratchet entry restating the registry-projected principle", () => {
    const result = safeParseHarnessManifest(
      minimalManifest([
        minimalControl({ id: "ratchet/example", kind: "ratchet", principle: "restated" }),
      ]),
    );
    expect(result.failures?.join("\n")).toContain("principle");
  });

  it("rejects an empty slots array, because a gate with no slots silently passes", () => {
    // Permanent regression guard. Nothing downstream rejects `"slots": []`:
    // generate-verify-steps.ts renders an empty steps array, the marker-bridge
    // subset check is vacuous over zero slots, and verify-engine.sh iterates
    // zero entries and writes a SUCCESS marker. Emptiness therefore has to be
    // rejected here, at the one seam every manifest reader passes through.
    for (const kind of ["verify-wrapper", "hook"] as const) {
      const empty = safeParseHarnessManifest(
        minimalManifest([minimalControl({ id: `${kind}/x`, kind, slots: [] })]),
      );
      expect(empty.failures?.join("\n"), kind).toContain("slots");
    }

    const notAnArray = safeParseHarnessManifest(
      minimalManifest([
        minimalControl({ id: "verify-wrapper/y", kind: "verify-wrapper", slots: {} }),
      ]),
    );
    expect(notAnArray.failures?.join("\n")).toContain("slots");

    // Omitting `slots` stays legal at the shape level: which controls must
    // declare one is consumer vocabulary (generate-verify-steps.ts throws
    // `must declare a slots array` for its four named consumers).
    const omitted = safeParseHarnessManifest(
      minimalManifest([minimalControl({ id: "verify-wrapper/z", kind: "verify-wrapper" })]),
    );
    expect(omitted.failures).toBeUndefined();
  });

  it("resolves one ordered verify catalog into materialized full and changed profiles", () => {
    const result = safeParseHarnessManifest({
      ...minimalManifest([
        minimalControl({
          id: "verify-wrapper/verify",
          kind: "verify-wrapper",
          slotProfile: { mode: "full" },
        }),
        minimalControl({
          id: "verify-wrapper/verify-changed",
          kind: "verify-wrapper",
          slotProfile: { mode: "changed" },
        }),
        minimalControl({
          id: "verify-wrapper/verify-parallel",
          kind: "verify-wrapper",
          slotProfile: { mode: "full" },
        }),
        minimalControl({
          id: "hook/pre-commit",
          kind: "hook",
          slotProfile: {
            mode: "changed",
            overrides: [
              {
                name: "test",
                reason: "Pre-commit resolves its timing reporters dynamically.",
                slot: {
                  script: "test:changed",
                  args: ["--reporter=dot"],
                  dynamic: "precommit-test-timings",
                  fastCommitSkip: true,
                },
              },
              {
                name: "scripts",
                reason:
                  "Pre-commit documents staged inputs and makes this slot fast-commit skippable.",
                slot: {
                  script: "test:scripts:changed",
                  condition: "when staged inputs require script smoke",
                  dynamic: "staged-script-classifier",
                  fastCommitSkip: true,
                },
              },
            ],
          },
        }),
      ]),
      verifySlotCatalog: [
        {
          name: "lint",
          full: { script: "lint" },
          changed: {
            kind: "replace",
            reason: "Changed gates lint only changed files.",
            slot: { script: "lint:changed" },
          },
        },
        {
          name: "guard",
          full: { script: "typecheck" },
          changed: { kind: "inherit" },
        },
        {
          name: "local-rule-starter",
          full: { script: "docs:local-eslint-rule-starter:check" },
          changed: {
            kind: "omit",
            reason: "The documentation starter is a full-tree-only guard.",
          },
        },
        {
          name: "test",
          full: { script: "test", args: ["--reporter=dot"] },
          changed: {
            kind: "replace",
            reason: "Changed gates select tests from changed inputs.",
            slot: {
              script: "test:changed",
              args: ["--reporter=dot", "--reporter=json"],
            },
          },
        },
        {
          name: "scripts",
          full: { script: "test:scripts" },
          changed: {
            kind: "replace",
            reason: "Changed gates classify script-smoke inputs.",
            slot: {
              script: "test:scripts:changed",
              condition: "when changed inputs require script smoke",
              dynamic: "staged-script-classifier",
            },
          },
        },
      ],
    });

    expect(result.failures).toBeUndefined();
    const slotsById = new Map(
      result.manifest?.controls.map((control) => [
        control.id,
        "slots" in control ? control.slots : undefined,
      ]),
    );
    expect(slotsById.get("verify-wrapper/verify")?.map((slot) => slot.name)).toEqual([
      "lint",
      "guard",
      "local-rule-starter",
      "test",
      "scripts",
    ]);
    expect(slotsById.get("verify-wrapper/verify-parallel")).toEqual(
      slotsById.get("verify-wrapper/verify"),
    );
    expect(slotsById.get("verify-wrapper/verify-changed")?.map((slot) => slot.name)).toEqual([
      "lint",
      "guard",
      "test",
      "scripts",
    ]);
    expect(slotsById.get("hook/pre-commit")?.find((slot) => slot.name === "test")).toMatchObject({
      args: ["--reporter=dot"],
      dynamic: "precommit-test-timings",
      fastCommitSkip: true,
    });
    expect(
      slotsById.get("verify-wrapper/verify-changed")?.find((slot) => slot.name === "scripts")
        ?.condition,
    ).toBe("when changed inputs require script smoke");
    expect(
      slotsById.get("hook/pre-commit")?.find((slot) => slot.name === "scripts")?.condition,
    ).toBe("when staged inputs require script smoke");
    expect(result.manifest).not.toHaveProperty("verifySlotCatalog");
    for (const control of result.manifest?.controls ?? []) {
      expect(control).not.toHaveProperty("slotProfile");
    }
    expect(result.manifest?.verifyStepBridgeDivergenceReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          supersetId: "verify-wrapper/verify",
          slot: "lint",
          reason: "Changed gates lint only changed files.",
        }),
        expect.objectContaining({
          supersetId: "verify-wrapper/verify-changed",
          slot: "test",
          reason: "Pre-commit resolves its timing reporters dynamically.",
        }),
      ]),
    );
    expect(result.manifest?.verifyStepBridgeDivergenceReasons).toContainEqual(
      expect.objectContaining({
        supersetId: "verify-wrapper/verify-changed",
        slot: "scripts",
        reason: "Pre-commit documents staged inputs and makes this slot fast-commit skippable.",
      }),
    );
  });

  it("pins the four verify consumers to their settled profile modes", () => {
    const expectedModes = [
      ["verify-wrapper/verify", "verify-wrapper", "full"],
      ["verify-wrapper/verify-changed", "verify-wrapper", "changed"],
      ["verify-wrapper/verify-parallel", "verify-wrapper", "full"],
      ["hook/pre-commit", "hook", "changed"],
    ] as const;
    const verifySlotCatalog = [
      { name: "lint", full: { script: "lint" }, changed: { kind: "inherit" } },
    ];

    for (const [id, kind, expectedMode] of expectedModes) {
      const legacy = safeParseHarnessManifest({
        ...minimalManifest([
          minimalControl({ id, kind, slots: [{ name: "lint", script: "lint" }] }),
        ]),
        verifySlotCatalog,
      });
      expect(legacy.failures?.join("\n"), id).toContain(
        `${id} must declare slotProfile with mode ${expectedMode}`,
      );

      const wrongMode = expectedMode === "full" ? "changed" : "full";
      const mismatched = safeParseHarnessManifest({
        ...minimalManifest([minimalControl({ id, kind, slotProfile: { mode: wrongMode } })]),
        verifySlotCatalog,
      });
      expect(mismatched.failures?.join("\n"), id).toContain(
        `${id} slotProfile mode must be ${expectedMode}`,
      );
    }
  });

  it("rejects overrides on the two full production profiles", () => {
    const verifySlotCatalog = [
      { name: "lint", full: { script: "lint" }, changed: { kind: "inherit" } },
    ];

    for (const id of ["verify-wrapper/verify", "verify-wrapper/verify-parallel"]) {
      const result = safeParseHarnessManifest({
        ...minimalManifest([
          minimalControl({
            id,
            kind: "verify-wrapper",
            slotProfile: {
              mode: "full",
              overrides: [
                {
                  name: "lint",
                  reason: "This would make the full production profiles diverge.",
                  slot: { script: "lint:changed" },
                },
              ],
            },
          }),
        ]),
        verifySlotCatalog,
      });

      expect(result.failures?.join("\n"), id).toContain(
        `${id} slotProfile must not declare overrides`,
      );
    }
  });

  it("rejects incomplete or ambiguous verify catalog/profile declarations", () => {
    const profileControl = minimalControl({
      id: "verify-wrapper/verify",
      kind: "verify-wrapper",
      slotProfile: { mode: "full" },
    });
    const missingDisposition = safeParseHarnessManifest({
      ...minimalManifest([profileControl]),
      verifySlotCatalog: [{ name: "lint", full: { script: "lint" } }],
    });
    expect(missingDisposition.failures?.join("\n")).toContain("verifySlotCatalog.0.changed");

    const noCatalog = safeParseHarnessManifest(minimalManifest([profileControl]));
    expect(noCatalog.failures?.join("\n")).toContain(
      "slotProfile requires the root verifySlotCatalog",
    );

    const mixed = safeParseHarnessManifest({
      ...minimalManifest([{ ...profileControl, slots: [{ name: "lint", script: "lint" }] }]),
      verifySlotCatalog: [{ name: "lint", full: { script: "lint" }, changed: { kind: "inherit" } }],
    });
    expect(mixed.failures?.join("\n")).toContain("must not declare both slots and slotProfile");
  });

  it("rejects blank and whitespace-only strings, and keeps surrounding padding legal", () => {
    // Behavior pin for nonBlankString. It is stated as a regex rather than a
    // `.refine` so it survives JSON Schema emission (a `.refine` is invisible
    // to z.toJSONSchema and would publish `invocation: ""` as valid); this case
    // fixes the behavior that restatement has to reproduce exactly.
    for (const invocation of ["", "   ", "\n\t", " "]) {
      const result = safeParseHarnessManifest(minimalManifest([minimalControl({ invocation })]));
      expect(result.failures?.join("\n"), JSON.stringify(invocation)).toContain(
        "must be a non-empty string",
      );
    }

    const padded = safeParseHarnessManifest(
      minimalManifest([minimalControl({ invocation: "  bun run example  " })]),
    );
    expect(padded.failures).toBeUndefined();
  });

  it("rejects duplicate control ids", () => {
    const result = safeParseHarnessManifest(minimalManifest([minimalControl(), minimalControl()]));
    expect(result.failures?.join("\n")).toContain("duplicate control id: sensor/example");
  });

  it("rejects a category outside the shared vocabulary", () => {
    const result = safeParseHarnessManifest(
      minimalManifest([minimalControl({ category: "nonsense" })]),
    );
    expect(result.failures?.join("\n")).toContain("category");
  });

  it("reports every failure in one pass with the manifest filename prefixed", () => {
    const result = safeParseHarnessManifest(
      minimalManifest([
        minimalControl({ category: "nonsense" }),
        minimalControl({ id: "sensor/other", invocation: "" }),
      ]),
    );
    expect(result.failures?.length).toBeGreaterThanOrEqual(2);
    for (const failure of result.failures ?? []) {
      expect(failure).toContain("harness.controls.json");
    }
  });

  it("requires skillWiring on skill entries but keeps hookWiring optional", () => {
    // Several hook controls document externally-wired or intentionally
    // disabled hooks without a wiring facet; skills always carry theirs.
    const hook = safeParseHarnessManifest(
      minimalManifest([minimalControl({ id: "hook/example", kind: "hook" })]),
    );
    expect(hook.failures).toBeUndefined();
    const skill = safeParseHarnessManifest(
      minimalManifest([minimalControl({ id: "skill/example", kind: "skill" })]),
    );
    expect(skill.failures?.join("\n")).toContain("skillWiring");
  });
});

describe("kind vocabulary parity", () => {
  it("has a schema arm accepting a minimal control of every registered kind", () => {
    // Pins the discriminated union to the shared KINDS vocabulary: adding a
    // kind to control-field-validation.ts without a schema arm fails here.
    for (const kind of KINDS) {
      const control =
        kind === "lint-rule"
          ? {
              id: "lint/example",
              kind,
              ruleName: "local/example",
              source: "eslint-rules/example.js",
              invocation: "bun run lint",
            }
          : minimalControl({
              id: `${kind}/example`,
              kind,
              // Skills always carry their wiring facet.
              ...(kind === "skill" ? { skillWiring: {} } : {}),
            });
      // Ratchet principle is registry-projected, so the manifest omits it.
      if (kind === "ratchet") delete control.principle;
      const result = safeParseHarnessManifest(minimalManifest([control]));
      expect(result.failures, kind).toBeUndefined();
    }
  });

  it("has a published-schema arm for every registered kind", () => {
    // Second half of the same pin, aimed at the external contract: adding a
    // kind arm above without re-running `bun run harness:manifest-schema`
    // leaves the published schema silently rejecting the new kind for every
    // external consumer. The committed file is what is read here, so the only
    // way to satisfy this is to regenerate and commit it.
    const published: unknown = JSON.parse(
      readFileSync(join(repoRoot, MANIFEST_JSON_SCHEMA_OUTPUT_PATH), "utf8"),
    );
    // Set comparison: the union arm order is the Zod declaration order, which
    // is deliberately not the KINDS order and carries no contract.
    expect([...publishedControlArms(published)].sort()).toEqual([...KINDS].sort());
  });
});

describe("parseHarnessManifest (throwing variant)", () => {
  it("throws one aggregated error naming the manifest", () => {
    expect(() => parseHarnessManifest({})).toThrow(/harness\.controls\.json failed schema/u);
  });

  it("returns the typed manifest on success", () => {
    const manifest = parseHarnessManifest(minimalManifest([minimalControl()]));
    expect(manifest.controls).toHaveLength(1);
  });
});
