import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import { HARNESS_DIAGNOSTICS_OUTPUT_ENV } from "../harness-diagnostics-output.js";
import { ALL_CHECKS, DEFAULT_CHECKS } from "./check-metadata.js";
import {
  controlForCheck,
  projectDriftDiagnostics,
  writeDriftDiagnosticsSidecar,
} from "./diagnostics-projection.js";
import { DriftAiError } from "./errors.js";
import type { ScopeMode } from "./scope.js";
import {
  DRIFT_SCHEMA_VERSION,
  type DriftFinding,
  type DriftReport,
  type SkippedDriftCheck,
} from "./types.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function manifestControlIds(): ReadonlySet<string> {
  const text = readFileSync(join(repoRoot, "harness.controls.json"), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { controls?: unknown }).controls)
  ) {
    throw new Error("harness.controls.json must declare a controls array");
  }
  // type-assertion-boundary: test - JSON.parse returns `any`; the shape was
  // guarded above before reading control ids.
  const controls = (parsed as { controls: { id?: unknown }[] }).controls;
  const ids = new Set<string>();
  for (const control of controls) {
    if (typeof control.id === "string") ids.add(control.id);
  }
  return ids;
}

function makeReport(overrides: Partial<DriftReport> = {}): DriftReport {
  return {
    schemaVersion: DRIFT_SCHEMA_VERSION,
    scopeMode: "changed",
    base: "main",
    resolvedRef: "merge-base-sha",
    roots: ["packages"],
    configPath: null,
    enabledChecks: [],
    skippedChecks: [],
    summary: { total: 0, byCheck: {} },
    findings: [],
    scopeCount: 0,
    scope: [],
    ...overrides,
  };
}

function finding(overrides: Partial<DriftFinding> = {}): DriftFinding {
  return {
    check: "duplicates",
    file: "packages/server/src/a.ts:7-18",
    message: "duplicates packages/server/src/b.ts:3-14 (12 lines)",
    hint: "extract or reuse the shared block",
    ...overrides,
  };
}

describe("controlForCheck", () => {
  const defaultCheckIds = new Set(DEFAULT_CHECKS);

  it("maps every non-default check to its dedicated drift:ai control", () => {
    const nonDefaultChecks = ALL_CHECKS.filter((check) => !defaultCheckIds.has(check));
    expect(nonDefaultChecks).toContain("unused-exports");
    for (const check of nonDefaultChecks) {
      expect(controlForCheck(check, "changed")).toBe(`check/drift-ai-${check}`);
      expect(controlForCheck(check, "current")).toBe(`check/drift-ai-${check}`);
    }
  });

  it("maps default checks to the scope control for its scope mode", () => {
    for (const check of DEFAULT_CHECKS) {
      expect(controlForCheck(check, "changed")).toBe("drift-scope/changed");
      expect(controlForCheck(check, "current")).toBe("drift-scope/current");
    }
  });

  it("only returns control ids that resolve in harness.controls.json", () => {
    const ids = manifestControlIds();
    const scopeModes: readonly ScopeMode[] = ["changed", "current"];
    for (const scopeMode of scopeModes) {
      for (const check of ALL_CHECKS) {
        expect(ids.has(controlForCheck(check, scopeMode))).toBe(true);
      }
    }
  });
});

describe("projectDriftDiagnostics", () => {
  it("projects a clean report to a valid empty envelope", () => {
    const envelope = projectDriftDiagnostics(makeReport());
    expect(envelope.tool).toBe("drift:ai");
    expect(envelope.version).toBe(HARNESS_DIAGNOSTICS_SCHEMA_VERSION);
    expect(envelope.findings).toEqual([]);
    expect(envelope.summary).toEqual({ blocking: 0, warning: 0, info: 0, byControl: {} });
    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
  });

  it("projects drift findings to warn entries with nonzero counts", () => {
    const envelope = projectDriftDiagnostics(
      makeReport({ enabledChecks: ["duplicates"], findings: [finding()] }),
    );
    expect(envelope.findings).toEqual([
      {
        control: "drift-scope/changed",
        severity: "warn",
        path: "packages/server/src/a.ts:7-18",
        why: "duplicates packages/server/src/b.ts:3-14 (12 lines)",
        howToFix: "extract or reuse the shared block",
        repairKind: "manual",
      },
    ]);
    expect(envelope.summary.warning).toBe(1);
    expect(envelope.summary.blocking).toBe(0);
    expect(envelope.summary.byControl).toEqual({ "drift-scope/changed": 1 });
    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
  });

  it("falls back to a manual-review howToFix when a finding has no hint", () => {
    const envelope = projectDriftDiagnostics(
      makeReport({
        enabledChecks: ["comments"],
        findings: [finding({ check: "comments", hint: undefined })],
      }),
    );
    expect(envelope.findings[0]?.howToFix).toContain("comments");
    expect(envelope.findings[0]?.howToFix).toContain("report-only");
  });

  it("routes non-default check findings to their dedicated control id", () => {
    const envelope = projectDriftDiagnostics(
      makeReport({
        scopeMode: "current",
        enabledChecks: ["unused-exports"],
        findings: [
          finding({
            check: "unused-exports",
            file: "packages/server/src/orphan.ts:unusedSymbol",
            hint: undefined,
          }),
        ],
      }),
    );
    expect(envelope.findings[0]?.control).toBe("check/drift-ai-unused-exports");
    expect(envelope.summary.byControl).toEqual({ "check/drift-ai-unused-exports": 1 });
  });

  it("represents skipped checks as info entries without pretending a pass", () => {
    const skipped: readonly SkippedDriftCheck[] = [
      { check: "orphan-files", reason: "knip is not installed", code: "tool-not-installed" },
      { check: "suppressions", reason: "suppressions is diff-only" },
    ];
    const envelope = projectDriftDiagnostics(
      makeReport({ scopeMode: "current", skippedChecks: skipped }),
    );
    expect(envelope.summary.warning).toBe(0);
    expect(envelope.summary.info).toBe(2);
    const orphanSkip = envelope.findings.find((f) => f.control === "check/drift-ai-orphan-files");
    expect(orphanSkip?.severity).toBe("info");
    expect(orphanSkip?.why).toContain("did not run");
    expect(orphanSkip?.why).toContain("tool-not-installed");
    expect(orphanSkip?.reason).toBe("tool-not-installed");
    const suppressionSkip = envelope.findings.find((f) => f.control === "drift-scope/current");
    expect(suppressionSkip?.severity).toBe("info");
    expect(suppressionSkip?.reason).toBeUndefined();
    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
  });

  it("emits only control ids that resolve in harness.controls.json", () => {
    const ids = manifestControlIds();
    const envelope = projectDriftDiagnostics(
      makeReport({
        scopeMode: "current",
        enabledChecks: ["duplicates", "import-cycles"],
        findings: [
          finding(),
          finding({ check: "import-cycles", file: "packages/server/src/c.ts", hint: undefined }),
        ],
        skippedChecks: [{ check: "near-duplicates", reason: "ts-morph unavailable" }],
      }),
    );
    for (const f of envelope.findings) {
      expect(ids.has(f.control)).toBe(true);
    }
    for (const control of Object.keys(envelope.summary.byControl)) {
      expect(ids.has(control)).toBe(true);
    }
  });

  it("orders findings deterministically by control then path", () => {
    const envelope = projectDriftDiagnostics(
      makeReport({
        scopeMode: "current",
        findings: [
          // import-cycles maps to check/drift-ai-import-cycles, which sorts
          // before drift-scope/current; within a control, paths sort ascending.
          finding({ check: "duplicates", file: "b.ts", hint: undefined }),
          finding({ check: "import-cycles", file: "z.ts", hint: undefined }),
          finding({ check: "duplicates", file: "a.ts", hint: undefined }),
        ],
      }),
    );
    expect(envelope.findings.map((f) => f.path)).toEqual(["z.ts", "a.ts", "b.ts"]);
  });
});

describe("writeDriftDiagnosticsSidecar", () => {
  const tempRoots: string[] = [];
  let savedOutputEnv: string | undefined;

  beforeEach(() => {
    savedOutputEnv = process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV];
    delete process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV];
  });

  afterEach(() => {
    if (savedOutputEnv === undefined) delete process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV];
    else process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV] = savedOutputEnv;
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  function makeTempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "drift-diagnostics-"));
    tempRoots.push(root);
    return root;
  }

  it("is a no-op when the env var is unset", () => {
    expect(() => {
      writeDriftDiagnosticsSidecar(makeReport());
    }).not.toThrow();
  });

  it("writes a valid empty envelope for a clean report", () => {
    const outputPath = join(makeTempRoot(), "diag.json");
    process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV] = outputPath;

    writeDriftDiagnosticsSidecar(makeReport({ enabledChecks: ["duplicates"] }));

    expect(existsSync(outputPath)).toBe(true);
    // type-assertion-boundary: test - readFileSync returns the file text; parsing
    // it back to the envelope shape is the contract under test.
    const written = JSON.parse(readFileSync(outputPath, "utf8")) as HarnessDiagnostics;
    expect(harnessDiagnosticsSchema.safeParse(written).success).toBe(true);
    expect(written.findings).toEqual([]);
    expect(written.summary).toEqual({ blocking: 0, warning: 0, info: 0, byControl: {} });
  });

  it("writes a schema-valid envelope when the env var names a path", () => {
    const outputPath = join(makeTempRoot(), "nested", "diag.json");
    process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV] = outputPath;

    writeDriftDiagnosticsSidecar(
      makeReport({ enabledChecks: ["duplicates"], findings: [finding()] }),
    );

    expect(existsSync(outputPath)).toBe(true);
    // type-assertion-boundary: test - readFileSync returns the file text; parsing
    // it back to the envelope shape is the contract under test.
    const written = JSON.parse(readFileSync(outputPath, "utf8")) as HarnessDiagnostics;
    expect(harnessDiagnosticsSchema.safeParse(written).success).toBe(true);
    expect(written.tool).toBe("drift:ai");
    expect(written.summary.warning).toBe(1);
  });

  it("raises a DriftAiError when the sidecar path cannot be written", () => {
    const dirAsOutput = join(makeTempRoot(), "diag-dir");
    mkdirSync(dirAsOutput);
    process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV] = dirAsOutput;

    expect(() => {
      writeDriftDiagnosticsSidecar(makeReport());
    }).toThrow(DriftAiError);
  });
});
