import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { KINDS } from "./control-field-validation.js";
import { readHarnessManifest } from "./harness-manifest.js";
import { parseHarnessManifest, safeParseHarnessManifest } from "./harness-manifest-schema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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
