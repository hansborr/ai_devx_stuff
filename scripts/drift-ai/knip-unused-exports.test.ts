import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { PathProbe } from "./adapter-support.js";
import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import type { FileReader } from "./comments.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import { orphanFilesCheck } from "./knip-orphan-files-check.js";
import {
  clearKnipRunCache,
  KNIP_FILE_INCLUDE_CATEGORIES,
  KNIP_INCLUDE_CATEGORIES,
  KNIP_SYMBOL_INCLUDE_CATEGORIES,
  type KnipRunner,
  type KnipRunResult,
  memoizingDefaultKnipRunner,
} from "./knip-runner.js";
import {
  buildUnusedExportFindings,
  parseKnipUnusedExports,
  type UnusedExportSymbol,
} from "./knip-unused-exports.js";
import { unusedExportsCheck } from "./knip-unused-exports-check.js";
import { formatText } from "./report-format.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile, toCurrentScopeFile } from "./scope.js";
import { type ChangedFile, DRIFT_SCHEMA_VERSION, type DriftReport } from "./types.js";

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

// The committed fixture is captured verbatim from knip 6.14.1 `--reporter json
// --include files,exports,types,enumMembers,namespaceMembers` against a temp
// project with one deliberately-unused symbol per category plus a coexisting
// orphan file (so the single full-include spawn feeds both checks).
const UNUSED_EXPORTS_FIXTURE = readFileSync(
  path.join(FIXTURE_DIR, "knip-report.unused-exports.json"),
  "utf8",
);

// --- fakes ------------------------------------------------------------------

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
  readonly knipConfigOverride?: string | null;
  readonly roots?: readonly string[];
};

type FakeTargetKnip = {
  readonly argsFile: string;
  readonly repoRoot: string;
  readonly targetBin: string;
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

function makeInput(
  check: "unused-exports" | "orphan-files",
  overrides: CtxOverrides = {},
): CheckRunInput {
  return {
    ...RUN_STATE,
    roots: overrides.roots ?? RUN_STATE.roots,
    detectorScope: overrides.detectorScope ?? { scopeMode: "current", files: [] },
    env: {
      repoRoot: "/repo/target",
      overrides: {
        knip: overrides.knip ?? knipReporting('{"issues":[]}', 0),
        readFile: overrides.readFile ?? (() => undefined),
        pathExists: overrides.pathExists ?? (() => false),
      },
      cli: parseArgs([
        "--scope",
        "current",
        "--check",
        check,
        ...(overrides.knipConfigOverride == null
          ? []
          : ["--knip-config", overrides.knipConfigOverride]),
      ]),
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

function withFakeTargetKnip(run: (fixture: FakeTargetKnip) => void): void {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "drift-ai-knip-"));
  const binDir = path.join(repoRoot, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const argsFile = path.join(repoRoot, "knip-args.log");
  const targetBin = path.join(binDir, "knip");
  writeFileSync(argsFile, "");
  writeFileSync(
    targetBin,
    [
      "#!/usr/bin/env node",
      'const { appendFileSync } = require("node:fs");',
      `const argsFile = ${JSON.stringify(argsFile)};`,
      "appendFileSync(argsFile, `${JSON.stringify(process.argv.slice(2))}\\n`);",
      "process.stdout.write('{\"issues\":[]}');",
    ].join("\n"),
    { mode: 0o755 },
  );

  try {
    run({ argsFile, repoRoot, targetBin });
  } finally {
    clearKnipRunCache();
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

function makeDefaultKnipInput(fixture: FakeTargetKnip, argv: readonly string[]): CheckRunInput {
  return {
    ...RUN_STATE,
    repoRoot: fixture.repoRoot,
    detectorScope: { scopeMode: "current", files: [] },
    env: {
      repoRoot: fixture.repoRoot,
      overrides: {
        binExists: (candidate) => candidate === fixture.targetBin,
        readFile: () => undefined,
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
      },
      cli: parseArgs(["--scope", "current", ...argv]),
    },
  };
}

function readCapturedKnipArgs(argsFile: string): readonly (readonly string[])[] {
  const text = readFileSync(argsFile, "utf8").trim();
  if (text.length === 0) return [];
  return text.split("\n").map(parseCapturedKnipArgs);
}

function parseCapturedKnipArgs(line: string): readonly string[] {
  const parsed: unknown = JSON.parse(line);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error(`invalid captured knip args: ${line}`);
  }
  return parsed;
}

function expectedKnipArgs(includeCategories: string): readonly string[] {
  return [
    "--reporter",
    "json",
    "--include",
    includeCategories,
    "--no-progress",
    "--config",
    "knip.config.ts",
  ];
}

const PROVENANCE = {
  configSource: "target-config",
  tool: "knip",
  configPath: "knip.config.ts",
} as const;

// --- parseKnipUnusedExports -------------------------------------------------

describe("parseKnipUnusedExports", () => {
  it("parses each symbol category from the confirmed knip 6.14.1 fixture shape", () => {
    const result = parseKnipUnusedExports(UNUSED_EXPORTS_FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byCategory = (category: UnusedExportSymbol["category"]) =>
      result.symbols.filter((s) => s.category === category);

    const exportSym = byCategory("exports");
    expect(exportSym).toEqual([
      { category: "exports", file: "src/symbols.ts", name: "neverImported", line: 1, col: 17 },
    ]);

    const typeSym = byCategory("types");
    expect(typeSym).toEqual([
      { category: "types", file: "src/symbols.ts", name: "NeverReferencedType", line: 4, col: 13 },
    ]);

    const enumSym = byCategory("enumMembers");
    expect(enumSym).toEqual([
      {
        category: "enumMembers",
        file: "src/symbols.ts",
        name: "Green",
        line: 7,
        col: 3,
        namespace: "Color",
      },
    ]);

    const nsSym = byCategory("namespaceMembers");
    expect(nsSym).toEqual([
      {
        category: "namespaceMembers",
        file: "src/symbols.ts",
        name: "unusedConst",
        line: 11,
        col: 16,
        namespace: "Geometry",
      },
    ]);
  });

  it("ignores the file-level `files` category (orphan-files owns it)", () => {
    const result = parseKnipUnusedExports(UNUSED_EXPORTS_FIXTURE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // src/orphan.ts is a `files` row with all symbol categories empty.
    expect(result.symbols.some((s) => s.file === "src/orphan.ts")).toBe(false);
  });

  it("returns an empty list for a clean run", () => {
    expect(parseKnipUnusedExports('{"issues":[]}')).toEqual({ ok: true, symbols: [] });
  });

  it("tolerates a row missing a category key entirely (subset --include)", () => {
    const json = '{"issues":[{"file":"src/a.ts","exports":[{"name":"x","line":3,"col":1}]}]}';
    const result = parseKnipUnusedExports(json);
    expect(result).toEqual({
      ok: true,
      symbols: [{ category: "exports", file: "src/a.ts", name: "x", line: 3, col: 1 }],
    });
  });

  it("omits malformed symbol locations instead of fabricating 0:0 coordinates", () => {
    const malformedItems = [
      { name: "missingLine", col: 1 },
      { name: "stringLine", line: "3", col: 1 },
      { name: "zeroLine", line: 0, col: 1 },
      { name: "negativeLine", line: -1, col: 1 },
      { name: "fractionalLine", line: 1.5, col: 1 },
      { name: "nullLine", line: null, col: 1 },
      { name: "missingCol", line: 2 },
      { name: "stringCol", line: 2, col: "1" },
      { name: "zeroCol", line: 2, col: 0 },
      { name: "negativeCol", line: 2, col: -1 },
      { name: "fractionalCol", line: 2, col: 1.5 },
      { name: "nullCol", line: 2, col: null },
    ];
    const result = parseKnipUnusedExports(
      JSON.stringify({ issues: [{ file: "src/a.ts", exports: malformedItems }] }),
    );

    expect(result).toEqual({
      ok: true,
      symbols: malformedItems.map((item) => ({
        category: "exports",
        file: "src/a.ts",
        name: item.name,
      })),
    });
  });

  it("treats empty output as a failed run, not 'no unused exports'", () => {
    expect(parseKnipUnusedExports("   ").ok).toBe(false);
  });

  it("reports invalid JSON as a parse failure", () => {
    expect(parseKnipUnusedExports("not json").ok).toBe(false);
  });
});

// --- buildUnusedExportFindings ----------------------------------------------

const SYMBOLS: readonly UnusedExportSymbol[] = [
  { category: "exports", file: "src/b.ts", name: "beta", line: 2, col: 1 },
  { category: "types", file: "src/a.ts", name: "Alpha", line: 5, col: 13 },
  {
    category: "enumMembers",
    file: "src/a.ts",
    name: "Red",
    line: 9,
    col: 3,
    namespace: "Color",
  },
];

describe("buildUnusedExportFindings", () => {
  it("builds a category-tagged, provenance-stamped finding per symbol in current scope", () => {
    const findings = buildUnusedExportFindings(
      SYMBOLS,
      currentScope(["src/a.ts", "src/b.ts"]),
      PROVENANCE,
    );
    expect(findings.map((f) => f.file)).toEqual(["src/a.ts", "src/a.ts", "src/b.ts"]);
    for (const finding of findings) {
      expect(finding.check).toBe("unused-exports");
      expect(finding.provenance).toEqual(PROVENANCE);
    }
    // category-specific messages + details.category tag
    const exportFinding = findings.find((f) => f.details?.category === "exports");
    expect(exportFinding?.message).toContain("exported symbol beta");
    expect(exportFinding?.message).toContain("never imported");
    const typeFinding = findings.find((f) => f.details?.category === "types");
    expect(typeFinding?.message).toContain("exported type Alpha");
    expect(typeFinding?.message).toContain("never referenced");
    const enumFinding = findings.find((f) => f.details?.category === "enumMembers");
    expect(enumFinding?.message).toContain("enum member Color.Red");
    expect(enumFinding?.message).toContain("never used");
    expect(enumFinding?.details?.namespace).toBe("Color");
  });

  it("intersects symbols with the changed set in changed scope", () => {
    const scope = changedScope([{ path: "src/a.ts", status: "added" }]);
    const findings = buildUnusedExportFindings(SYMBOLS, scope, PROVENANCE);
    expect(findings.every((f) => f.file === "src/a.ts")).toBe(true);
    expect(findings).toHaveLength(2);
  });

  it("scopes current symbols to detector scope files (drops out-of-scope files)", () => {
    const findings = buildUnusedExportFindings(SYMBOLS, currentScope(["src/a.ts"]), PROVENANCE);
    expect(findings.map((f) => f.file)).toEqual(["src/a.ts", "src/a.ts"]);
    expect(findings.some((f) => f.file === "src/b.ts")).toBe(false);
  });

  it("renders coordinate-free symbols without fake details or 0:0 text", () => {
    const findings = buildUnusedExportFindings(
      [{ category: "exports", file: "src/a.ts", name: "loose" }],
      currentScope(["src/a.ts"]),
      PROVENANCE,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("exported symbol loose (src/a.ts) is never imported");
    expect(findings[0]?.message).not.toContain(":0:0");
    expect(findings[0]?.details).toEqual({ category: "exports", symbol: "loose" });
  });

  it("does not render partial symbol locations as precise coordinates", () => {
    const findings = buildUnusedExportFindings(
      [{ category: "exports", file: "src/a.ts", name: "partial", line: 3 }],
      currentScope(["src/a.ts"]),
      PROVENANCE,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("exported symbol partial (src/a.ts) is never imported");
    expect(findings[0]?.message).not.toContain("src/a.ts:3");
    expect(findings[0]?.details).toEqual({ category: "exports", symbol: "partial" });
  });

  it("does not render invalid direct symbol locations as precise coordinates", () => {
    const findings = buildUnusedExportFindings(
      [
        { category: "exports", file: "src/a.ts", name: "zeroLine", line: 0, col: 1 },
        { category: "exports", file: "src/a.ts", name: "negativeCol", line: 2, col: -1 },
        { category: "exports", file: "src/a.ts", name: "fractionalLine", line: 1.5, col: 1 },
      ],
      currentScope(["src/a.ts"]),
      PROVENANCE,
    );

    expect(findings).toHaveLength(3);
    for (const finding of findings) {
      expect(finding.message).toContain(`exported symbol ${finding.details?.symbol} (src/a.ts)`);
      expect(finding.message).not.toContain("src/a.ts:");
      expect(finding.details).toEqual({ category: "exports", symbol: finding.details?.symbol });
    }
  });
});

// --- unusedExportsCheck (plugin) --------------------------------------------

describe("unusedExportsCheck", () => {
  it("skips no-target-config on a repo without a knip config (the common foreign case)", () => {
    const outcome = unusedExportsCheck.runWithSelectedConfig(makeInput("unused-exports"));
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("no-target-config");
  });

  it("does not name orphan-files in its no-config skip reason (it is the shared knip ladder)", () => {
    const outcome = unusedExportsCheck.runWithSelectedConfig(makeInput("unused-exports"));
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") {
      expect(outcome.reason).not.toContain("orphan-files");
      expect(outcome.reason).toContain("knip config");
    }
  });

  it("skips target-not-installed when a config exists but node_modules does not", () => {
    const outcome = unusedExportsCheck.runWithSelectedConfig(
      makeInput("unused-exports", { pathExists: pathExistsFor(["knip.config.ts"]) }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("target-not-installed");
  });

  it("skips tool-not-installed when knip is unresolved in the tools checkout", () => {
    const outcome = unusedExportsCheck.runWithSelectedConfig(
      makeInput("unused-exports", {
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: () => ({ ok: false, reason: "tool-unavailable", error: "searched ..." }),
      }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("tool-not-installed");
  });

  it("skips tool-timeout when knip exceeds the configured timeout", () => {
    const outcome = unusedExportsCheck.runWithSelectedConfig(
      makeInput("unused-exports", {
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: () => ({
          ok: false,
          reason: "timeout",
          error: "timeout of 600000ms",
        }),
      }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") {
      expect(outcome.code).toBe("tool-timeout");
      expect(outcome.reason).toContain("knip exceeded the configured timeout");
    }
  });

  it("emits a single unused-exports diagnostic finding when knip cannot be spawned", () => {
    const outcome = unusedExportsCheck.runWithSelectedConfig(
      makeInput("unused-exports", {
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: () => ({ ok: false, reason: "spawn-failed", error: "EACCES" }),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.check).toBe("unused-exports");
      expect(outcome.findings[0]?.message).toContain("knip subprocess failed");
      expect(outcome.findings[0]?.provenance).toBeUndefined();
    }
  });

  it("emits a single diagnostic finding when knip output is unparseable", () => {
    const outcome = unusedExportsCheck.runWithSelectedConfig(
      makeInput("unused-exports", {
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: knipReporting("<<garbage>>", 2),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.check).toBe("unused-exports");
      expect(outcome.findings[0]?.message).toContain("unreadable JSON");
    }
  });

  it("reports provenance-stamped, category-tagged symbol findings from the fixture", () => {
    const outcome = unusedExportsCheck.runWithSelectedConfig(
      makeInput("unused-exports", {
        detectorScope: currentScope(["src/symbols.ts", "src/orphan.ts"]),
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: knipReporting(UNUSED_EXPORTS_FIXTURE),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      // 4 symbol findings (one per category); the orphan file row is NOT reported.
      expect(outcome.findings).toHaveLength(4);
      expect(outcome.findings.every((f) => f.file === "src/symbols.ts")).toBe(true);
      const categories = outcome.findings.map((f) => f.details?.category).sort();
      expect(categories).toEqual(["enumMembers", "exports", "namespaceMembers", "types"]);
      for (const finding of outcome.findings) {
        expect(finding.provenance).toEqual({
          configSource: "target-config",
          tool: "knip",
          configPath: "knip.config.ts",
        });
      }
    }
  });
});

// --- formatText provenance tag ----------------------------------------------

describe("formatText provenance tag (unused-exports)", () => {
  it("tags unused-exports findings with their configSource so they read as the target's verdict", () => {
    const report: DriftReport = {
      schemaVersion: DRIFT_SCHEMA_VERSION,
      scopeMode: "current",
      base: null,
      resolvedRef: null,
      roots: [],
      configPath: null,
      enabledChecks: ["unused-exports"],
      skippedChecks: [],
      summary: { total: 1, byCheck: { "unused-exports": 1 } },
      findings: [
        {
          check: "unused-exports",
          file: "src/symbols.ts",
          message: "exported symbol neverImported (src/symbols.ts:1:17) is never imported",
          details: { category: "exports", symbol: "neverImported", line: 1, col: 17 },
          provenance: { configSource: "target-config", tool: "knip", configPath: "knip.config.ts" },
        },
      ],
      scopeCount: 0,
      scope: [],
    };
    const text = formatText(report);
    expect(text).toContain("WARN unused-exports: src/symbols.ts — ");
    expect(text).toContain("[target-config]");
  });
});

// --- selected-check include categories --------------------------------------

describe("knip service resolver include categories", () => {
  it("uses file-only knip categories for orphan-files-only runs", () => {
    withFakeTargetKnip((fixture) => {
      clearKnipRunCache();
      const outcome = orphanFilesCheck.runWithSelectedConfig(
        makeDefaultKnipInput(fixture, ["--check", "orphan-files"]),
      );

      expect(outcome.status).toBe("ran");
      expect(readCapturedKnipArgs(fixture.argsFile)).toEqual([
        expectedKnipArgs(KNIP_FILE_INCLUDE_CATEGORIES),
      ]);
    });
  });

  it("uses symbol-only knip categories for unused-exports-only runs", () => {
    withFakeTargetKnip((fixture) => {
      clearKnipRunCache();
      const outcome = unusedExportsCheck.runWithSelectedConfig(
        makeDefaultKnipInput(fixture, ["--check", "unused-exports"]),
      );

      expect(outcome.status).toBe("ran");
      expect(readCapturedKnipArgs(fixture.argsFile)).toEqual([
        expectedKnipArgs(KNIP_SYMBOL_INCLUDE_CATEGORIES),
      ]);
    });
  });

  it("uses the full category set and one spawn when both knip checks are selected", () => {
    withFakeTargetKnip((fixture) => {
      clearKnipRunCache();
      const input = makeDefaultKnipInput(fixture, [
        "--check",
        "orphan-files",
        "--check",
        "unused-exports",
      ]);

      const orphanOutcome = orphanFilesCheck.runWithSelectedConfig(input);
      const unusedOutcome = unusedExportsCheck.runWithSelectedConfig(input);

      expect(orphanOutcome.status).toBe("ran");
      expect(unusedOutcome.status).toBe("ran");
      expect(readCapturedKnipArgs(fixture.argsFile)).toEqual([
        expectedKnipArgs(KNIP_INCLUDE_CATEGORIES),
      ]);
    });
  });

  it("uses the full category set for --check all", () => {
    withFakeTargetKnip((fixture) => {
      clearKnipRunCache();
      const outcome = orphanFilesCheck.runWithSelectedConfig(
        makeDefaultKnipInput(fixture, ["--check", "all"]),
      );

      expect(outcome.status).toBe("ran");
      expect(readCapturedKnipArgs(fixture.argsFile)).toEqual([
        expectedKnipArgs(KNIP_INCLUDE_CATEGORIES),
      ]);
    });
  });
});

// --- single-spawn memoization -----------------------------------------------

describe("memoizingDefaultKnipRunner", () => {
  it("spawns knip once for both checks sharing repo+bin+config (single-spawn memo)", () => {
    clearKnipRunCache();
    let spawnCount = 0;
    // Stands in for the spawned subprocess; the memo wraps this, so a shared key
    // across the two checks' independently-built runners means one underlying call.
    const underlyingRunner: KnipRunner = () => {
      spawnCount += 1;
      return { ok: true, reportJson: UNUSED_EXPORTS_FIXTURE, exitCode: 1, stderr: "" };
    };
    const orphanRunner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      knipBin: "/bin/knip",
      underlyingRunner,
    });
    const unusedRunner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      knipBin: "/bin/knip",
      underlyingRunner,
    });
    // Each check calls its runner once for the same resolved config.
    const a = orphanRunner({ configPath: "knip.config.ts" });
    const b = unusedRunner({ configPath: "knip.config.ts" });
    expect(spawnCount).toBe(1);
    expect(a).toEqual(b);
  });

  it("does not persist across report builds — a report-boundary clear re-spawns (no stale report)", () => {
    // The cache is bounded to ONE report build: buildReport calls clearKnipRunCache
    // before each build. This guards a long-lived library caller (runDriftAi ->
    // edit files/knip config -> runDriftAi) from getting the OLD knip JSON for the
    // same (repoRoot, bin, configPath) key. We model two builds against an
    // underlying runner whose report CHANGES between them; without the boundary
    // clear the second build would serve build #1's stale report.
    let spawnCount = 0;
    let currentReport = '{"issues":[{"file":"src/a.ts","files":[{"name":"src/a.ts"}]}]}';
    const underlyingRunner: KnipRunner = () => {
      spawnCount += 1;
      return { ok: true, reportJson: currentReport, exitCode: 1, stderr: "" };
    };
    const buildOnce = (): KnipRunResult => {
      // Both checks build their own memoizing runner for the same key within a
      // build; the first spawns, the second reuses the cached result.
      const orphan = memoizingDefaultKnipRunner({
        analyzedRepoRoot: "/repo/target",
        knipBin: "/bin/knip",
        underlyingRunner,
      });
      const unused = memoizingDefaultKnipRunner({
        analyzedRepoRoot: "/repo/target",
        knipBin: "/bin/knip",
        underlyingRunner,
      });
      const first = orphan({ configPath: "knip.config.ts" });
      const second = unused({ configPath: "knip.config.ts" });
      expect(first).toEqual(second); // single spawn shared within the build
      return first;
    };

    // Build #1 (the report-boundary clear buildReport performs at the start of a build).
    clearKnipRunCache();
    const build1 = buildOnce();
    expect(spawnCount).toBe(1);
    if (build1.ok) expect(build1.reportJson).toContain("src/a.ts");

    // The caller edits a file between runs; knip would now report differently.
    currentReport = '{"issues":[{"file":"src/b.ts","files":[{"name":"src/b.ts"}]}]}';

    // Build #2 starts fresh (boundary clear) and re-spawns, seeing the NEW report.
    clearKnipRunCache();
    const build2 = buildOnce();
    expect(spawnCount).toBe(2);
    if (build2.ok) {
      expect(build2.reportJson).toContain("src/b.ts");
      expect(build2.reportJson).not.toContain("src/a.ts"); // not the stale cached report
    }
  });

  it("spawns again for a different config (the memo key includes configPath)", () => {
    clearKnipRunCache();
    let spawnCount = 0;
    const underlyingRunner: KnipRunner = ({ configPath }) => {
      spawnCount += 1;
      return {
        ok: true,
        reportJson: `{"issues":[]}::${configPath ?? "auto"}`,
        exitCode: 0,
        stderr: "",
      };
    };
    const runner = memoizingDefaultKnipRunner({
      analyzedRepoRoot: "/repo/target",
      knipBin: "/bin/knip",
      underlyingRunner,
    });
    runner({ configPath: "a.ts" });
    runner({ configPath: "b.ts" });
    expect(spawnCount).toBe(2);
  });

  it("injected service runners bypass the memo entirely (each is its own source of truth)", () => {
    clearKnipRunCache();
    // The plugins resolve env.overrides.knip directly (see resolveServices), so an
    // injected runner never passes through memoizingDefaultKnipRunner. Both checks
    // run with their own injected fakes and neither touches the shared cache: two
    // distinct reports come back, proving no cross-check cache bleed.
    const orphanOutcome = orphanFilesCheck.runWithSelectedConfig(
      makeInput("orphan-files", {
        detectorScope: currentScope(["src/orphan.ts"]),
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: knipReporting(UNUSED_EXPORTS_FIXTURE),
      }),
    );
    const unusedOutcome = unusedExportsCheck.runWithSelectedConfig(
      makeInput("unused-exports", {
        detectorScope: currentScope(["src/symbols.ts"]),
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: knipReporting('{"issues":[]}', 0),
      }),
    );
    expect(orphanOutcome.status).toBe("ran");
    expect(unusedOutcome.status).toBe("ran");
    // orphan-files sees the orphan from its injected report; unused-exports sees
    // nothing from its own (different) injected report — no shared cache.
    if (orphanOutcome.status === "ran") {
      expect(orphanOutcome.findings.map((f) => f.file)).toEqual(["src/orphan.ts"]);
    }
    if (unusedOutcome.status === "ran") expect(unusedOutcome.findings).toEqual([]);
  });
});
