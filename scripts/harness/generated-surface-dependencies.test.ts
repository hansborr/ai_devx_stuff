import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  deriveFixturePaths,
  deriveGeneratedSurfaceDependencies,
  diffFixtureExtraResidue,
  renderFixtureManifest,
  SHARED_FIXTURE_INFRA_RECORD_ID,
} from "./generated-surface-dependencies.js";
import { type GeneratedSurfaceRecord } from "./generated-surfaces.js";
import { loadGeneratedSurfaces } from "./generated-surfaces-loader.js";
import { GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH } from "./harness-paths.js";

const tmpRepo = registerTempRootCleanup();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function record(
  id: string,
  overrides: Partial<Pick<GeneratedSurfaceRecord, "fixtureExtras" | "outputPaths" | "source">> = {},
): GeneratedSurfaceRecord {
  return {
    id,
    source: overrides.source ?? `scripts/${id}.ts`,
    checkScript: `${id}:check`,
    refreshScript: id,
    triggerPaths: [`scripts/${id}.ts`],
    outputPaths: overrides.outputPaths ?? [`generated/${id}.txt`],
    warnLabel: `${id} output`,
    bunHook: { refresh: "bypass", check: "wrapped" },
    ...(overrides.fixtureExtras === undefined ? {} : { fixtureExtras: overrides.fixtureExtras }),
  };
}

describe("deriveFixturePaths", () => {
  it("adds residue to the walked closure while omitting generated and synthesized files", () => {
    const records = [
      record("check/alpha", {
        outputPaths: ["generated/alpha.txt"],
        fixtureExtras: [
          { path: "scripts/runtime.sh", reason: "Executed by the reduced fixture." },
          {
            path: "generated/alpha.txt",
            reason: "Consumed as runtime input by the reduced fixture.",
          },
        ],
      }),
    ];

    expect(
      deriveFixturePaths({
        records,
        entryClosures: [
          {
            ownerId: "check/alpha",
            files: ["scripts/check/alpha.ts", "generated/alpha.txt", "scripts/synthesized.ts"],
          },
        ],
        synthesizedPaths: ["scripts/synthesized.ts"],
      }),
    ).toEqual(["generated/alpha.txt", "scripts/check/alpha.ts", "scripts/runtime.sh"]);
  });
});

describe("renderFixtureManifest", () => {
  it("deduplicates, codepoint-sorts, and labels the derived projection", () => {
    const rendered = renderFixtureManifest(["scripts/z.ts", "docs/a.md", "scripts/z.ts"]);
    const copyLines = rendered
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(copyLines).toEqual(["docs/a.md", "scripts/z.ts"]);
    expect(rendered).toContain("fixtureExtras declare reasoned residue");
    expect(rendered.endsWith("\n")).toBe(true);
  });

  it("names the owning record when authored residue is a directory", () => {
    const records = [
      record("check/alpha", {
        outputPaths: ["generated/alpha.txt"],
        fixtureExtras: [
          { path: "scripts/harness/", reason: "Invalid directory-style fixture residue." },
        ],
      }),
    ];

    expect(() => deriveFixturePaths({ records, entryClosures: [] })).toThrow(/check\/alpha/u);
  });
});

describe("diffFixtureExtraResidue", () => {
  it("rejects an extra that the import closure already derives", () => {
    const records = [
      record("check/alpha", {
        fixtureExtras: [{ path: "scripts/lib/helper.ts", reason: "Mechanical closure echo." }],
      }),
    ];

    const failures = diffFixtureExtraResidue({
      records,
      entryClosures: [
        {
          ownerId: "check/alpha",
          files: ["scripts/check/alpha.ts", "scripts/lib/helper.ts"],
        },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/helper.ts");
    expect(failures[0]).toContain("fixtureExtras");
    expect(failures[0]).toContain("remove the derivable residue");
  });

  it("accepts reasoned non-closure runtime inputs, including generated outputs", () => {
    const records = [
      record("check/alpha", {
        outputPaths: ["generated/alpha.txt"],
        fixtureExtras: [
          { path: "scripts/runtime.sh", reason: "Executed by the reduced fixture." },
          {
            path: "generated/alpha.txt",
            reason: "Consumed as runtime input by the reduced fixture.",
          },
        ],
      }),
    ];

    expect(
      diffFixtureExtraResidue({
        records,
        entryClosures: [{ ownerId: "check/alpha", files: ["scripts/check/alpha.ts"] }],
      }),
    ).toEqual([]);
  });

  it("accepts a generated output explicitly copied as runtime data even when imported", () => {
    const records = [
      record("check/alpha", {
        outputPaths: ["generated/alpha.txt"],
        fixtureExtras: [
          {
            path: "generated/alpha.txt",
            reason: "Consumed as runtime input by the reduced fixture.",
          },
        ],
      }),
    ];

    expect(
      diffFixtureExtraResidue({
        records,
        entryClosures: [
          {
            ownerId: "check/alpha",
            files: ["scripts/check/alpha.ts", "generated/alpha.txt"],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("preserves the shared-infrastructure owner for validator-root residue diagnostics", () => {
    const records = [
      record("check/alpha", {
        fixtureExtras: [
          { path: "scripts/harness/shared.ts", reason: "Mechanical root-closure echo." },
        ],
      }),
    ];

    const failures = diffFixtureExtraResidue({
      records,
      entryClosures: [
        { ownerId: "scripts/harness-check.ts", files: ["scripts/harness/shared.ts"] },
      ],
    });

    expect(failures[0]).toContain(SHARED_FIXTURE_INFRA_RECORD_ID);
  });
});

describe("deriveGeneratedSurfaceDependencies", () => {
  it("walks the validator and generator entries once and returns their effective fixture union", async () => {
    const root = tmpRepo.writeRepo(
      {
        "scripts/harness-check.ts": 'import "./shared.js";\n',
        "scripts/harness-registration-check.ts": 'import "./shared.js";\n',
        "scripts/shared.ts": "export const shared = true;\n",
        "scripts/alpha-generator.ts": 'import "./lib/helper.js";\n',
        "scripts/lib/helper.ts": "export const helper = true;\n",
        "scripts/runtime.sh": "#!/usr/bin/env bash\n",
      },
      "generated-surface-dependencies-",
    );
    const records = [
      record("check/alpha", {
        source: "scripts/alpha-generator.ts",
        fixtureExtras: [{ path: "scripts/runtime.sh", reason: "Executed by the reduced fixture." }],
      }),
    ];

    const result = await deriveGeneratedSurfaceDependencies(root, records);

    expect(result.failures).toEqual([]);
    expect(result.entryClosures).toEqual([
      {
        ownerId: "scripts/harness-check.ts",
        files: ["scripts/harness-check.ts", "scripts/shared.ts"],
      },
      {
        ownerId: "scripts/harness-registration-check.ts",
        files: ["scripts/harness-registration-check.ts", "scripts/shared.ts"],
      },
      {
        ownerId: "check/alpha",
        files: ["scripts/alpha-generator.ts", "scripts/lib/helper.ts"],
      },
    ]);
    expect(result.fixturePaths).toEqual([
      "scripts/alpha-generator.ts",
      "scripts/harness-check.ts",
      "scripts/harness-registration-check.ts",
      "scripts/lib/helper.ts",
      "scripts/runtime.sh",
      "scripts/shared.ts",
    ]);
  });

  it("matches the committed real-tree fixture projection byte-for-byte", async () => {
    const result = await deriveGeneratedSurfaceDependencies(
      repoRoot,
      loadGeneratedSurfaces(repoRoot),
    );
    expect(result.failures).toEqual([]);
    expect(renderFixtureManifest(result.fixturePaths)).toBe(
      readFileSync(join(repoRoot, GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH), "utf8"),
    );
  });
});
