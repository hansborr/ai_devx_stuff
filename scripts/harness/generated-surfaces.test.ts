import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  diffTriggerPathClosure,
  type GeneratedSurfaceRecord,
  renderClassifierFragment,
  renderFreshnessShell,
} from "./generated-surfaces.js";
import { loadGeneratedSurfaces } from "./generated-surfaces-loader.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";
import {
  GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH,
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
  // The loader parses the WHOLE manifest through the typed contract, so this
  // fixture carries the top-level arrays and the full non-lint control field
  // set even though only `generatedSurface` is under test here.
  return JSON.stringify({
    scriptParityExemptions: [],
    ciGateControlIds: [],
    controls: [
      {
        id: "check/example-generator",
        kind: "check",
        category: "maintainability",
        principle: "Example generated-surface control for facet parsing tests.",
        pairedGuide: "none",
        repairKind: "autofix",
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
  it("returns exactly the twenty registered generated surfaces in deterministic id order", () => {
    const records = loadGeneratedSurfaces(repoRoot);
    expect(records.map((record) => record.id)).toEqual([
      "check/command-policy-generator",
      "check/concurrency-relation-graph-generator",
      "check/config-surface-generator",
      "check/harness-hook-wiring-generator",
      "check/hook-timeout-constants-generator",
      "check/lint-rule-controls-generator",
      "check/local-plugin-generator",
      "check/pre-push-scope-trigger-generator",
      "check/restricted-disable-rules-generator",
      "check/skill-artifacts-generator",
      "check/smoke-subjects-generator",
      "check/verify-steps-generator",
      "doc-generator/backlog-catalog",
      "doc-generator/baseline-conflict-recipes",
      "doc-generator/command-catalog",
      "doc-generator/harness-controls",
      "doc-generator/harness-porting-manifest",
      "doc-generator/lint-coverage-map",
      "doc-generator/lint-guidance",
      "doc-generator/manifest-json-schema",
    ]);
  });

  it("covers every freshness checker in the loader's deterministic render order", () => {
    expect(loadGeneratedSurfaces(repoRoot).map((record) => record.checkScript)).toEqual([
      "harness:command-policy:check",
      "concurrency:relation-graph:check",
      "harness:config-surfaces:check",
      "harness:wiring:check",
      "harness:hook-timeouts:check",
      "harness:lint-rule-controls:check",
      "lint:local-plugin:check",
      "harness:pre-push-trigger:check",
      "lint:restricted-disable-rules:check",
      "harness:skills:check",
      "test:scripts:subjects:check",
      "verify:steps:check",
      "docs:backlog-catalog:check",
      "docs:baseline-conflict-recipes:check",
      "docs:command-catalog:check",
      "docs:harness-controls:check",
      "docs:harness-porting:check",
      "docs:lint-coverage-map:generate:check",
      "docs:lint-guidance:check",
      "harness:manifest-schema:check",
    ]);
  });

  it("derives the refresh script from each record's bun run invocation", () => {
    const records = loadGeneratedSurfaces(repoRoot);
    const smokeSubjects = records.find((record) => record.id === "check/smoke-subjects-generator");
    expect(smokeSubjects?.refreshScript).toBe("test:scripts:subjects");
    expect(smokeSubjects?.checkScript).toBe("test:scripts:subjects:check");
    expect(smokeSubjects?.bunHook).toEqual({ refresh: "wrapped", check: "wrapped" });
    const skillArtifacts = records.find(
      (record) => record.id === "check/skill-artifacts-generator",
    );
    expect(skillArtifacts?.refreshScript).toBe("harness:skills:refresh");
    expect(skillArtifacts?.checkScript).toBe("harness:skills:check");
    expect(skillArtifacts?.bunHook).toEqual({ refresh: "wrapped", check: "wrapped" });
    const verifySteps = records.find((record) => record.id === "check/verify-steps-generator");
    expect(verifySteps?.refreshScript).toBe("verify:steps");
    expect(verifySteps?.bunHook).toEqual({
      refresh: "bypass",
      check: "wrapped",
      scripts: {
        "mutation:survivors": "wrapped",
        "sensor:context-budget": "wrapped",
      },
    });
    const lintCoverageMap = records.find(
      (record) => record.id === "doc-generator/lint-coverage-map",
    );
    expect(lintCoverageMap?.refreshScript).toBe("docs:lint-coverage-map:generate");
    expect(lintCoverageMap?.checkScript).toBe("docs:lint-coverage-map:generate:check");
    expect(lintCoverageMap?.bunHook).toEqual({ refresh: "bypass", check: "wrapped" });
  });

  it("keeps fixture declarations limited to reasoned non-import residue", () => {
    const records = loadGeneratedSurfaces(repoRoot);
    const extras = records.flatMap((record) => record.fixtureExtras ?? []);
    expect(extras.length).toBeGreaterThan(0);
    expect(extras.every((extra) => extra.reason.length > 0)).toBe(true);
    expect(extras.map((extra) => extra.path)).not.toContain("scripts/harness-check.ts");
  });

  it("tracks the package recovery renderer that feeds the merge runbook", () => {
    const record = loadGeneratedSurfaces(repoRoot).find(
      (candidate) => candidate.id === "doc-generator/baseline-conflict-recipes",
    );
    const authority = "tools/lint-ratchet/src/git-rail/conflict-recovery.ts";

    expect(record?.triggerPaths).toContain(authority);
  });
});

describe("diffTriggerPathClosure (triggerPaths vs generator import closure)", () => {
  function triggerRecord(id: string, triggerPaths: readonly string[]): GeneratedSurfaceRecord {
    return {
      id,
      source: `scripts/${id}.ts`,
      checkScript: `${id}:check`,
      refreshScript: id,
      triggerPaths,
      outputPaths: [`generated/${id}.txt`],
      warnLabel: `${id} output`,
      bunHook: { refresh: "bypass", check: "wrapped" },
    };
  }

  it("passes when every closure file is exactly declared as a trigger", () => {
    const failures = diffTriggerPathClosure({
      records: [triggerRecord("check/alpha", ["scripts/check/alpha.ts", "scripts/lib/helper.ts"])],
      entryClosures: [
        { ownerId: "check/alpha", files: ["scripts/check/alpha.ts", "scripts/lib/helper.ts"] },
      ],
    });

    expect(failures).toEqual([]);
  });

  it("treats a directory prefix trigger as covering every file under it", () => {
    const failures = diffTriggerPathClosure({
      records: [triggerRecord("check/alpha", ["scripts/check/alpha.ts", "scripts/lib/"])],
      entryClosures: [
        {
          ownerId: "check/alpha",
          files: ["scripts/check/alpha.ts", "scripts/lib/deep/helper.ts"],
        },
      ],
    });

    expect(failures).toEqual([]);
  });

  it("fails on a closure file no trigger covers, naming the record and the fix", () => {
    const failures = diffTriggerPathClosure({
      records: [triggerRecord("check/alpha", ["scripts/check/alpha.ts"])],
      entryClosures: [
        { ownerId: "check/alpha", files: ["scripts/check/alpha.ts", "scripts/lib/missed.ts"] },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("check/alpha");
    expect(failures[0]).toContain("scripts/lib/missed.ts");
    expect(failures[0]).toContain("triggerPaths");
  });

  it("does not treat a non-slash trigger entry as a prefix", () => {
    // "scripts/lib" without the trailing slash is an exact path, so it must
    // not silently cover files under scripts/lib/.
    const failures = diffTriggerPathClosure({
      records: [triggerRecord("check/alpha", ["scripts/check/alpha.ts", "scripts/lib"])],
      entryClosures: [
        { ownerId: "check/alpha", files: ["scripts/check/alpha.ts", "scripts/lib/helper.ts"] },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/helper.ts");
  });

  it("ignores closure entries that belong to no record, such as the validator root", () => {
    const failures = diffTriggerPathClosure({
      records: [triggerRecord("check/alpha", ["scripts/check/alpha.ts"])],
      entryClosures: [
        { ownerId: "check/alpha", files: ["scripts/check/alpha.ts"] },
        { ownerId: "scripts/harness-check.ts", files: ["scripts/harness/shared.ts"] },
      ],
    });

    expect(failures).toEqual([]);
  });

  it("skips records without a walked closure entry, e.g. non-walkable sources", () => {
    const failures = diffTriggerPathClosure({
      records: [triggerRecord("check/alpha", ["scripts/check/alpha.sh"])],
      entryClosures: [],
    });

    expect(failures).toEqual([]);
  });

  it("reports failures sorted by file within a record for deterministic output", () => {
    const failures = diffTriggerPathClosure({
      records: [triggerRecord("check/alpha", ["scripts/check/alpha.ts"])],
      entryClosures: [
        {
          ownerId: "check/alpha",
          files: ["scripts/check/alpha.ts", "scripts/lib/zeta.ts", "scripts/lib/beta.ts"],
        },
      ],
    });

    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain("scripts/lib/beta.ts");
    expect(failures[1]).toContain("scripts/lib/zeta.ts");
  });

  it("covers the real manifest: every generator import is a declared trigger", () => {
    // Guards the live registration, not just the pure diff: a generator import
    // absent from triggerPaths means edits to it would never stale-warn.
    const records = loadGeneratedSurfaces(repoRoot);
    for (const record of records) {
      expect(
        record.triggerPaths.includes(record.source) ||
          record.triggerPaths.some(
            (trigger) => trigger.endsWith("/") && record.source.startsWith(trigger),
          ),
        `${record.id}: source ${record.source} must itself be covered by triggerPaths`,
      ).toBe(true);
    }
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

  it("drops a path a trigger prefix already covers, so the case has no dead arm", () => {
    // A record whose output lives inside one of its own trigger directories
    // used to render both patterns, and shellcheck rejects the resulting
    // always-overridden/never-matched pair (SC2221/SC2222).
    const record: GeneratedSurfaceRecord = {
      id: "check/prefix-covered",
      source: "scripts/prefix-covered.ts",
      checkScript: "prefix:check",
      refreshScript: "prefix",
      triggerPaths: ["docs/notes/", "scripts/prefix-covered.ts"],
      outputPaths: ["docs/notes/CATALOG.md"],
      warnLabel: "prefix covered",
      bunHook: { refresh: "bypass", check: "wrapped" },
    };
    const rendered = renderFreshnessShell([record]);
    expect(rendered).toContain("'docs/notes/'*|'scripts/prefix-covered.ts'");
    expect(rendered).not.toContain("'docs/notes/CATALOG.md'");
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

  it("routes additional package scripts owned by a bunHook facet", () => {
    const rendered = renderClassifierFragment([
      classifierRecord("check/alpha", "alpha", {
        refresh: "bypass",
        check: "wrapped",
        scripts: {
          "mutation:survivors": "wrapped",
          "sensor:context-budget": "wrapped",
        },
      }),
    ]);

    expect(rendered).toContain(
      "AI_GENERATED_WRAPPED_BUN_SCRIPTS='\nalpha:check\nmutation:survivors\nsensor:context-budget\n'",
    );
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

  it("loads additional package-script classifications from the bunHook facet", () => {
    const root = makeFacetRoot({
      bunHook: {
        refresh: "bypass",
        check: "wrapped",
        scripts: { "sensor:report": "wrapped" },
      },
    });

    expect(loadGeneratedSurfaces(root)[0]?.bunHook.scripts).toEqual({
      "sensor:report": "wrapped",
    });
  });

  it("rejects a carrier whose invocation is not a bun run script", () => {
    const root = makeFacetRoot({}, "bash scripts/example.sh");
    expect(() => loadGeneratedSurfaces(root)).toThrow(/bun run/u);
  });

  it("accepts fixtureExtras only when every path carries a reason", () => {
    const fixtureExtras = [{ path: "scripts/a.sh", reason: "Runtime fixture helper." }];
    const records = loadGeneratedSurfaces(makeFacetRoot({ fixtureExtras }));
    expect(records[0]?.fixtureExtras).toEqual(fixtureExtras);

    expect(() =>
      loadGeneratedSurfaces(
        makeFacetRoot({ fixtureExtras: [{ path: "scripts/a.sh", reason: "" }] }),
      ),
    ).toThrow(/fixtureExtras\.0\.reason/u);
  });
});
