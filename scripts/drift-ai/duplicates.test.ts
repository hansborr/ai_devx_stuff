import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { ChangedFile } from "../drift-ai.js";
import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG, parseDriftAiConfig } from "./config.js";
import {
  buildDuplicatesFindings,
  DEFAULT_DUPLICATES_IGNORE_GLOBS,
  DEFAULT_DUPLICATES_MIN_LINES,
  DEFAULT_DUPLICATES_MIN_TOKENS,
  DEFAULT_DUPLICATES_MODE,
  DUPLICATE_REPAIR_HINT,
  filterClonesToChangedFiles,
  JSCPD_SUPPORTED_EXTENSIONS,
  type JscpdClone,
  mapChangedFilesToScopes,
  normalizeReportPath,
  parseDuplicatesReport,
  SAME_FILE_DUPLICATE_REPAIR_HINT,
} from "./duplicates.js";
import { duplicatesCheck } from "./duplicates-check.js";
import {
  DEFAULT_JSCPD_TIMEOUT_MS,
  defaultJscpdRunner,
  type JscpdRunner,
  type JscpdRunnerInput,
  type JscpdSpawn,
  LARGE_INVENTORY_WARNING_THRESHOLD,
  runDuplicatesCheck,
} from "./duplicates-runner.js";
import { resolveJscpdBin } from "./jscpd-bin.js";
import { stringContaining } from "./matcher.test-helper.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile, toCurrentScopeFile } from "./scope.js";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function makeClone(a: string, b: string, lines = 10): JscpdClone {
  return {
    lines,
    firstFile: { name: a, start: 1, end: lines },
    secondFile: { name: b, start: 1, end: lines },
  };
}

function parsedReport(jsonText: string): { readonly duplicates: readonly JscpdClone[] } {
  const result = parseDuplicatesReport(jsonText);
  if (!result.ok) throw new Error(`expected readable jscpd JSON: ${result.error}`);
  return result.report;
}

function changedDetectorScope(files: readonly ChangedFile[]): DetectorScope {
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

function currentDetectorScope(files: readonly string[]): DetectorScope {
  return { scopeMode: "current", files: files.map(toCurrentScopeFile) };
}

function makeDuplicatesPluginInput(options: {
  readonly argv?: readonly string[];
  readonly binExists?: (candidate: string) => boolean;
  readonly warnStderr?: (message: string) => void;
}): CheckRunInput {
  return {
    detectorScope: currentDetectorScope([]),
    inventoryByDir: null,
    repoRoot: "/repo/target",
    suppressionDiffRef: null,
    config: DEFAULT_DRIFT_AI_CONFIG,
    roots: [],
    sourceExtensions: buildSourceExtensions([]),
    warnStderr: options.warnStderr ?? (() => undefined),
    env: {
      repoRoot: "/repo/target",
      overrides: {
        ...(options.binExists === undefined ? {} : { binExists: options.binExists }),
      },
      cli: parseArgs(["--scope", "current", "--check", "duplicates", ...(options.argv ?? [])]),
      warnStderr: options.warnStderr ?? (() => undefined),
    },
  };
}

describe("parseDuplicatesReport", () => {
  it("parses jscpd-report.basic.json into typed clones", () => {
    const report = parsedReport(readFixture("jscpd-report.basic.json"));
    expect(report.duplicates).toHaveLength(3);
    const first = report.duplicates[0];
    expect(first?.lines).toBe(29);
    expect(first?.format).toBe("typescript");
    expect(first?.firstFile).toEqual({
      name: "packages/server/src/utils/character-auth.ts",
      start: 40,
      end: 68,
    });
    expect(first?.secondFile).toEqual({
      name: "packages/server/src/utils/campaign-auth.ts",
      start: 22,
      end: 50,
    });
  });

  it("returns an unreadable result for empty or whitespace input", () => {
    expect(parseDuplicatesReport("")).toEqual({
      ok: false,
      error: "expected non-empty JSON report",
    });
    expect(parseDuplicatesReport("   \n\t")).toEqual({
      ok: false,
      error: "expected non-empty JSON report",
    });
  });

  it("returns an unreadable result for malformed JSON", () => {
    const result = parseDuplicatesReport("{not json");
    if (result.ok) throw new Error("expected malformed JSON to be unreadable");
    expect(result.error.length).toBeGreaterThan(0);
  });

  it("requires a top-level duplicates array", () => {
    expect(parseDuplicatesReport("{}")).toEqual({
      ok: false,
      error: "expected required 'duplicates' array property",
    });
    expect(parseDuplicatesReport(JSON.stringify({ duplicates: "oops" }))).toEqual({
      ok: false,
      error: "expected 'duplicates' to be an array",
    });
  });

  it("returns an unreadable result when the report root is not an object", () => {
    expect(parseDuplicatesReport("[]")).toEqual({
      ok: false,
      error: "expected JSON object root",
    });
    expect(parseDuplicatesReport("null")).toEqual({
      ok: false,
      error: "expected JSON object root",
    });
  });

  it("skips clone entries that are missing required fields", () => {
    const report = parsedReport(
      JSON.stringify({
        duplicates: [
          { lines: 12 },
          {
            lines: 12,
            firstFile: { name: "a.ts", start: 1 },
            secondFile: { name: "b.ts", start: 1, end: 5 },
          },
          {
            lines: 12,
            firstFile: { name: "a.ts", start: 1, end: 5 },
            secondFile: { name: "b.ts", start: 1, end: 5 },
          },
        ],
      }),
    );
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]?.firstFile.name).toBe("a.ts");
  });
});

describe("duplicates configuration", () => {
  it("defaults to the selected single advisory profile", () => {
    expect(parseDriftAiConfig({}).checks.duplicates).toEqual({
      minLines: 8,
      minTokens: 60,
      mode: "mild",
      excludeGlobs: [],
    });
  });

  it("parses the jscpd line, token, and normalization controls", () => {
    expect(
      parseDriftAiConfig({
        checks: { duplicates: { minLines: 10, minTokens: 50, mode: "weak" } },
      }).checks.duplicates,
    ).toEqual({ minLines: 10, minTokens: 50, mode: "weak", excludeGlobs: [] });
  });

  it("rejects invalid token floors and modes", () => {
    expect(() => parseDriftAiConfig({ checks: { duplicates: { minTokens: 0 } } })).toThrow(
      /minTokens.*positive integer/u,
    );
    expect(() => parseDriftAiConfig({ checks: { duplicates: { mode: "strict" } } })).toThrow(
      /mode.*mild.*weak/u,
    );
  });
});

describe("normalizeReportPath", () => {
  it("strips leading ./ segments", () => {
    expect(normalizeReportPath("./packages/server/src/foo.ts")).toBe("packages/server/src/foo.ts");
    expect(normalizeReportPath("././packages/server/src/foo.ts")).toBe(
      "packages/server/src/foo.ts",
    );
  });

  it("leaves already-relative POSIX paths alone", () => {
    expect(normalizeReportPath("packages/server/src/foo.ts")).toBe("packages/server/src/foo.ts");
  });
});

describe("filterClonesToChangedFiles", () => {
  it("keeps clones where either side is in the changed set", () => {
    const changed = new Set(["packages/server/src/foo.ts"]);
    const kept = filterClonesToChangedFiles(
      [
        makeClone("packages/server/src/foo.ts", "packages/server/src/bar.ts"),
        makeClone("packages/server/src/bar.ts", "packages/server/src/foo.ts"),
        makeClone("packages/server/src/baz.ts", "packages/server/src/qux.ts"),
      ],
      changed,
    );
    expect(kept).toHaveLength(2);
  });

  it("drops clones where neither side is changed", () => {
    expect(
      filterClonesToChangedFiles(
        [makeClone("packages/server/src/baz.ts", "packages/server/src/qux.ts")],
        new Set(["packages/server/src/foo.ts"]),
      ),
    ).toEqual([]);
  });

  it("normalizes leading ./ in report paths before matching", () => {
    expect(
      filterClonesToChangedFiles(
        [makeClone("./packages/server/src/foo.ts", "packages/server/src/bar.ts")],
        new Set(["packages/server/src/foo.ts"]),
      ),
    ).toHaveLength(1);
  });

  it("drops clones whose paths cannot be normalized to repo-relative", () => {
    // Locks the contract that Leaf 2b must invoke jscpd with the default
    // `absolute: false`; absolute paths fail the changed-set membership check.
    expect(
      filterClonesToChangedFiles(
        [
          makeClone(
            "/workspace/packages/server/src/foo.ts",
            "/workspace/packages/server/src/bar.ts",
          ),
        ],
        new Set(["packages/server/src/foo.ts"]),
      ),
    ).toEqual([]);
  });
});

describe("buildDuplicatesFindings", () => {
  it("uses the changed side as the primary file with line range", () => {
    const findings = buildDuplicatesFindings(
      [
        {
          format: "typescript",
          lines: 29,
          firstFile: {
            name: "packages/server/src/utils/character-auth.ts",
            start: 40,
            end: 68,
          },
          secondFile: {
            name: "packages/server/src/utils/campaign-auth.ts",
            start: 22,
            end: 50,
          },
        },
      ],
      new Set(["packages/server/src/utils/character-auth.ts"]),
    );
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src/utils/character-auth.ts:40-68",
        message: "duplicates packages/server/src/utils/campaign-auth.ts:22-50 (29 lines)",
        hint: DUPLICATE_REPAIR_HINT,
        relatedFiles: ["packages/server/src/utils/campaign-auth.ts:22-50"],
      },
    ]);
  });

  it("swaps to put the changed side first when only the second file is changed", () => {
    const findings = buildDuplicatesFindings(
      [
        {
          lines: 12,
          firstFile: { name: "packages/server/src/a.ts", start: 1, end: 12 },
          secondFile: { name: "packages/server/src/b.ts", start: 30, end: 41 },
        },
      ],
      new Set(["packages/server/src/b.ts"]),
    );
    expect(findings[0]?.file).toBe("packages/server/src/b.ts:30-41");
    expect(findings[0]?.message).toBe("duplicates packages/server/src/a.ts:1-12 (12 lines)");
  });

  it("picks the lexically smaller path as primary when both sides changed", () => {
    const findings = buildDuplicatesFindings(
      [
        {
          lines: 10,
          firstFile: { name: "packages/server/src/b.ts", start: 5, end: 14 },
          secondFile: { name: "packages/server/src/a.ts", start: 7, end: 16 },
        },
      ],
      new Set(["packages/server/src/a.ts", "packages/server/src/b.ts"]),
    );
    expect(findings[0]?.file).toBe("packages/server/src/a.ts:7-16");
    expect(findings[0]?.message).toBe("duplicates packages/server/src/b.ts:5-14 (10 lines)");
  });

  it("skips clones where neither side is in the changed set", () => {
    const findings = buildDuplicatesFindings(
      [
        {
          lines: 10,
          firstFile: { name: "packages/server/src/x.ts", start: 1, end: 10 },
          secondFile: { name: "packages/server/src/y.ts", start: 1, end: 10 },
        },
      ],
      new Set(["packages/server/src/foo.ts"]),
    );
    expect(findings).toEqual([]);
  });

  it("emits the canonical repair hint on every finding", () => {
    const findings = buildDuplicatesFindings(
      [makeClone("packages/server/src/foo.ts", "packages/server/src/bar.ts")],
      new Set(["packages/server/src/foo.ts"]),
    );
    expect(findings[0]?.hint).toBe(DUPLICATE_REPAIR_HINT);
  });

  it("uses same-file wording and a local extraction hint for self repeats", () => {
    const findings = buildDuplicatesFindings(
      [
        {
          lines: 39,
          firstFile: { name: "packages/client/src/monster-form-fields.tsx", start: 436, end: 474 },
          secondFile: { name: "packages/client/src/monster-form-fields.tsx", start: 435, end: 473 },
        },
      ],
      new Set(["packages/client/src/monster-form-fields.tsx"]),
    );

    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/client/src/monster-form-fields.tsx:436-474",
        message: "repeats within the same file at lines 435-473 (39 lines)",
        hint: SAME_FILE_DUPLICATE_REPAIR_HINT,
        relatedFiles: ["packages/client/src/monster-form-fields.tsx:435-473"],
      },
    ]);
  });
});

describe("mapChangedFilesToScopes", () => {
  function changed(
    items: ReadonlyArray<{ path: string; status?: ChangedFile["status"] }>,
  ): ChangedFile[] {
    return items.map(({ path: p, status }) => ({ path: p, status: status ?? "modified" }));
  }

  it("infers source roots without a Musi-specific hard-coded map", () => {
    const scopes = mapChangedFilesToScopes(
      changed([
        { path: "packages/server/src/utils/character-auth.ts" },
        { path: "packages/server/src/services/foo.ts" },
        { path: "packages/shared/src/schemas/baz.ts" },
        { path: "packages/client/src/pages/bar.tsx" },
        { path: "scripts/drift-ai/duplicates.ts" },
        { path: "eslint-rules/no-barrel.js" },
      ]),
    );
    expect(scopes.map((scope) => [scope.key, scope.scopePath])).toEqual([
      ["eslint-rules", "eslint-rules"],
      ["packages/client/src", "packages/client/src"],
      ["packages/server/src", "packages/server/src"],
      ["packages/shared/src", "packages/shared/src"],
      ["scripts", "scripts"],
    ]);
    const server = scopes.find((scope) => scope.key === "packages/server/src");
    expect(server?.changedPaths).toEqual([
      "packages/server/src/utils/character-auth.ts",
      "packages/server/src/services/foo.ts",
    ]);
  });

  it("excludes deleted files, non-source files, and tests/fixtures/d.ts", () => {
    const scopes = mapChangedFilesToScopes(
      changed([
        { path: "packages/server/src/foo.ts" },
        { path: "packages/server/src/foo.test.ts" },
        { path: "packages/server/src/__tests__/bar.ts" },
        { path: "packages/server/src/fixtures/baz.ts" },
        { path: "packages/server/src/qux.fixture.ts" },
        { path: "packages/server/src/types.d.ts" },
        { path: "packages/server/src/style.css" },
        { path: "packages/server/src/removed.ts", status: "deleted" },
      ]),
    );
    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.changedPaths).toEqual(["packages/server/src/foo.ts"]);
  });

  it("uses configured roots when they contain changed files", () => {
    const scopes = mapChangedFilesToScopes(
      changed([
        { path: "packages/server/src/services/foo.ts" },
        { path: "packages/server/src/utils/bar.ts" },
      ]),
      { roots: ["packages", "packages/server/src/services"] },
    );
    expect(scopes.map((scope) => [scope.scopePath, scope.changedPaths])).toEqual([
      ["packages", ["packages/server/src/utils/bar.ts"]],
      ["packages/server/src/services", ["packages/server/src/services/foo.ts"]],
    ]);
  });

  it("uses a generic configured root for changed-mode duplicate scopes", () => {
    const scopes = mapChangedFilesToScopes(changed([{ path: "apps/api/src/foo.ts" }]), {
      roots: ["apps/api"],
    });
    expect(scopes).toEqual([
      {
        key: "apps/api",
        scopePath: "apps/api",
        changedPaths: ["apps/api/src/foo.ts"],
      },
    ]);
  });

  it("falls back to the inferred first segment when no configured roots match", () => {
    const scopes = mapChangedFilesToScopes(changed([{ path: "lib/foo.ts" }]), { roots: [] });
    expect(scopes).toEqual([
      {
        key: "lib",
        scopePath: "lib",
        changedPaths: ["lib/foo.ts"],
      },
    ]);
  });

  it("ignores non-source files after generic root inference", () => {
    expect(
      mapChangedFilesToScopes(
        changed([
          { path: "docs/agent_notes/STATUS.md" },
          { path: "node_modules/dep/styles.css" },
          { path: "packages/server/prisma/schema.prisma" },
          { path: "README.md" },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("runDuplicatesCheck", () => {
  const characterAuthChange: ChangedFile = {
    path: "packages/server/src/utils/character-auth.ts",
    status: "modified",
  };

  it("returns no findings and skips jscpd when no in-scope files changed", () => {
    let calls = 0;
    const runner: JscpdRunner = () => {
      calls += 1;
      return { ok: true, reportJson: '{"duplicates":[]}' };
    };
    const findings = runDuplicatesCheck({
      detectorScope: changedDetectorScope([
        { path: "docs/agent_notes/STATUS.md", status: "modified" },
        { path: "packages/server/src/types.d.ts", status: "modified" },
      ]),
      runner,
    });
    expect(findings).toEqual([]);
    expect(calls).toBe(0);
  });

  it("invokes the runner once per scope with the configured min-lines and ignore globs", () => {
    const inputs: JscpdRunnerInput[] = [];
    const runner: JscpdRunner = (input) => {
      inputs.push(input);
      return { ok: true, reportJson: '{"duplicates":[]}' };
    };
    runDuplicatesCheck({
      detectorScope: changedDetectorScope([
        characterAuthChange,
        { path: "scripts/drift-ai.ts", status: "modified" },
      ]),
      runner,
    });
    expect(inputs).toEqual([
      {
        scopePath: "packages/server/src",
        minLines: DEFAULT_DUPLICATES_MIN_LINES,
        minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
        mode: DEFAULT_DUPLICATES_MODE,
        ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
      },
      {
        scopePath: "scripts",
        minLines: DEFAULT_DUPLICATES_MIN_LINES,
        minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
        mode: DEFAULT_DUPLICATES_MODE,
        ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
      },
    ]);
  });

  it("converts changed-side clones into duplicate findings", () => {
    const runner: JscpdRunner = () => ({
      ok: true,
      reportJson: JSON.stringify({
        duplicates: [
          {
            format: "typescript",
            lines: 29,
            firstFile: {
              name: "packages/server/src/utils/character-auth.ts",
              start: 40,
              end: 68,
            },
            secondFile: {
              name: "packages/server/src/utils/campaign-auth.ts",
              start: 22,
              end: 50,
            },
          },
          {
            format: "typescript",
            lines: 12,
            firstFile: {
              name: "packages/server/src/services/example.ts",
              start: 1,
              end: 12,
            },
            secondFile: {
              name: "packages/server/src/services/other.ts",
              start: 1,
              end: 12,
            },
          },
        ],
      }),
    });
    const findings = runDuplicatesCheck({
      detectorScope: changedDetectorScope([characterAuthChange]),
      runner,
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src/utils/character-auth.ts:40-68",
        message: "duplicates packages/server/src/utils/campaign-auth.ts:22-50 (29 lines)",
        hint: DUPLICATE_REPAIR_HINT,
        relatedFiles: ["packages/server/src/utils/campaign-auth.ts:22-50"],
      },
    ]);
  });

  it("emits a failure finding when the runner returns ok:false and continues other scopes", () => {
    const runner: JscpdRunner = ({ scopePath }) =>
      scopePath === "packages/server/src"
        ? { ok: false, error: "boom" }
        : { ok: true, reportJson: '{"duplicates":[]}' };
    const findings = runDuplicatesCheck({
      detectorScope: changedDetectorScope([
        characterAuthChange,
        { path: "scripts/foo.ts", status: "modified" },
      ]),
      runner,
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: "jscpd subprocess failed (boom)",
        hint: stringContaining("Re-run drift:ai locally"),
      },
    ]);
  });

  it("respects caller overrides for minLines and ignoreGlobs", () => {
    const inputs: JscpdRunnerInput[] = [];
    const runner: JscpdRunner = (input) => {
      inputs.push(input);
      return { ok: true, reportJson: '{"duplicates":[]}' };
    };
    runDuplicatesCheck({
      detectorScope: changedDetectorScope([characterAuthChange]),
      runner,
      minLines: 10,
      minTokens: 50,
      mode: "weak",
      ignoreGlobs: ["**/*.snap"],
    });
    expect(inputs[0]).toEqual({
      scopePath: "packages/server/src",
      minLines: 10,
      minTokens: 50,
      mode: "weak",
      ignoreGlobs: ["**/*.snap"],
    });
  });

  it("surfaces malformed jscpd JSON as a warning finding in changed mode", () => {
    const findings = runDuplicatesCheck({
      detectorScope: changedDetectorScope([characterAuthChange]),
      runner: () => ({ ok: true, reportJson: "}{ not json" }),
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: stringContaining("jscpd produced unreadable JSON"),
        hint: "report-only: re-run drift:ai locally and capture the jscpd output for inspection.",
      },
    ]);
  });

  it.each(["", "  \n", "{}", '{"duplicates":"oops"}'])(
    "surfaces blank or malformed-shape jscpd output as advisory evidence: %j",
    (reportJson) => {
      const findings = runDuplicatesCheck({
        detectorScope: changedDetectorScope([characterAuthChange]),
        runner: () => ({ ok: true, reportJson }),
      });
      expect(findings).toEqual([
        {
          check: "duplicates",
          file: "packages/server/src",
          message: stringContaining("jscpd produced unreadable JSON"),
          hint: "report-only: re-run drift:ai locally and capture the jscpd output for inspection.",
        },
      ]);
    },
  );

  it("runs current-mode duplicates and uses the lexically smaller current path as primary", () => {
    const inputs: JscpdRunnerInput[] = [];
    const runner: JscpdRunner = (input) => {
      inputs.push(input);
      return {
        ok: true,
        reportJson: JSON.stringify({
          duplicates: [
            {
              lines: 18,
              firstFile: { name: "packages/server/src/b.ts", start: 5, end: 22 },
              secondFile: { name: "packages/server/src/a.ts", start: 9, end: 26 },
            },
          ],
        }),
      };
    };
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope([
        "packages/server/src/a.ts",
        "packages/server/src/b.ts",
        "packages/server/src/c.ts",
      ]),
      runner,
      roots: ["packages/server/src"],
    });
    expect(inputs).toEqual([
      {
        scopePath: "packages/server/src",
        minLines: DEFAULT_DUPLICATES_MIN_LINES,
        minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
        mode: DEFAULT_DUPLICATES_MODE,
        ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
      },
    ]);
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src/a.ts:9-26",
        message: "duplicates packages/server/src/b.ts:5-22 (18 lines)",
        hint: DUPLICATE_REPAIR_HINT,
        relatedFiles: ["packages/server/src/b.ts:5-22"],
      },
    ]);
  });

  it("keeps current files that only a shared ignore glob would have matched", () => {
    const inputs: JscpdRunnerInput[] = [];
    const runner: JscpdRunner = (input) => {
      inputs.push(input);
      return {
        ok: true,
        reportJson: JSON.stringify({
          duplicates: [
            {
              lines: 21,
              firstFile: { name: "src/legacy/b.ts", start: 5, end: 25 },
              secondFile: { name: "src/legacy/a.ts", start: 9, end: 29 },
            },
          ],
        }),
      };
    };
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope(["src/legacy/a.ts", "src/legacy/b.ts"]),
      runner,
      roots: ["src"],
      ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
    });
    expect(inputs).toEqual([
      {
        scopePath: "src",
        minLines: DEFAULT_DUPLICATES_MIN_LINES,
        minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
        mode: DEFAULT_DUPLICATES_MODE,
        ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
      },
    ]);
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "src/legacy/a.ts:9-29",
        message: "duplicates src/legacy/b.ts:5-25 (21 lines)",
        hint: DUPLICATE_REPAIR_HINT,
        relatedFiles: ["src/legacy/b.ts:5-25"],
      },
    ]);
  });

  it("emits one current-mode failure finding per failed scope", () => {
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts", "scripts/b.ts"]),
      runner: () => ({ ok: false, error: "boom" }),
      roots: ["packages/server/src", "scripts"],
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: "jscpd subprocess failed (boom)",
        hint: stringContaining("Re-run drift:ai locally"),
      },
      {
        check: "duplicates",
        file: "scripts",
        message: "jscpd subprocess failed (boom)",
        hint: stringContaining("Re-run drift:ai locally"),
      },
    ]);
  });

  it("surfaces malformed jscpd JSON as a warning finding in current mode", () => {
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: "}{ not json" }),
      roots: ["packages/server/src"],
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: stringContaining("jscpd produced unreadable JSON"),
        hint: "report-only: re-run drift:ai locally and capture the jscpd output for inspection.",
      },
    ]);
  });

  it("prints the current-mode large-inventory nudge for whole-repo roots", () => {
    const messages: string[] = [];
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: [],
      regularFileInventoryCount: 25_000,
      warnStderr: (message) => messages.push(message),
    });
    expect(findings).toEqual([]);
    expect(messages).toEqual([
      "drift:ai: large repository (25000 files); duplicates over the whole repo can be slow. Try --check ghost-files first or pass --root <path>.",
    ]);
  });

  it("prints the current-mode large-inventory nudge for an explicit repo root", () => {
    const messages: string[] = [];
    runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: ["."],
      regularFileInventoryCount: 25_000,
      warnStderr: (message) => messages.push(message),
    });
    expect(messages).toEqual([
      "drift:ai: large repository (25000 files); duplicates over the whole repo can be slow. Try --check ghost-files first or pass --root <path>.",
    ]);
  });

  it("does not print the large-inventory nudge when current roots are narrowed", () => {
    const messages: string[] = [];
    runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: ["packages/server/src"],
      regularFileInventoryCount: 25_000,
      warnStderr: (message) => messages.push(message),
    });
    expect(messages).toEqual([]);
  });

  it("does not print the large-inventory nudge when repo root is mixed with narrowed roots", () => {
    const messages: string[] = [];
    runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: [".", "packages/server/src"],
      regularFileInventoryCount: 25_000,
      warnStderr: (message) => messages.push(message),
    });
    expect(messages).toEqual([]);
  });

  it("does not print the large-inventory nudge below the threshold", () => {
    const messages: string[] = [];
    runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: [],
      regularFileInventoryCount: LARGE_INVENTORY_WARNING_THRESHOLD - 1,
      warnStderr: (message) => messages.push(message),
    });
    expect(messages).toEqual([]);
  });
});

describe("defaultJscpdRunner", () => {
  it("passes the default timeout to the jscpd subprocess", () => {
    let observedTimeout: number | undefined;
    let observedKillSignal: number | NodeJS.Signals | undefined;
    let observedArgs: readonly string[] = [];
    const spawn: JscpdSpawn = (_command, args, options) => {
      observedArgs = args;
      observedTimeout = options.timeout;
      observedKillSignal = options.killSignal;
      writeFileSync(path.join(outputDirFromArgs(args), "jscpd-report.json"), '{"duplicates":[]}');
      return {
        error: undefined,
        status: 0,
        stdout: "",
        stderr: "",
        signal: null,
      };
    };

    const runner = defaultJscpdRunner({
      analyzedRepoRoot: "/repo/target",
      jscpdBin: "/bin/jscpd",
      spawn,
    });

    expect(
      runner({
        scopePath: "src",
        minLines: 8,
        minTokens: 60,
        mode: "mild",
        ignoreGlobs: [],
      }),
    ).toEqual({
      ok: true,
      reportJson: '{"duplicates":[]}',
    });
    expect(observedTimeout).toBe(DEFAULT_JSCPD_TIMEOUT_MS);
    expect(observedKillSignal).toBe("SIGKILL");
    expect(flagValue(observedArgs, "--min-lines")).toBe("8");
    expect(flagValue(observedArgs, "--min-tokens")).toBe("60");
    expect(flagValue(observedArgs, "--mode")).toBe("mild");
    expect(observedArgs).not.toContain("--threshold");
  });

  it("returns a stable failure when spawnSync times out", () => {
    const timeoutError = Object.assign(new Error("spawnSync timed out"), {
      code: "ETIMEDOUT",
    });
    const spawn: JscpdSpawn = () => ({
      error: timeoutError,
      status: null,
      stdout: "",
      stderr: "",
      signal: "SIGTERM",
    });

    const runner = defaultJscpdRunner({
      analyzedRepoRoot: "/repo/target",
      jscpdBin: "/bin/jscpd",
      spawn,
      timeoutMs: 1234,
    });

    expect(
      runner({
        scopePath: "src",
        minLines: 10,
        minTokens: 60,
        mode: "mild",
        ignoreGlobs: [],
      }),
    ).toEqual({
      ok: false,
      error: "timeout of 1234ms",
    });
  });
});

describe("duplicates check service wiring", () => {
  it("reports the missing --jscpd-bin path instead of the checkout/target fallback", () => {
    const warnings: string[] = [];
    const outcome = duplicatesCheck.runWithSelectedConfig(
      makeDuplicatesPluginInput({
        argv: ["--jscpd-bin", "/bad/path/jscpd"],
        binExists: () => false,
        warnStderr: (message) => warnings.push(message),
      }),
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") throw new Error("expected duplicates to skip");
    expect(outcome.reason).toContain("searched /bad/path/jscpd");
    expect(outcome.reason).toContain("Pass a valid --jscpd-bin path");
    expect(outcome.reason).not.toContain("tools checkout or the target repo");
    expect(warnings).toEqual([outcome.reason]);
  });
});

function outputDirFromArgs(args: readonly string[]): string {
  const outputFlagIndex = args.indexOf("--output");
  const outputDir = args[outputFlagIndex + 1];
  if (outputFlagIndex < 0 || outputDir === undefined) {
    throw new Error("expected jscpd --output argument");
  }
  return outputDir;
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

describe("resolveJscpdBin", () => {
  const moduleDir = path.join("/tools", "scripts", "drift-ai");
  const toolsBin = path.join("/tools", "node_modules", ".bin", "jscpd");
  const targetRoot = "/target";
  const targetBin = path.join(targetRoot, "node_modules", ".bin", "jscpd");
  const override = path.join("/custom", "jscpd");

  it("uses the --jscpd-bin override even when the tools checkout and target also resolve", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      override,
      fileExists: (candidate) =>
        candidate === toolsBin || candidate === targetBin || candidate === override,
    });
    expect(resolution).toEqual({ found: true, binPath: override, source: "override" });
  });

  it("reports a missing override as unresolved instead of silently substituting a checkout bin", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      override,
      fileExists: (candidate) => candidate === toolsBin || candidate === targetBin,
    });
    if (resolution.found) throw new Error("expected the missing override to stay unresolved");
    expect(resolution.searched).toEqual([override]);
  });

  it("resolves the tools-checkout bin before the target when no override is supplied", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: (candidate) => candidate === toolsBin || candidate === targetBin,
    });
    expect(resolution).toEqual({ found: true, binPath: toolsBin, source: "tools-checkout" });
  });

  it("falls back to the target repo when the tools checkout has no jscpd", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: (candidate) => candidate === targetBin,
    });
    expect(resolution).toEqual({ found: true, binPath: targetBin, source: "target-repo" });
  });

  it("reports a not-found skip signal listing where it looked when nothing resolves", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: () => false,
    });
    if (resolution.found) throw new Error("expected jscpd to be unresolved");
    expect(resolution.searched).toContain(toolsBin);
    expect(resolution.searched).toContain(targetBin);
  });

  it("does not consider an override that was not supplied", () => {
    const resolution = resolveJscpdBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: () => false,
    });
    if (resolution.found) throw new Error("expected jscpd to be unresolved");
    expect(resolution.searched).not.toContain(override);
  });
});

describe("JSCPD_SUPPORTED_EXTENSIONS", () => {
  it("is closed over the JS and TS source family", () => {
    for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(JSCPD_SUPPORTED_EXTENSIONS.has(extension)).toBe(true);
    }
    expect(JSCPD_SUPPORTED_EXTENSIONS.has(".vue")).toBe(false);
  });
});
