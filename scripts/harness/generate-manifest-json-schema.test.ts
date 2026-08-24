import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type AnySchemaObject } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MANIFEST_JSON_SCHEMA_OUTPUT_PATH,
  renderManifestJsonSchema,
} from "./generate-manifest-json-schema.js";
import {
  HARNESS_LINT_RULE_CONTROLS_FILENAME,
  HARNESS_MANIFEST_FILENAME,
  readHarnessManifest,
} from "./harness-manifest.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function publishedSchema(): AnySchemaObject {
  return JSON.parse(
    readFileSync(join(repoRoot, MANIFEST_JSON_SCHEMA_OUTPUT_PATH), "utf8"),
  ) as AnySchemaObject;
}

/**
 * The round trip this whole file exists for: a manifest the in-repo Zod parser
 * accepts must also validate against the emitted schema under a *generic* JSON
 * Schema validator, and one it rejects must be rejected there too. Any
 * z.toJSONSchema fidelity gap otherwise ships silently and external consumers
 * hit it first.
 */
let validateAgainstPublishedSchema: (value: unknown) => boolean;

beforeAll(() => {
  validateAgainstPublishedSchema = new Ajv2020({ allErrors: true }).compile(publishedSchema());
});

const CONTROL = {
  id: "sensor/example",
  kind: "sensor",
  category: "maintainability",
  principle: "Example principle text.",
  pairedGuide: "none",
  repairKind: "manual",
  source: "scripts/example.sh",
  invocation: "bun run example",
};

function manifestOf(...controls: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { scriptParityExemptions: [], ciGateControlIds: [], controls };
}

describe("published manifest JSON Schema", () => {
  it("is what the emitter renders right now", () => {
    // Redundant with the generator's own --check gate on purpose: this is the
    // fast signal a contributor editing the Zod contract sees from the test
    // suite, before harness:check re-runs the generator.
    const committed = readFileSync(join(repoRoot, MANIFEST_JSON_SCHEMA_OUTPUT_PATH), "utf8");
    expect(committed).toBe(renderManifestJsonSchema());
  });

  it("serializes every object key in codepoint order", () => {
    // Determinism is what keeps the freshness gate from flapping when Zod
    // reshuffles its internal traversal order with no contract change.
    const unsortedPaths: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        for (const [index, entry] of value.entries()) walk(entry, `${path}[${String(index)}]`);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      const keys = Object.keys(value);
      const sorted = [...keys].sort();
      if (keys.some((key, index) => key !== sorted[index])) unsortedPaths.push(path);
      for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
    };
    walk(publishedSchema(), "(root)");
    expect(unsortedPaths).toEqual([]);
  });

  it("validates the assembled checked-in manifest", () => {
    // The assembled value, not the authored root: harness.controls.json owns
    // every kind except lint-rule, and the generated include owns those. The
    // published schema has to accept the union readers actually see.
    const assembled = readHarnessManifest(repoRoot);
    expect(safeParseHarnessManifest(assembled).failures).toBeUndefined();
    expect(validateAgainstPublishedSchema(assembled)).toBe(true);
  });

  it("accepts the authored root standalone, but not the controls-only include", () => {
    // The root description tells external readers which of the two assembly
    // inputs they can point a validator at. harness.controls.json is a whole
    // instance; the generated include is a `controls` fragment with no root
    // arrays, so it is not one — say that rather than implying both work.
    const readRoot = (name: string): unknown =>
      JSON.parse(readFileSync(join(repoRoot, name), "utf8"));
    expect(validateAgainstPublishedSchema(readRoot(HARNESS_MANIFEST_FILENAME))).toBe(true);
    expect(validateAgainstPublishedSchema(readRoot(HARNESS_LINT_RULE_CONTROLS_FILENAME))).toBe(
      false,
    );
  });

  it("accepts a lint-rule control that only the generated include carries", () => {
    expect(
      validateAgainstPublishedSchema(
        manifestOf({
          id: "lint/local/example",
          kind: "lint-rule",
          ruleName: "local/example",
          source: "eslint-rules/example.js",
          invocation: "bun run lint",
        }),
      ),
    ).toBe(true);
  });

  it("rejects everything the Zod contract rejects at the shape level", () => {
    const rejected: readonly (readonly [string, Record<string, unknown>])[] = [
      ["unknown root key", { ...manifestOf(CONTROL), extraTopLevel: true }],
      ["missing root array", { controls: [CONTROL] }],
      ["no controls", manifestOf()],
      ["blank invocation", manifestOf({ ...CONTROL, invocation: "   " })],
      ["unknown per-kind field", manifestOf({ ...CONTROL, generatedSurface: {} })],
      ["unknown kind", manifestOf({ ...CONTROL, kind: "invented" })],
      ["category outside the vocabulary", manifestOf({ ...CONTROL, category: "nonsense" })],
      ["lint-rule restating doc fields", manifestOf({ ...CONTROL, kind: "lint-rule" })],
      ["ratchet restating the projected principle", manifestOf({ ...CONTROL, kind: "ratchet" })],
      ["skill without its wiring facet", manifestOf({ ...CONTROL, kind: "skill" })],
      ["empty slots array", manifestOf({ ...CONTROL, kind: "verify-wrapper", slots: [] })],
    ];
    for (const [label, value] of rejected) {
      expect(safeParseHarnessManifest(value).failures, label).toBeDefined();
      expect(validateAgainstPublishedSchema(value), label).toBe(false);
    }
  });

  it("accepts what the root description declares repo-side, so the boundary is honest", () => {
    // Duplicate ids are a parser-owned superRefine, invisible to JSON Schema.
    // The published schema therefore accepts this document and the repo-side
    // parser still rejects it — exactly what the root description says.
    const duplicates = manifestOf(CONTROL, CONTROL);
    expect(safeParseHarnessManifest(duplicates).failures?.join("\n")).toContain(
      "duplicate control id",
    );
    expect(validateAgainstPublishedSchema(duplicates)).toBe(true);
  });
});
