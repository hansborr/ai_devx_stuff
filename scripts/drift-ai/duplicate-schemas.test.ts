import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import { extractSchemaShapes, type SchemaShapeExtra } from "./duplicate-schemas.js";
import { duplicateSchemasCheck } from "./duplicate-schemas-check.js";
import { groupDuplicateShapes, type ShapeEntry } from "./duplicate-shapes.js";
import { buildSourceExtensions } from "./scope.js";

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "drift-dup-schemas-"));
  tempRoots.push(root);
  for (const [rel, source] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, source);
  }
  return root;
}

function shapesFrom(
  files: Record<string, string>,
  options: { readonly minKeys?: number } = {},
): ShapeEntry<SchemaShapeExtra>[] {
  const minKeys = options.minKeys ?? 3;
  return Object.entries(files).flatMap(([filePath, source]) =>
    extractSchemaShapes(filePath, source, { minKeys }),
  );
}

const USER_SCHEMA = `
import { z } from "zod";
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
});
`;

// Same three keys, declared in a DIFFERENT order.
const USER_SCHEMA_REORDERED = `
import { z } from "zod";
export const accountSchema = z.object({
  age: z.number(),
  id: z.string(),
  name: z.string(),
});
`;

// Lossy difference: name uses .min(1) instead of plain z.string() — should NOT group.
const USER_SCHEMA_LOSSY = `
import { z } from "zod";
export const personSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  age: z.number(),
});
`;

const TWO_KEY_SCHEMA = `
import { z } from "zod";
export const pointSchema = z.object({ x: z.number(), y: z.number() });
`;

// z.object({a,b,c}).extend({status}) — the .extend keys must fold into the key set.
const EXTENDED_SCHEMA = `
import { z } from "zod";
export const fullSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
}).extend({ status: z.string() });
`;

// A standalone schema with the same four keys as EXTENDED_SCHEMA's union.
const FLAT_FOUR_KEY_SCHEMA = `
import { z } from "zod";
export const flatSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
  status: z.string(),
});
`;

// .merge(Identifier): a non-literal chain argument — must be skipped, not emitted
// as a misleading partial {a,b,c}.
const MERGED_WITH_IDENTIFIER = `
import { z } from "zod";
import { BaseSchema } from "./base";
export const mergedSchema = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number(),
}).merge(BaseSchema);
`;

const OMITTED_SCHEMA = `
import { z } from "zod";
export const withoutCSchema = z.object({
  a: z.string(),
  b: z.string(),
  c: z.string(),
}).omit({ c: true });
`;

const PICKED_SCHEMA = `
import { z } from "zod";
export const pickedSchema = z.object({
  a: z.string(),
  b: z.string(),
  c: z.string(),
}).pick({ a: true, b: true });
`;

const FLAT_TWO_KEY_AB_SCHEMA = `
import { z } from "zod";
export const flatAbSchema = z.object({
  a: z.string(),
  b: z.string(),
});
`;

const FLAT_THREE_KEY_ABC_SCHEMA = `
import { z } from "zod";
export const flatAbcSchema = z.object({
  a: z.string(),
  b: z.string(),
  c: z.string(),
});
`;

const AMBIGUOUS_PICK_AND_OMIT = `
import { z } from "zod";
const mask = { a: true, b: true };
const key = "c";
export const dynamicPickSchema = z.object({
  a: z.string(),
  b: z.string(),
  c: z.string(),
}).pick(mask);
export const computedOmitSchema = z.object({
  a: z.string(),
  b: z.string(),
  c: z.string(),
}).omit({ [key]: true });
`;

const KEY_PRESERVING_CHAIN_SCHEMA = `
import { z } from "zod";
export const strictSchema = z.object({
  a: z.string(),
  b: z.string(),
  c: z.string(),
}).strict().describe("strict shape").readonly();
`;

const UNKNOWN_CHAIN_SCHEMA = `
import { z } from "zod";
export const unknownSchema = z.object({
  a: z.string(),
  b: z.string(),
  c: z.string(),
}).customObjectLink();
`;

describe("extractSchemaShapes", () => {
  it("groups identical schemas across files even with reordered keys", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({ "src/a.ts": USER_SCHEMA, "src/b.ts": USER_SCHEMA_REORDERED }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.label).sort()).toEqual([
      "accountSchema",
      "userSchema",
    ]);
  });

  it("groups same-keys schemas that differ only in validator text (lossy on .min(1))", () => {
    // Per spec: the canonical identity is the SORTED KEY NAMES only; validator text
    // (.min(1) vs plain) is lossy and must NOT split the group.
    const groups = groupDuplicateShapes(
      shapesFrom({ "src/a.ts": USER_SCHEMA, "src/b.ts": USER_SCHEMA_LOSSY }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((member) => member.label).sort()).toEqual([
      "personSchema",
      "userSchema",
    ]);
  });

  it("keeps each member's value/validator text in extra (evidence, not in the group key)", () => {
    const shapes = extractSchemaShapes("src/a.ts", USER_SCHEMA, { minKeys: 3 });
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.canonicalKey).not.toContain("z.string()");
    expect(shapes[0]?.extra.fields.join(" ")).toContain("name=z.string()");
  });

  it("folds .extend({...}) keys into the key set so it does not match a smaller schema", () => {
    const sameKeys = groupDuplicateShapes(
      shapesFrom({ "src/a.ts": EXTENDED_SCHEMA, "src/b.ts": FLAT_FOUR_KEY_SCHEMA }),
      { minDistinctFiles: 2 },
    );
    expect(sameKeys).toHaveLength(1);

    const wrongMatch = groupDuplicateShapes(
      shapesFrom({ "src/a.ts": EXTENDED_SCHEMA, "src/b.ts": USER_SCHEMA }),
      { minDistinctFiles: 2 },
    );
    expect(wrongMatch).toEqual([]);
  });

  it("declines to emit a schema whose chain merges a non-literal (e.g. .merge(Base))", () => {
    expect(extractSchemaShapes("src/a.ts", MERGED_WITH_IDENTIFIER, { minKeys: 3 })).toEqual([]);
  });

  it("models .omit({ key: true }) so omitted keys are not part of the canonical shape", () => {
    const sameKeys = groupDuplicateShapes(
      shapesFrom(
        { "src/a.ts": OMITTED_SCHEMA, "src/b.ts": FLAT_TWO_KEY_AB_SCHEMA },
        { minKeys: 2 },
      ),
      { minDistinctFiles: 2 },
    );
    expect(sameKeys).toHaveLength(1);
    expect(sameKeys[0]?.canonicalKey).toBe("schema:{a;b}");
    expect(sameKeys[0]?.members.map((member) => member.label).sort()).toEqual([
      "flatAbSchema",
      "withoutCSchema",
    ]);

    const wrongMatch = groupDuplicateShapes(
      shapesFrom(
        { "src/a.ts": OMITTED_SCHEMA, "src/b.ts": FLAT_THREE_KEY_ABC_SCHEMA },
        { minKeys: 2 },
      ),
      { minDistinctFiles: 2 },
    );
    expect(wrongMatch).toEqual([]);
  });

  it("models .pick({ key: true }) so only picked keys are part of the canonical shape", () => {
    const groups = groupDuplicateShapes(
      shapesFrom({ "src/a.ts": PICKED_SCHEMA, "src/b.ts": FLAT_TWO_KEY_AB_SCHEMA }, { minKeys: 2 }),
      { minDistinctFiles: 2 },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.canonicalKey).toBe("schema:{a;b}");
    expect(groups[0]?.members.map((member) => member.label).sort()).toEqual([
      "flatAbSchema",
      "pickedSchema",
    ]);
  });

  it("skips ambiguous pick/omit masks instead of preserving the base key set", () => {
    expect(extractSchemaShapes("src/a.ts", AMBIGUOUS_PICK_AND_OMIT, { minKeys: 2 })).toEqual([]);
  });

  it("keeps known key-preserving chain links in the base key set", () => {
    expect(
      extractSchemaShapes("src/a.ts", KEY_PRESERVING_CHAIN_SCHEMA, { minKeys: 3 }),
    ).toMatchObject([{ canonicalKey: "schema:{a;b;c}", label: "strictSchema" }]);
  });

  it("skips unknown invoked chain links after .object(...) instead of preserving the base keys", () => {
    expect(extractSchemaShapes("src/a.ts", UNKNOWN_CHAIN_SCHEMA, { minKeys: 3 })).toEqual([]);
  });

  it("skips schemas below the minimum key count", () => {
    expect(extractSchemaShapes("src/point.ts", TWO_KEY_SCHEMA, { minKeys: 3 })).toEqual([]);
  });
});

describe("duplicateSchemasCheck", () => {
  it("is opt-in because it scans the whole project", () => {
    expect(duplicateSchemasCheck.runByDefault).toBe(false);
  });

  it("reports a provenance-stamped duplicate-schema group from real files", () => {
    const repoRoot = writeRepo({ "src/a.ts": USER_SCHEMA, "src/b.ts": USER_SCHEMA_REORDERED });
    const outcome = duplicateSchemasCheck.runWithSelectedConfig({
      detectorScope: { scopeMode: "current", files: [] },
      inventoryByDir: null,
      repoRoot,
      suppressionDiffRef: null,
      config: DEFAULT_DRIFT_AI_CONFIG,
      roots: ["src"],
      sourceExtensions: buildSourceExtensions([]),
      warnStderr: () => undefined,
      env: {
        repoRoot,
        overrides: {},
        cli: parseArgs(["--scope", "current", "--check", "duplicate-schemas"]),
      },
    });
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      const finding = outcome.findings[0];
      expect(finding?.check).toBe("duplicate-schemas");
      expect(finding?.provenance).toEqual({ configSource: "drift-baseline", tool: "ts-morph" });
      expect(finding?.details?.["keyCount"]).toBe(3);
    }
  });
});
