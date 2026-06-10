import { describe, expect, it } from "vitest";

import {
  buildEnvBranchesAdvisory,
  formatEnvBranchesAdvisoryJson,
  formatEnvBranchesAdvisoryText,
} from "./env-branches-advisory.js";
import { analyzeEnvDefineSources } from "./env-define-evaluator.js";
import type { EnvDefineMatrix } from "./env-define-types.js";

const MATRIX: EnvDefineMatrix = {
  processEnv: { NODE_ENV: { value: "production", source: "matrix:prod" } },
  importMetaEnv: { PROD: { value: true, source: "matrix:vite" } },
  defines: { __DEV__: { value: false, source: "define:vite" } },
};

function advisoryFor(sources: readonly { filePath: string; source: string }[], top?: number) {
  const inventory = analyzeEnvDefineSources(sources, MATRIX);
  return buildEnvBranchesAdvisory(inventory, MATRIX, top === undefined ? {} : { top });
}

function resolvedSection(advisory: ReturnType<typeof buildEnvBranchesAdvisory>) {
  return advisory.sections.find(
    (section) => section.candidateKind === "resolved env/define branch predictions",
  );
}

function unresolvedSection(advisory: ReturnType<typeof buildEnvBranchesAdvisory>) {
  return advisory.sections.find(
    (section) => section.candidateKind === "unresolved env/define conditions",
  );
}

describe("buildEnvBranchesAdvisory", () => {
  it("wraps predicted branches in the prototype advisory contract", () => {
    const advisory = advisoryFor([
      { filePath: "src/app.ts", source: 'if (process.env.NODE_ENV === "production") boot();' },
    ]);

    expect(advisory.kind).toBe("advisory");
    expect(advisory.lane).toBe("prototype");
    expect(advisory.subcommand).toBe("env-branches");
    expect("findings" in advisory).toBe(false);
    expect(advisory.prerequisites).toEqual([
      {
        name: "env/define matrix",
        satisfied: true,
        detail: "3 configured assumptions across 3 tables",
      },
    ]);
  });

  it("predicts a live (always-truthy) guard and marks the else branch dead", () => {
    const advisory = advisoryFor([
      { filePath: "src/app.ts", source: 'if (process.env.NODE_ENV === "production") boot();' },
    ]);
    const row = resolvedSection(advisory)?.entries[0];

    expect(row).toMatchObject({
      file: "src/app.ts",
      condition: 'process.env.NODE_ENV === "production"',
      predictedBranch: "truthy",
      deadBranch: "else",
      eraseExpectation: "env-inlining-dependent",
    });
    expect(row?.reads).toEqual([
      {
        kind: "process.env",
        key: "NODE_ENV",
        text: "process.env.NODE_ENV",
        assumedValue: "production",
        valueSource: "matrix:prod",
      },
    ]);
  });

  it("predicts a dead (always-falsy) guard and marks the then branch dead", () => {
    const advisory = advisoryFor([{ filePath: "src/flags.ts", source: "if (__DEV__) debug();" }]);
    const row = resolvedSection(advisory)?.entries[0];

    expect(row).toMatchObject({
      condition: "__DEV__",
      predictedBranch: "falsy",
      deadBranch: "then",
      eraseExpectation: "static-define",
    });
  });

  it("treats import.meta.env-only resolved branches as static define folds", () => {
    const advisory = advisoryFor([
      { filePath: "src/client.ts", source: "if (import.meta.env.PROD) prodShell();" },
    ]);

    expect(resolvedSection(advisory)?.entries[0]).toMatchObject({
      predictedBranch: "truthy",
      eraseExpectation: "static-define",
    });
  });

  it("separates unresolved conditions and reports them as not-static", () => {
    const advisory = advisoryFor([
      { filePath: "src/server.ts", source: "if (Bun.env.EXPERIMENTAL) enable();" },
    ]);

    expect(resolvedSection(advisory)?.entries).toEqual([]);
    expect(unresolvedSection(advisory)?.entries[0]).toMatchObject({
      condition: "Bun.env.EXPERIMENTAL",
      predictedBranch: "unknown",
      deadBranch: null,
      eraseExpectation: "not-static",
    });
    expect(unresolvedSection(advisory)?.entries[0]?.reads[0]).toMatchObject({
      kind: "Bun.env",
      key: "EXPERIMENTAL",
      assumedValue: undefined,
      valueSource: undefined,
    });
  });

  it("discloses an unconfigured matrix as an unmet prerequisite without scanning", () => {
    const advisory = buildEnvBranchesAdvisory({ reads: [], conditions: [] }, {});

    expect(advisory.prerequisites).toEqual([
      {
        name: "env/define matrix",
        satisfied: false,
        detail: "no env/define assumptions configured; add envDefine.* to drift-ai config",
      },
    ]);
    expect(resolvedSection(advisory)).toMatchObject({
      totalCandidates: 0,
      entries: [],
      emptyReason: "no env/define matrix configured.",
    });
  });

  it("caps rows per section and discloses the truncation", () => {
    const sources = [0, 1, 2].map((index) => ({
      filePath: `src/file-${index}.ts`,
      source: "if (__DEV__) debug();",
    }));
    const advisory = advisoryFor(sources, 2);
    const section = resolvedSection(advisory);

    expect(section?.totalCandidates).toBe(3);
    expect(section?.entries).toHaveLength(2);
    expect(advisory.caps[0]).toMatchObject({ label: "rows per section", limit: 2, hit: true });

    const text = formatEnvBranchesAdvisoryText(advisory);
    expect(text).toContain("cap rows per section: HIT -- PARTIAL run");
    expect(text).toContain("showing 2 of 3 candidates");
  });

  it("renders provenance and predictions without finding language", () => {
    const text = formatEnvBranchesAdvisoryText(
      advisoryFor([
        { filePath: "src/app.ts", source: 'if (process.env.NODE_ENV === "production") boot();' },
      ]),
    );

    expect(text).toContain("drift:ai env-branches (advisory, prototype lane)");
    expect(text).toContain("prerequisite env/define matrix: ok -- 3 configured assumptions");
    expect(text).toContain(
      "#1 src/app.ts:1:5 predicted truthy -> else-branch unreachable; bundler fold env-inlining-dependent",
    );
    expect(text).toContain('condition: process.env.NODE_ENV === "production"');
    expect(text).toContain('read process.env NODE_ENV = "production" (matrix:prod)');
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("serializes as advisory JSON with no top-level findings key", () => {
    const json = JSON.parse(
      formatEnvBranchesAdvisoryJson(
        advisoryFor([{ filePath: "src/flags.ts", source: "if (__DEV__) debug();" }]),
      ),
    ) as Record<string, unknown>;

    expect(json["kind"]).toBe("advisory");
    expect(json["lane"]).toBe("prototype");
    expect(json["subcommand"]).toBe("env-branches");
    expect("findings" in json).toBe(false);
  });
});
