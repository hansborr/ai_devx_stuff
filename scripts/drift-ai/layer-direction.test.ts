import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import { defaultModuleGraphRunner, type ModuleGraphRunner } from "./import-cycles-graph.js";
import { buildLayerDirectionFindings, type LayerDirectionViolation } from "./layer-direction.js";
import { layerDirectionCheck } from "./layer-direction-check.js";
import { stringContaining } from "./matcher.test-helper.js";
import { buildSourceExtensions, toChangedScopeFile } from "./scope.js";
import type { ChangedFile } from "./types.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "drift-layer-direction-"));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function tsconfig(paths?: Record<string, string[]>): string {
  return JSON.stringify({
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      baseUrl: ".",
      ...(paths === undefined ? {} : { paths }),
    },
  });
}

function violationsForRepo(
  files: Record<string, string>,
  changedFiles: readonly ChangedFile[] | "current" = "current",
): LayerDirectionViolation[] {
  const root = writeRepo({
    "tsconfig.json": tsconfig({ "@server/*": ["packages/server/src/*"] }),
    ...files,
  });
  const result = defaultModuleGraphRunner()({
    repoRoot: root,
    roots: ["packages/server/src"],
    tsconfigOverride: null,
    sourceExtensions: buildSourceExtensions([]),
    ignore: DEFAULT_DRIFT_AI_CONFIG.ignore,
  });
  if (!result.ok) throw new Error("expected graph to build");
  const detectorScope =
    changedFiles === "current"
      ? { scopeMode: "current" as const, files: [] }
      : { scopeMode: "changed" as const, files: changedFiles.map(toChangedScopeFile) };
  return buildLayerDirectionFindings(result.graph, detectorScope);
}

function makeInput(options: { readonly moduleGraph: ModuleGraphRunner }): CheckRunInput {
  return {
    detectorScope: { scopeMode: "current", files: [] },
    inventoryByDir: null,
    repoRoot: "/repo/target",
    suppressionDiffRef: null,
    config: DEFAULT_DRIFT_AI_CONFIG,
    roots: ["packages/server/src"],
    sourceExtensions: buildSourceExtensions([]),
    warnStderr: () => undefined,
    env: {
      repoRoot: "/repo/target",
      overrides: { moduleGraph: options.moduleGraph, pathExists: () => true },
      cli: parseArgs(["--scope", "current", "--check", "layer-direction"]),
      warnStderr: () => undefined,
    },
  };
}

describe("buildLayerDirectionFindings", () => {
  it("does not flag legal downward server imports", () => {
    const findings = violationsForRepo({
      "packages/server/src/services/character.ts": `import { helper } from "../utils/helper.js";\nexport const value = helper;\n`,
      "packages/server/src/utils/helper.ts": `export const helper = 1;\n`,
      "packages/server/src/routers/character.ts": `import { value } from "../services/character.js";\nexport const route = value;\n`,
    });

    expect(findings).toEqual([]);
  });

  it("flags utils importing services through relative paths", () => {
    const findings = violationsForRepo({
      "packages/server/src/utils/character-mapping.ts": `import { createCharacter } from "../services/character-create.js";\nexport const mapper = createCharacter;\n`,
      "packages/server/src/services/character-create.ts": `export const createCharacter = 1;\n`,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      check: "layer-direction",
      file: "packages/server/src/utils/character-mapping.ts",
      details: {
        sourceLayer: "utils",
        targetLayer: "services",
        targetFile: "packages/server/src/services/character-create.ts",
        typeOnly: false,
      },
    });
    expect(findings[0]?.hint).toContain("keep utils independent of services");
  });

  it("flags services importing routers through aliases", () => {
    const findings = violationsForRepo({
      "packages/server/src/services/encounter.ts": `import { encounterRouter } from "@server/routers/encounter.js";\nexport const service = encounterRouter;\n`,
      "packages/server/src/routers/encounter.ts": `export const encounterRouter = 1;\n`,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "packages/server/src/services/encounter.ts",
      details: {
        sourceLayer: "services",
        targetLayer: "routers",
        targetFile: "packages/server/src/routers/encounter.ts",
        typeOnly: false,
      },
    });
  });

  it("keeps type-only reverse imports visible as architecture coupling evidence", () => {
    const findings = violationsForRepo({
      "packages/server/src/services/types.ts": `import type { RouterShape } from "../routers/types.js";\nexport type ServiceShape = RouterShape & { id: string };\n`,
      "packages/server/src/routers/types.ts": `export type RouterShape = { id: string };\n`,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.details?.typeOnly).toBe(true);
    expect(findings[0]?.message).toContain("type-only");
  });

  it("filters changed scope to reverse imports touching a changed file", () => {
    const findings = violationsForRepo(
      {
        "packages/server/src/utils/changed.ts": `import { create } from "../services/create.js";\nexport const value = create;\n`,
        "packages/server/src/services/create.ts": `export const create = 1;\n`,
        "packages/server/src/services/untouched.ts": `import { router } from "../routers/api.js";\nexport const service = router;\n`,
        "packages/server/src/routers/api.ts": `export const router = 1;\n`,
      },
      [{ path: "packages/server/src/utils/changed.ts", status: "modified" }],
    );

    expect(findings.map((finding) => finding.file)).toEqual([
      "packages/server/src/utils/changed.ts",
    ]);
  });

  it("honors the explicit allowlist for known legitimate exceptions", () => {
    const findings = violationsForRepo({
      "packages/server/src/utils/character-mapping.test.ts": `import { buildCreateData } from "../services/character-create.js";\nexport const use = buildCreateData;\n`,
      "packages/server/src/services/character-create.ts": `export const buildCreateData = 1;\n`,
    });

    expect(findings).toEqual([]);
  });
});

describe("layerDirectionCheck", () => {
  it("emits a diagnostic finding when the graph build fails unexpectedly", () => {
    const outcome = layerDirectionCheck.runWithSelectedConfig(
      makeInput({ moduleGraph: () => ({ ok: false, error: "boom" }) }),
    );

    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]).toMatchObject({
        check: "layer-direction",
        file: ".",
        message: stringContaining("could not build the module graph"),
      });
    }
  });

  it("skips when no tsconfig governs the module graph", () => {
    const outcome = layerDirectionCheck.runWithSelectedConfig(
      makeInput({
        moduleGraph: () => ({
          ok: true,
          graph: {
            edges: new Map([["packages/server/src/utils/a.ts", []]]),
            candidateCount: 0,
            unresolvedCount: 0,
            fileCount: 1,
            tsconfigCount: 0,
          },
        }),
      }),
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.code).toBe("no-target-config");
  });

  it("runs as an opt-in drift-baseline check", () => {
    const outcome = layerDirectionCheck.runWithSelectedConfig(
      makeInput({
        moduleGraph: () => ({
          ok: true,
          graph: {
            edges: new Map([
              [
                "packages/server/src/services/a.ts",
                [{ to: "packages/server/src/routers/b.ts", typeOnly: false }],
              ],
              ["packages/server/src/routers/b.ts", []],
            ]),
            candidateCount: 1,
            unresolvedCount: 0,
            fileCount: 2,
            tsconfigCount: 1,
          },
        }),
      }),
    );

    expect(layerDirectionCheck.runByDefault).toBe(false);
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") {
      expect(outcome.findings).toHaveLength(1);
      expect(outcome.findings[0]?.provenance).toEqual({
        configSource: "drift-baseline",
        tool: "ts-morph",
        configPath: "server layer-direction rules",
      });
    }
  });
});
