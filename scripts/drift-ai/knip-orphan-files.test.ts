import path from "node:path";

import { describe, expect, it } from "vitest";

import type { PathProbe } from "./adapter-support.js";
import type { CheckRunContext, CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import type { FileReader } from "./comments.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import {
  buildOrphanFindings,
  type OrphanFilesServices,
  parseKnipOrphanFiles,
  resolveKnipConfig,
} from "./knip-orphan-files.js";
import { orphanFilesCheck } from "./knip-orphan-files-check.js";
import type { KnipRunner } from "./knip-runner.js";
import { resolveKnipBin } from "./knip-runner.js";
import { formatText } from "./report-format.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile, toCurrentScopeFile } from "./scope.js";
import { type ChangedFile, DRIFT_SCHEMA_VERSION, type DriftReport } from "./types.js";

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

const RUN_STATE = {
  inventoryByDir: null,
  repoRoot: "/repo/target",
  suppressionDiffRef: null,
  config: DEFAULT_DRIFT_AI_CONFIG,
  roots: [],
  sourceExtensions: buildSourceExtensions([]),
  warnStderr: () => undefined,
} as const;

// Build the buildReport input the plugin resolves its services from. The injected
// knip/pathExists/readFile flow through env.overrides; --knip-config through cli.
function makeInput(overrides: CtxOverrides = {}): CheckRunInput {
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
        "orphan-files",
        ...(overrides.knipConfigOverride == null
          ? []
          : ["--knip-config", overrides.knipConfigOverride]),
      ]),
    },
  };
}

// Build the already-resolved run context the pure resolveKnipConfig helper reads.
function makeServicesCtx(overrides: CtxOverrides = {}): CheckRunContext<OrphanFilesServices> {
  return {
    ...RUN_STATE,
    roots: overrides.roots ?? RUN_STATE.roots,
    detectorScope: overrides.detectorScope ?? { scopeMode: "current", files: [] },
    services: {
      knip: overrides.knip ?? knipReporting('{"issues":[]}', 0),
      readFile: overrides.readFile ?? (() => undefined),
      pathExists: overrides.pathExists ?? (() => false),
      knipConfigOverride: overrides.knipConfigOverride ?? null,
    },
  };
}

const INSTALLED_WITH_ROOT_CONFIG = ["node_modules", "knip.config.ts"];

function changedScope(files: readonly ChangedFile[]): DetectorScope {
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

// --- parseKnipOrphanFiles ---------------------------------------------------

describe("parseKnipOrphanFiles", () => {
  it("extracts orphan paths from the knip 6.14.1 files shape", () => {
    const json = '{"issues":[{"file":"src/orphan.ts","files":[{"name":"src/orphan.ts"}]}]}';
    const result = parseKnipOrphanFiles(json);
    expect(result).toEqual({ ok: true, files: ["src/orphan.ts"] });
  });

  it("returns an empty list for a clean run", () => {
    expect(parseKnipOrphanFiles('{"issues":[]}')).toEqual({ ok: true, files: [] });
  });

  it("ignores rows whose files array is empty (other categories present)", () => {
    const json = '{"issues":[{"file":"src/a.ts","files":[]},{"file":"src/b.ts","exports":[{}]}]}';
    expect(parseKnipOrphanFiles(json)).toEqual({ ok: true, files: [] });
  });

  it("treats empty output as a failed run, not 'no orphans'", () => {
    const result = parseKnipOrphanFiles("   ");
    expect(result.ok).toBe(false);
  });

  it("reports invalid JSON as a parse failure", () => {
    const result = parseKnipOrphanFiles("not json");
    expect(result.ok).toBe(false);
  });
});

// --- resolveKnipConfig ------------------------------------------------------

describe("resolveKnipConfig", () => {
  it("uses the explicit --knip-config override (rung 1)", () => {
    const resolution = resolveKnipConfig(
      makeServicesCtx({ knipConfigOverride: "custom/knip.json" }),
    );
    expect(resolution).toEqual({
      kind: "resolved",
      configPath: "custom/knip.json",
      configSource: "target-config",
      displayPath: "custom/knip.json",
    });
  });

  it("locates a non-root target config (config/knip.config.ts)", () => {
    const resolution = resolveKnipConfig(
      makeServicesCtx({ pathExists: pathExistsFor(["config/knip.config.ts"]) }),
    );
    expect(resolution).toMatchObject({
      kind: "resolved",
      configPath: "config/knip.config.ts",
      configSource: "target-config",
    });
  });

  it("falls back to package.json#knip with no --config to pass", () => {
    const resolution = resolveKnipConfig(
      makeServicesCtx({
        readFile: (file) => (file === "package.json" ? '{"knip":{}}' : undefined),
      }),
    );
    expect(resolution).toEqual({
      kind: "resolved",
      configPath: null,
      configSource: "target-config",
      displayPath: "package.json#knip",
    });
  });

  it("skips with no-target-config when nothing is found", () => {
    const resolution = resolveKnipConfig(makeServicesCtx());
    expect(resolution.kind).toBe("skip");
    if (resolution.kind === "skip") expect(resolution.code).toBe("no-target-config");
  });
});

// --- buildOrphanFindings ----------------------------------------------------

const PROVENANCE = {
  configSource: "target-config",
  tool: "knip",
  configPath: "knip.config.ts",
} as const;

describe("buildOrphanFindings", () => {
  it("reports every orphan in the current detector scope, stamped with provenance", () => {
    const findings = buildOrphanFindings(
      ["src/b.ts", "src/a.ts"],
      {
        scopeMode: "current",
        files: [toCurrentScopeFile("src/b.ts"), toCurrentScopeFile("src/a.ts")],
      },
      PROVENANCE,
    );
    expect(findings.map((f) => f.file)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(findings[0]?.provenance).toEqual(PROVENANCE);
    expect(findings[0]?.check).toBe("orphan-files");
  });

  it("intersects orphans with the changed set in changed scope", () => {
    const scope = changedScope([{ path: "src/a.ts", status: "added" }]);
    const findings = buildOrphanFindings(["src/a.ts", "src/b.ts"], scope, PROVENANCE);
    expect(findings.map((f) => f.file)).toEqual(["src/a.ts"]);
  });

  it("scopes current orphans to detector scope files without a roots side channel", () => {
    const scope: DetectorScope = {
      scopeMode: "current",
      files: [toCurrentScopeFile("scripts/drift-ai/in.ts")],
    };
    const findings = buildOrphanFindings(
      ["scripts/drift-ai/in.ts", "packages/server/src/out.ts"],
      scope,
      PROVENANCE,
    );
    expect(findings.map((f) => f.file)).toEqual(["scripts/drift-ai/in.ts"]);
  });

  it("drops ignored and non-source current orphans absent from detector scope files", () => {
    const scope: DetectorScope = {
      scopeMode: "current",
      files: [toCurrentScopeFile("src/kept.ts")],
    };
    const findings = buildOrphanFindings(
      ["src/kept.ts", "src/generated/ignored.ts", "README.md"],
      scope,
      PROVENANCE,
    );
    expect(findings.map((f) => f.file)).toEqual(["src/kept.ts"]);
  });

  it("reports every current orphan in the whole-repo current inventory", () => {
    const scope: DetectorScope = {
      scopeMode: "current",
      files: [
        toCurrentScopeFile("scripts/drift-ai/in.ts"),
        toCurrentScopeFile("packages/server/src/out.ts"),
      ],
    };
    const findings = buildOrphanFindings(
      ["scripts/drift-ai/in.ts", "packages/server/src/out.ts"],
      scope,
      PROVENANCE,
    );
    expect(findings.map((f) => f.file)).toEqual([
      "packages/server/src/out.ts",
      "scripts/drift-ai/in.ts",
    ]);
  });
});

// --- resolveKnipBin ---------------------------------------------------------

describe("resolveKnipBin", () => {
  const moduleDir = path.join("/tools", "scripts", "drift-ai");
  const toolsBin = path.join("/tools", "node_modules", ".bin", "knip");
  const targetRoot = "/target";
  const targetBin = path.join(targetRoot, "node_modules", ".bin", "knip");
  const override = path.join("/custom", "knip");

  it("uses the override even when the tools checkout and target also resolve", () => {
    const resolution = resolveKnipBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      override,
      fileExists: (candidate) =>
        candidate === toolsBin || candidate === targetBin || candidate === override,
    });
    expect(resolution).toEqual({ found: true, binPath: override, source: "override" });
  });

  it("reports a missing override as unresolved instead of silently substituting a checkout bin", () => {
    const resolution = resolveKnipBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      override,
      fileExists: (candidate) => candidate === toolsBin || candidate === targetBin,
    });
    if (resolution.found) throw new Error("expected the missing override to stay unresolved");
    expect(resolution.searched).toEqual([override]);
  });

  it("resolves the tools-checkout bin before the target when no override is supplied", () => {
    const resolution = resolveKnipBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: (candidate) => candidate === toolsBin || candidate === targetBin,
    });
    expect(resolution).toEqual({ found: true, binPath: toolsBin, source: "tools-checkout" });
  });

  it("falls back to the target repo when the tools checkout has no knip", () => {
    const resolution = resolveKnipBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: (candidate) => candidate === targetBin,
    });
    expect(resolution).toEqual({ found: true, binPath: targetBin, source: "target-repo" });
  });

  it("reports a not-found skip signal listing where it looked when nothing resolves", () => {
    const resolution = resolveKnipBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: () => false,
    });
    if (resolution.found) throw new Error("expected knip to be unresolved");
    expect(resolution.searched).toContain(toolsBin);
    expect(resolution.searched).toContain(targetBin);
  });

  it("does not consider an override that was not supplied", () => {
    const resolution = resolveKnipBin({
      moduleDir,
      analyzedRepoRoot: targetRoot,
      fileExists: () => false,
    });
    if (resolution.found) throw new Error("expected knip to be unresolved");
    expect(resolution.searched).not.toContain(override);
  });
});

// --- orphanFilesCheck (plugin) ----------------------------------------------

describe("orphanFilesCheck", () => {
  it("skips no-target-config on a repo without a knip config (the common foreign case)", () => {
    const outcome = orphanFilesCheck.runWithSelectedConfig(makeInput());
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("no-target-config");
  });

  it("gives a coherent no-config skip reason that points at the knip config", () => {
    const outcome = orphanFilesCheck.runWithSelectedConfig(makeInput());
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") {
      expect(outcome.reason).toContain("knip config");
      expect(outcome.reason).toContain("--knip-config");
    }
  });

  it("skips target-not-installed when a config exists but node_modules does not", () => {
    const outcome = orphanFilesCheck.runWithSelectedConfig(
      makeInput({ pathExists: pathExistsFor(["knip.config.ts"]) }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("target-not-installed");
  });

  it("skips tool-not-installed when knip is unresolved in the tools checkout", () => {
    const outcome = orphanFilesCheck.runWithSelectedConfig(
      makeInput({
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: () => ({ ok: false, reason: "tool-unavailable", error: "searched ..." }),
      }),
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("tool-not-installed");
  });

  it("skips tool-timeout when knip exceeds the configured timeout", () => {
    const outcome = orphanFilesCheck.runWithSelectedConfig(
      makeInput({
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

  it("emits a single diagnostic finding when knip cannot be spawned", () => {
    const outcome = orphanFilesCheck.runWithSelectedConfig(
      makeInput({
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: () => ({ ok: false, reason: "spawn-failed", error: "EACCES" }),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.message).toContain("knip subprocess failed");
      // A failure is not an authored verdict, so it carries no provenance.
      expect(outcome.findings[0]?.provenance).toBeUndefined();
    }
  });

  it("emits a single diagnostic finding when knip output is unparseable", () => {
    const outcome = orphanFilesCheck.runWithSelectedConfig(
      makeInput({
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: knipReporting("<<garbage>>", 2),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.message).toContain("unreadable JSON");
    }
  });

  it("reports provenance-stamped orphan findings on a clean run", () => {
    const json = '{"issues":[{"file":"src/orphan.ts","files":[{"name":"src/orphan.ts"}]}]}';
    const outcome = orphanFilesCheck.runWithSelectedConfig(
      makeInput({
        detectorScope: { scopeMode: "current", files: [toCurrentScopeFile("src/orphan.ts")] },
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: knipReporting(json),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      const finding = outcome.findings[0];
      expect(finding?.file).toBe("src/orphan.ts");
      expect(finding?.provenance).toEqual({
        configSource: "target-config",
        tool: "knip",
        configPath: "knip.config.ts",
      });
    }
  });

  it("filters production orphan findings through detector scope instead of ctx roots", () => {
    const json = JSON.stringify({
      issues: [
        { file: "scripts/drift-ai/in.ts", files: [{ name: "scripts/drift-ai/in.ts" }] },
        { file: "packages/server/src/out.ts", files: [{ name: "packages/server/src/out.ts" }] },
      ],
    });
    const outcome = orphanFilesCheck.runWithSelectedConfig(
      makeInput({
        roots: ["packages/server/src"],
        detectorScope: {
          scopeMode: "current",
          files: [toCurrentScopeFile("scripts/drift-ai/in.ts")],
        },
        pathExists: pathExistsFor(INSTALLED_WITH_ROOT_CONFIG),
        knip: knipReporting(json),
      }),
    );
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings.map((finding) => finding.file)).toEqual(["scripts/drift-ai/in.ts"]);
    }
  });
});

describe("formatText provenance tag", () => {
  it("tags adapter findings with their configSource so it is never read as drift's own", () => {
    const report: DriftReport = {
      schemaVersion: DRIFT_SCHEMA_VERSION,
      scopeMode: "current",
      base: null,
      resolvedRef: null,
      roots: [],
      configPath: null,
      enabledChecks: ["orphan-files"],
      skippedChecks: [],
      summary: { total: 1, byCheck: { "orphan-files": 1 } },
      findings: [
        {
          check: "orphan-files",
          file: "src/orphan.ts",
          message: "file is never imported (knip reports it as an unused file)",
          provenance: { configSource: "target-config", tool: "knip", configPath: "knip.config.ts" },
        },
      ],
      scopeCount: 0,
      scope: [],
    };
    const text = formatText(report);
    expect(text).toContain("WARN orphan-files: src/orphan.ts — ");
    expect(text).toContain("[target-config]");
  });
});
