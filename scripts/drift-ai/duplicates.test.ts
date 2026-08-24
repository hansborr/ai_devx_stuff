import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseDriftAiConfig } from "./config.js";
import {
  buildDuplicatesFindings,
  DUPLICATE_REPAIR_HINT,
  filterClonesToChangedFiles,
  JSCPD_SUPPORTED_EXTENSIONS,
  type JscpdClone,
  mapChangedFilesToScopes,
  normalizeReportPath,
  parseDuplicatesReport,
  SAME_FILE_DUPLICATE_REPAIR_HINT,
} from "./duplicates.js";
import type { ChangedFile } from "./types.js";

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

describe("JSCPD_SUPPORTED_EXTENSIONS", () => {
  it("is closed over the JS and TS source family", () => {
    for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(JSCPD_SUPPORTED_EXTENSIONS.has(extension)).toBe(true);
    }
    expect(JSCPD_SUPPORTED_EXTENSIONS.has(".vue")).toBe(false);
  });
});
