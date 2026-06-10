import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PathProbe } from "./adapter-support.js";
import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import type { FileReader } from "./comments.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import {
  buildKnipDuplicateFindings,
  type KnipDuplicateExportGroup,
  parseKnipDuplicates,
} from "./knip-duplicates.js";
import { knipDuplicatesCheck } from "./knip-duplicates-check.js";
import type { KnipRunner } from "./knip-runner.js";
import { formatText } from "./report-format.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile, toCurrentScopeFile } from "./scope.js";
import { type ChangedFile, DRIFT_SCHEMA_VERSION, type DriftReport } from "./types.js";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

// Captured from knip 6.14.1:
// `knip --reporter json --include duplicates --no-progress --config knip.config.ts`
// against a temp project where `aliasValue` and the default export both alias
// `publicValue`. knip's category means duplicate export aliases, not source
// clone blocks.
const DUPLICATES_FIXTURE = readFileSync(
  path.join(FIXTURE_DIR, "knip-report.duplicates.json"),
  "utf8",
);

function pathExistsFor(present: readonly string[]): PathProbe {
  const set = new Set(present);
  return (relativePath) => set.has(relativePath);
}

function knipReporting(reportJson: string, exitCode = 1): KnipRunner {
  return () => ({ ok: true, reportJson, exitCode, stderr: "" });
}

type CtxOverrides = {
  readonly detectorScope?: DetectorScope;
  readonly pathExists?: PathProbe;
  readonly readFile?: FileReader;
  readonly knip?: KnipRunner;
};

const RUN_STATE = {
  inventoryByDir: null,
  repoRoot: "/repo/target",
  suppressionDiffRef: null,
  config: DEFAULT_DRIFT_AI_CONFIG,
  roots: [],
  sourceExtensions: buildSourceExtensions([]),
  warnStderr: () => undefined,
} as const;

function makeInput(overrides: CtxOverrides = {}): CheckRunInput {
  return {
    ...RUN_STATE,
    detectorScope: overrides.detectorScope ?? { scopeMode: "current", files: [] },
    env: {
      repoRoot: "/repo/target",
      overrides: {
        knip: overrides.knip ?? knipReporting('{"issues":[]}', 0),
        readFile: overrides.readFile ?? (() => undefined),
        pathExists: overrides.pathExists ?? (() => false),
      },
      cli: parseArgs(["--scope", "current", "--check", "knip-duplicates"]),
    },
  };
}

const INSTALLED_WITH_ROOT_CONFIG = ["node_modules", "knip.config.ts"];

function changedScope(files: readonly ChangedFile[]): DetectorScope {
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

function currentScope(paths: readonly string[]): DetectorScope {
  return { scopeMode: "current", files: paths.map(toCurrentScopeFile) };
}

const PROVENANCE = {
  configSource: "target-config",
  tool: "knip",
  configPath: "knip.config.ts",
} as const;

// --- parseKnipDuplicates ----------------------------------------------------

describe("parseKnipDuplicates", () => {
  it("parses duplicate export groups from the confirmed knip 6.14.1 fixture shape", () => {
    const result = parseKnipDuplicates(DUPLICATES_FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.groups).toEqual([
      {
        file: "src/symbols.ts",
        symbols: [
          { name: "publicValue", line: 1, col: 14 },
          { name: "aliasValue", line: 2, col: 14 },
          { name: "default", line: 3, col: 16 },
        ],
      },
    ]);
  });

  it("returns an empty list for a clean run", () => {
    expect(parseKnipDuplicates('{"issues":[]}')).toEqual({ ok: true, groups: [] });
  });

  it("tolerates rows with a missing duplicates category", () => {
    const result = parseKnipDuplicates(
      '{"issues":[{"file":"src/a.ts","exports":[{"name":"x","line":1,"col":1}]}]}',
    );
    expect(result).toEqual({ ok: true, groups: [] });
  });

  it("skips malformed category rows and incomplete duplicate groups", () => {
    const result = parseKnipDuplicates(
      JSON.stringify({
        issues: [
          { file: "src/a.ts", duplicates: "oops" },
          { file: "src/b.ts", duplicates: [{ name: "not-a-group" }] },
          { file: "src/c.ts", duplicates: [[{ name: "onlyOne", line: 1, col: 1 }]] },
          {
            file: "src/d.ts",
            duplicates: [
              [
                { name: "base", line: 1, col: 14 },
                { name: "" },
                { name: "alias", line: 0, col: 0 },
              ],
            ],
          },
        ],
      }),
    );

    expect(result).toEqual({
      ok: true,
      groups: [
        {
          file: "src/d.ts",
          symbols: [{ name: "base", line: 1, col: 14 }, { name: "alias" }],
        },
      ],
    });
  });

  it("treats empty output as a failed run, not 'no duplicate exports'", () => {
    expect(parseKnipDuplicates("   ").ok).toBe(false);
  });

  it("reports invalid JSON as a parse failure", () => {
    expect(parseKnipDuplicates("not json").ok).toBe(false);
  });
});

// --- buildKnipDuplicateFindings --------------------------------------------

const GROUPS: readonly KnipDuplicateExportGroup[] = [
  {
    file: "src/b.ts",
    symbols: [
      { name: "beta", line: 1, col: 14 },
      { name: "betaAlias", line: 2, col: 14 },
    ],
  },
  {
    file: "src/a.ts",
    symbols: [
      { name: "alpha", line: 1, col: 14 },
      { name: "default", line: 2, col: 16 },
    ],
  },
];

describe("buildKnipDuplicateFindings", () => {
  it("builds a provenance-stamped finding per duplicate export group in current scope", () => {
    const findings = buildKnipDuplicateFindings(
      GROUPS,
      currentScope(["src/a.ts", "src/b.ts"]),
      PROVENANCE,
    );

    expect(findings.map((finding) => finding.file)).toEqual(["src/a.ts", "src/b.ts"]);
    for (const finding of findings) {
      expect(finding.check).toBe("knip-duplicates");
      expect(finding.provenance).toEqual(PROVENANCE);
      expect(finding.details?.category).toBe("duplicates");
      expect(finding.details?.symbols).toBeDefined();
      expect(finding.message).toContain("duplicate export aliases");
    }
  });

  it("intersects duplicate groups with the changed set in changed scope", () => {
    const findings = buildKnipDuplicateFindings(
      GROUPS,
      changedScope([{ path: "src/a.ts", status: "modified" }]),
      PROVENANCE,
    );

    expect(findings.map((finding) => finding.file)).toEqual(["src/a.ts"]);
  });

  it("renders coordinate-free symbols without fake 0:0 locations", () => {
    const findings = buildKnipDuplicateFindings(
      [
        {
          file: "src/a.ts",
          symbols: [{ name: "base" }, { name: "alias", line: 0, col: 0 }],
        },
      ],
      currentScope(["src/a.ts"]),
      PROVENANCE,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("base (src/a.ts)");
    expect(findings[0]?.message).not.toContain(":0:0");
    expect(findings[0]?.details).toEqual({
      category: "duplicates",
      symbols: ["base", "alias"],
      symbolCount: 2,
    });
  });
});

// --- knipDuplicatesCheck ----------------------------------------------------

describe("knipDuplicatesCheck", () => {
  it("skips no-target-config on a repo without a knip config", () => {
    const outcome = knipDuplicatesCheck.runWithSelectedConfig(makeInput());
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("no-target-config");
  });

  it("skips target-not-installed when a config exists but node_modules does not", () => {
    const outcome = knipDuplicatesCheck.runWithSelectedConfig(
      makeInput({ pathExists: pathExistsFor(["knip.config.ts"]) }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("target-not-installed");
  });

  it("reports provenance-stamped duplicate export findings from the fixture", () => {
    const outcome = knipDuplicatesCheck.runWithSelectedConfig(
      makeInput({
        detectorScope: currentScope(["src/symbols.ts"]),
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: knipReporting(DUPLICATES_FIXTURE),
      }),
    );

    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.check).toBe("knip-duplicates");
      expect(outcome.findings[0]?.provenance).toEqual(PROVENANCE);
      expect(outcome.findings[0]?.details).toEqual({
        category: "duplicates",
        symbols: ["publicValue", "aliasValue", "default"],
        symbolCount: 3,
      });
    }
  });
});

// --- formatText provenance tag ---------------------------------------------

describe("formatText provenance tag (knip-duplicates)", () => {
  it("tags knip-duplicates findings with their configSource", () => {
    const report: DriftReport = {
      schemaVersion: DRIFT_SCHEMA_VERSION,
      scopeMode: "current",
      base: null,
      resolvedRef: null,
      roots: [],
      configPath: null,
      enabledChecks: ["knip-duplicates"],
      skippedChecks: [],
      summary: { total: 1, byCheck: { "knip-duplicates": 1 } },
      findings: [
        {
          check: "knip-duplicates",
          file: "src/symbols.ts",
          message: "duplicate export aliases publicValue and aliasValue",
          details: { category: "duplicates", symbols: ["publicValue", "aliasValue"] },
          provenance: { configSource: "target-config", tool: "knip", configPath: "knip.config.ts" },
        },
      ],
      scopeCount: 0,
      scope: [],
    };

    const text = formatText(report);
    expect(text).toContain("WARN knip-duplicates: src/symbols.ts — ");
    expect(text).toContain("[target-config]");
  });
});
