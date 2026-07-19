import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  diffFixtureClosure,
  type GeneratedSurfaceRecord,
  loadGeneratedSurfaces,
  renderClassifierFragment,
  renderFixtureManifest,
  renderFreshnessShell,
  SHARED_FIXTURE_INFRA_RECORD_ID,
} from "./generated-surfaces.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";
import {
  GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH,
  GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH,
  GENERATED_SURFACE_FRESHNESS_PATH,
} from "./harness-paths.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const tmpRepo = registerTempRootCleanup();

interface FacetOverrides {
  readonly [key: string]: unknown;
}

function manifestWithFacet(facetOverrides: FacetOverrides = {}, invocation?: string): string {
  const facet = {
    triggerPaths: ["scripts/example-generator.ts"],
    outputPaths: ["generated/example.txt"],
    checkScript: "example:check",
    warnLabel: "example output",
    bunHook: { refresh: "bypass", check: "wrapped" },
    ...facetOverrides,
  };
  return JSON.stringify({
    controls: [
      {
        id: "check/example-generator",
        kind: "check",
        source: "scripts/example-generator.ts",
        invocation: invocation ?? "bun run example",
        generatedSurface: facet,
      },
    ],
  });
}

function makeFacetRoot(facetOverrides: FacetOverrides = {}, invocation?: string): string {
  return tmpRepo.writeRepo(
    { [HARNESS_MANIFEST_FILENAME]: manifestWithFacet(facetOverrides, invocation) },
    "generated-surfaces-",
  );
}

describe("loadGeneratedSurfaces (real manifest)", () => {
  it("returns exactly the nine registered generated surfaces in deterministic id order", () => {
    const records = loadGeneratedSurfaces(repoRoot);
    expect(records.map((record) => record.id)).toEqual([
      "check/config-surface-generator",
      "check/harness-hook-wiring-generator",
      "check/hook-timeout-constants-generator",
      "check/restricted-disable-rules-generator",
      "check/smoke-subjects-generator",
      "check/verify-steps-generator",
      "doc-generator/baseline-conflict-recipes",
      "doc-generator/harness-controls",
      "doc-generator/lint-guidance",
    ]);
  });

  it("covers every freshness checker in the loader's deterministic render order", () => {
    expect(loadGeneratedSurfaces(repoRoot).map((record) => record.checkScript)).toEqual([
      "harness:config-surfaces:check",
      "harness:wiring:check",
      "harness:hook-timeouts:check",
      "lint:restricted-disable-rules:check",
      "test:scripts:subjects:check",
      "verify:steps:check",
      "docs:baseline-conflict-recipes:check",
      "docs:harness-controls:check",
      "docs:lint-guidance:check",
    ]);
  });

  it("derives the refresh script from each record's bun run invocation", () => {
    const records = loadGeneratedSurfaces(repoRoot);
    const smokeSubjects = records.find((record) => record.id === "check/smoke-subjects-generator");
    expect(smokeSubjects?.refreshScript).toBe("test:scripts:subjects");
    expect(smokeSubjects?.checkScript).toBe("test:scripts:subjects:check");
    expect(smokeSubjects?.bunHook).toEqual({ refresh: "wrapped", check: "wrapped" });
    const verifySteps = records.find((record) => record.id === "check/verify-steps-generator");
    expect(verifySteps?.refreshScript).toBe("verify:steps");
    expect(verifySteps?.bunHook).toEqual({ refresh: "bypass", check: "wrapped" });
  });

  it("declares a non-empty fixture copy closure on every record", () => {
    const records = loadGeneratedSurfaces(repoRoot);
    for (const record of records) {
      expect(record.fixturePaths, record.id).toBeDefined();
      expect(record.fixturePaths?.length ?? 0, record.id).toBeGreaterThan(0);
    }
    // Shared fixture infrastructure (harness-check's own module family) lives
    // on the record that owns scripts/harness/generated-surfaces.ts.
    const sharedInfra = records.find((record) => record.id === SHARED_FIXTURE_INFRA_RECORD_ID);
    expect(sharedInfra?.fixturePaths).toContain("scripts/harness-check.ts");
  });
});

describe("renderFixtureManifest (smoke fixture copy projection)", () => {
  function fixtureRecord(
    id: string,
    overrides: Partial<Pick<GeneratedSurfaceRecord, "fixturePaths" | "outputPaths">> = {},
  ): GeneratedSurfaceRecord {
    return {
      id,
      source: `scripts/${id}.ts`,
      checkScript: `${id}:check`,
      refreshScript: id,
      triggerPaths: [`scripts/${id}.ts`],
      outputPaths: overrides.outputPaths ?? [`generated/${id}.txt`],
      warnLabel: `${id} output`,
      bunHook: { refresh: "bypass", check: "wrapped" },
      ...(overrides.fixturePaths === undefined ? {} : { fixturePaths: overrides.fixturePaths }),
    };
  }

  it("unions, deduplicates, and codepoint-sorts fixturePaths across records", () => {
    const rendered = renderFixtureManifest([
      fixtureRecord("check/beta", { fixturePaths: ["scripts/z.ts", "scripts/shared.ts"] }),
      fixtureRecord("check/alpha", { fixturePaths: ["scripts/shared.ts", "docs/a.md"] }),
    ]);

    const copyLines = rendered
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(copyLines).toEqual(["docs/a.md", "scripts/shared.ts", "scripts/z.ts"]);
    expect(rendered.endsWith("\n")).toBe(true);
  });

  it("renders only comment and blank lines besides the copy entries", () => {
    const rendered = renderFixtureManifest([
      fixtureRecord("check/alpha", { fixturePaths: ["scripts/a.ts"] }),
    ]);

    expect(rendered).toContain(
      "# Generated by scripts/harness/generate-verify-steps.ts. Do not edit by hand.",
    );
    expect(rendered).toContain("harness.controls.json");
    expect(rendered).toContain("bun run verify:steps");
    for (const line of rendered.split("\n")) {
      expect(line === "" || line.startsWith("#") || line === "scripts/a.ts").toBe(true);
    }
  });

  it("renders no copy entries when no record declares fixturePaths", () => {
    const rendered = renderFixtureManifest([fixtureRecord("check/alpha")]);
    const copyLines = rendered
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(copyLines).toEqual([]);
  });

  it("rejects directory-style fixturePaths entries", () => {
    const records = [fixtureRecord("check/alpha", { fixturePaths: ["scripts/harness/"] })];
    expect(() => renderFixtureManifest(records)).toThrow(/scripts\/harness\//u);
    expect(() => renderFixtureManifest(records)).toThrow(/check\/alpha/u);
  });

  it("matches the committed generated manifest byte-for-byte", () => {
    // Same parity contract as the freshness and classifier fragments: the
    // committed copy manifest must be exactly what the loader records render.
    const committed = readFileSync(
      join(repoRoot, GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH),
      "utf8",
    );
    expect(renderFixtureManifest(loadGeneratedSurfaces(repoRoot))).toBe(committed);
  });
});

describe("diffFixtureClosure (fixturePaths vs computed import closure)", () => {
  function closureRecord(
    id: string,
    overrides: Partial<Pick<GeneratedSurfaceRecord, "fixturePaths" | "outputPaths">> = {},
  ): GeneratedSurfaceRecord {
    return {
      id,
      source: `scripts/${id}.ts`,
      checkScript: `${id}:check`,
      refreshScript: id,
      triggerPaths: [`scripts/${id}.ts`],
      outputPaths: overrides.outputPaths ?? [`generated/${id}.txt`],
      warnLabel: `${id} output`,
      bunHook: { refresh: "bypass", check: "wrapped" },
      ...(overrides.fixturePaths === undefined ? {} : { fixturePaths: overrides.fixturePaths }),
    };
  }

  it("passes when every closure file is declared, generated, or synthesized", () => {
    const failures = diffFixtureClosure({
      records: [
        closureRecord("check/alpha", {
          fixturePaths: ["scripts/check/alpha.ts", "scripts/lib/helper.ts"],
          outputPaths: ["generated/alpha.generated.js"],
        }),
      ],
      entryClosures: [
        {
          ownerId: "check/alpha",
          files: [
            "scripts/check/alpha.ts",
            "scripts/lib/helper.ts",
            "generated/alpha.generated.js",
            "scripts/stub.ts",
          ],
        },
      ],
      synthesizedPaths: ["scripts/stub.ts"],
    });

    expect(failures).toEqual([]);
  });

  it("fails on a closure file missing from the declarations, naming the owning record", () => {
    const failures = diffFixtureClosure({
      records: [closureRecord("check/alpha", { fixturePaths: ["scripts/check/alpha.ts"] })],
      entryClosures: [
        { ownerId: "check/alpha", files: ["scripts/check/alpha.ts", "scripts/lib/missed.ts"] },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/missed.ts");
    expect(failures[0]).toContain("fixturePaths");
    expect(failures[0]).toContain("check/alpha");
  });

  it("suggests the shared-infra record for files reached only from the validator root", () => {
    const failures = diffFixtureClosure({
      records: [closureRecord("check/alpha", { fixturePaths: ["scripts/check/alpha.ts"] })],
      entryClosures: [
        { ownerId: "check/alpha", files: ["scripts/check/alpha.ts"] },
        { ownerId: "scripts/harness-check.ts", files: ["scripts/harness/shared.ts"] },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/harness/shared.ts");
    expect(failures[0]).toContain(SHARED_FIXTURE_INFRA_RECORD_ID);
  });

  it("fails on a declared TypeScript file absent from the closure", () => {
    const failures = diffFixtureClosure({
      records: [
        closureRecord("check/alpha", {
          fixturePaths: ["scripts/check/alpha.ts", "scripts/lib/stale.ts"],
        }),
      ],
      entryClosures: [{ ownerId: "check/alpha", files: ["scripts/check/alpha.ts"] }],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/stale.ts");
    expect(failures[0]).toContain("check/alpha");
    expect(failures[0]).toContain("not in the computed fixture import closure");
  });

  it("fails on a declared walkable JS file absent from the closure", () => {
    // The walker resolves .js/.mjs/.cjs imports, so a declared JS file the
    // closure no longer reaches is just as stale as a TypeScript one.
    const failures = diffFixtureClosure({
      records: [
        closureRecord("check/alpha", {
          fixturePaths: ["scripts/check/alpha.ts", "eslint-config/dead-codec.js"],
        }),
      ],
      entryClosures: [{ ownerId: "check/alpha", files: ["scripts/check/alpha.ts"] }],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("eslint-config/dead-codec.js");
    expect(failures[0]).toContain("not in the computed fixture import closure");
  });

  it("allows declared non-walkable runtime inputs absent from the closure", () => {
    const failures = diffFixtureClosure({
      records: [
        closureRecord("check/alpha", {
          fixturePaths: [
            "scripts/check/alpha.ts",
            "scripts/verify/steps-lib.sh",
            "docs/guides/runbook.md",
            "eslint-config/manifest.json",
          ],
        }),
      ],
      entryClosures: [{ ownerId: "check/alpha", files: ["scripts/check/alpha.ts"] }],
    });

    expect(failures).toEqual([]);
  });
});

describe("renderFreshnessShell (freshness pre-commit projection)", () => {
  it("renders a warn case for the first and last registered surfaces", () => {
    const rendered = renderFreshnessShell(loadGeneratedSurfaces(repoRoot));
    expect(rendered).toContain("scripts/path-policy/generate-smoke-subjects.ts");
    expect(rendered).toContain(
      "warn_if_generated_surface_stale 'script smoke-subject metadata' 'test:scripts:subjects:check'",
    );
    expect(rendered).toContain("scripts/harness/generate-restricted-disable-rules.ts");
    expect(rendered).toContain(
      "warn_if_generated_surface_stale 'restricted-disable rule metadata' 'lint:restricted-disable-rules:check'",
    );
  });

  it("matches the committed generated shell byte-for-byte", () => {
    // Folded-in S2 parity gate: the committed fragment must be exactly what the
    // loader records render to (same contract `verify:steps:check` enforces).
    const committed = readFileSync(join(repoRoot, GENERATED_SURFACE_FRESHNESS_PATH), "utf8");
    expect(renderFreshnessShell(loadGeneratedSurfaces(repoRoot))).toBe(committed);
  });

  it("renders a newly registered surface without changing the hook", () => {
    const hookBefore = readFileSync(join(repoRoot, ".husky/pre-commit"), "utf8");
    const example: GeneratedSurfaceRecord = {
      id: "check/example-generator",
      source: "scripts/example-generator.ts",
      checkScript: "example:check",
      refreshScript: "example",
      triggerPaths: ["scripts/example-generator.ts", "scripts/example-data/"],
      outputPaths: ["generated/example.txt"],
      warnLabel: "example output",
      bunHook: { refresh: "bypass", check: "wrapped" },
    };
    const rendered = renderFreshnessShell([...loadGeneratedSurfaces(repoRoot), example]);

    expect(rendered).toContain("'scripts/example-generator.ts'|'scripts/example-data/'*");
    expect(rendered).toContain("warn_if_generated_surface_stale 'example output' 'example:check'");
    expect(readFileSync(join(repoRoot, ".husky/pre-commit"), "utf8")).toBe(hookBefore);
  });
});

describe("renderClassifierFragment (ai-hooks classifier projection)", () => {
  function classifierRecord(
    id: string,
    refreshScript: string,
    bunHook: GeneratedSurfaceRecord["bunHook"],
  ): GeneratedSurfaceRecord {
    return {
      id,
      source: `scripts/${id}.ts`,
      checkScript: `${refreshScript}:check`,
      refreshScript,
      triggerPaths: [`scripts/${id}.ts`],
      outputPaths: [`generated/${id}.txt`],
      warnLabel: `${id} output`,
      bunHook,
    };
  }

  it("routes each record's check and refresh script by its bunHook classification", () => {
    const rendered = renderClassifierFragment([
      classifierRecord("check/alpha", "alpha", { refresh: "bypass", check: "wrapped" }),
      classifierRecord("check/beta", "beta", { refresh: "wrapped", check: "wrapped" }),
    ]);

    expect(rendered).toContain(
      "AI_GENERATED_WRAPPED_BUN_SCRIPTS='\nalpha:check\nbeta\nbeta:check\n'",
    );
    expect(rendered).toContain("AI_GENERATED_BYPASS_BUN_SCRIPTS='\nalpha\n'");
  });

  it("renders the generated-file header pointing at the manifest and refresh command", () => {
    const rendered = renderClassifierFragment([]);

    expect(rendered).toContain("# shellcheck shell=bash");
    expect(rendered).toContain(
      "# Generated by scripts/harness/generate-verify-steps.ts. Do not edit by hand.",
    );
    expect(rendered).toContain("harness.controls.json");
    expect(rendered).toContain("bun run verify:steps");
    expect(rendered.endsWith("\n")).toBe(true);
  });

  it("is deterministic regardless of record order", () => {
    const records = [
      classifierRecord("check/alpha", "alpha", { refresh: "bypass", check: "wrapped" }),
      classifierRecord("check/beta", "beta", { refresh: "wrapped", check: "wrapped" }),
      classifierRecord("check/gamma", "gamma", { refresh: "bypass", check: "wrapped" }),
    ];

    expect(renderClassifierFragment([...records].reverse())).toBe(
      renderClassifierFragment(records),
    );
  });

  it("deduplicates a script contributed by several records with one classification", () => {
    const rendered = renderClassifierFragment([
      classifierRecord("check/alpha", "shared", { refresh: "wrapped", check: "wrapped" }),
      classifierRecord("check/beta", "shared", { refresh: "wrapped", check: "wrapped" }),
    ]);

    expect(rendered).toContain("AI_GENERATED_WRAPPED_BUN_SCRIPTS='\nshared\nshared:check\n'");
  });

  it("throws when records classify the same script both wrapped and bypass", () => {
    const conflicting = [
      classifierRecord("check/alpha", "shared", { refresh: "wrapped", check: "wrapped" }),
      classifierRecord("check/beta", "shared", { refresh: "bypass", check: "wrapped" }),
    ];

    expect(() => renderClassifierFragment(conflicting)).toThrow(/shared/u);
    expect(() => renderClassifierFragment(conflicting)).toThrow(/both wrapped and bypass/u);
  });

  it("matches the committed generated fragment byte-for-byte", () => {
    // Same parity contract as the freshness fragment: the committed classifier
    // slices must be exactly what the loader records render to.
    const committed = readFileSync(join(repoRoot, GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH), "utf8");
    expect(renderClassifierFragment(loadGeneratedSurfaces(repoRoot))).toBe(committed);
  });

  it("classifies every real manifest check script as wrapped", () => {
    const rendered = renderClassifierFragment(loadGeneratedSurfaces(repoRoot));
    for (const record of loadGeneratedSurfaces(repoRoot)) {
      expect(rendered).toContain(`\n${record.checkScript}\n`);
    }
  });
});

describe("loadGeneratedSurfaces (validation)", () => {
  it("returns a normalized record from a minimal valid facet", () => {
    const records = loadGeneratedSurfaces(makeFacetRoot());
    expect(records).toEqual([
      {
        id: "check/example-generator",
        source: "scripts/example-generator.ts",
        checkScript: "example:check",
        refreshScript: "example",
        triggerPaths: ["scripts/example-generator.ts"],
        outputPaths: ["generated/example.txt"],
        warnLabel: "example output",
        bunHook: { refresh: "bypass", check: "wrapped" },
      },
    ]);
  });

  it("rejects unknown keys inside the generatedSurface facet", () => {
    const root = makeFacetRoot({ fixtureManifest: ["x"] });
    expect(() => loadGeneratedSurfaces(root)).toThrow(/check\/example-generator/u);
    expect(() => loadGeneratedSurfaces(root)).toThrow(/fixtureManifest/u);
  });

  it("rejects a facet missing required fields", () => {
    const root = makeFacetRoot({ warnLabel: undefined, bunHook: undefined });
    expect(() => loadGeneratedSurfaces(root)).toThrow(/warnLabel/u);
    expect(() => loadGeneratedSurfaces(root)).toThrow(/bunHook/u);
  });

  it("rejects bunHook classifications outside the wrapped/bypass enum", () => {
    const root = makeFacetRoot({ bunHook: { refresh: "sometimes", check: "wrapped" } });
    expect(() => loadGeneratedSurfaces(root)).toThrow(/bunHook\.refresh/u);
  });

  it("rejects a carrier whose invocation is not a bun run script", () => {
    const root = makeFacetRoot({}, "bash scripts/example.sh");
    expect(() => loadGeneratedSurfaces(root)).toThrow(/bun run/u);
  });

  it("accepts declared fixturePaths as an optional string array", () => {
    const records = loadGeneratedSurfaces(makeFacetRoot({ fixturePaths: ["scripts/a.ts"] }));
    expect(records[0]?.fixturePaths).toEqual(["scripts/a.ts"]);
  });
});
