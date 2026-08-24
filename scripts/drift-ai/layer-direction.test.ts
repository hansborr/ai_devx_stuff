import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import {
  DEFAULT_DRIFT_AI_CONFIG,
  type DriftAiConfig,
  type DriftAiLayerDirectionConfig,
  parseDriftAiConfig,
} from "./config.js";
import { defaultModuleGraphRunner, type ModuleGraphRunner } from "./import-cycles-graph.js";
import {
  buildLayerDirectionFindings,
  findInertLayerDirectionRuleIds,
  type LayerDirectionViolation,
} from "./layer-direction.js";
import { layerDirectionCheck } from "./layer-direction-check.js";
import { layerDirectionCheckConfig } from "./layer-direction-check-config.js";
import { stringContaining } from "./matcher.test-helper.js";
import { buildSourceExtensions, toChangedScopeFile } from "./scope.js";
import type { ChangedFile } from "./types.js";

const tmpRepo = registerTempRootCleanup();

const dir = path.dirname(fileURLToPath(import.meta.url));
const COMMITTED_CONFIG_PATH = path.join(dir, "..", "..", "drift-ai.config.json");

// Musi's layering policy as shipped in the committed drift-ai.config.json. The
// behavior tests below run against this fixture, and the committed-config pin
// asserts the repo config parses to exactly this value — so the fixture cannot
// silently drift from what Musi actually enforces.
const MUSI_LAYER_DIRECTION: DriftAiLayerDirectionConfig = {
  rules: [
    {
      id: "utils-must-not-import-services",
      sourceLayer: "utils",
      sourcePrefix: "packages/server/src/utils/",
      targetLayer: "services",
      targetPrefix: "packages/server/src/services/",
      hint: "move the dependency down: keep utils independent of services; extract shared primitives into packages/server/src/utils, or move the caller into packages/server/src/services.",
    },
    {
      id: "services-must-not-import-routers",
      sourceLayer: "services",
      sourcePrefix: "packages/server/src/services/",
      targetLayer: "routers",
      targetPrefix: "packages/server/src/routers/",
      hint: "move the dependency down: services should expose operations that routers call; move router-only wiring out of the service dependency path, or extract shared types to a lower layer.",
    },
  ],
  allowedEdges: [
    [
      "packages/server/src/utils/character-mapping.test.ts",
      "packages/server/src/services/character-create.ts",
    ],
    [
      "packages/server/src/utils/__type-tests__/assert-turn-opts-dedup.ts",
      "packages/server/src/services/combat-actions/types.ts",
    ],
  ],
};

const writeRepo = (files: Record<string, string>): string =>
  tmpRepo.writeRepo(files, "drift-layer-direction-");

function tsconfig(paths?: Record<string, string[]>): string {
  return JSON.stringify({
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      ...(paths === undefined ? {} : { paths }),
    },
  });
}

function violationsForRepo(
  files: Record<string, string>,
  changedFiles: readonly ChangedFile[] | "current" = "current",
  layerDirection: DriftAiLayerDirectionConfig = MUSI_LAYER_DIRECTION,
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
  return buildLayerDirectionFindings(result.graph, detectorScope, layerDirection);
}

function configWith(layerDirection: DriftAiLayerDirectionConfig): DriftAiConfig {
  return {
    ...DEFAULT_DRIFT_AI_CONFIG,
    checks: { ...DEFAULT_DRIFT_AI_CONFIG.checks, "layer-direction": layerDirection },
  };
}

function makeInput(options: {
  readonly moduleGraph: ModuleGraphRunner;
  readonly config?: DriftAiConfig;
  readonly warnStderr?: (message: string) => void;
}): CheckRunInput {
  const warnStderr = options.warnStderr ?? (() => undefined);
  return {
    detectorScope: { scopeMode: "current", files: [] },
    inventoryByDir: null,
    repoRoot: "/repo/target",
    suppressionDiffRef: null,
    config: options.config ?? configWith(MUSI_LAYER_DIRECTION),
    roots: ["packages/server/src"],
    sourceExtensions: buildSourceExtensions([]),
    warnStderr,
    env: {
      repoRoot: "/repo/target",
      overrides: { moduleGraph: options.moduleGraph, pathExists: () => true },
      cli: parseArgs(["--scope", "current", "--check", "layer-direction"]),
      warnStderr,
    },
  };
}

function twoLayerGraphInput(options?: {
  readonly config?: DriftAiConfig;
  readonly warnStderr?: (message: string) => void;
}): CheckRunInput {
  return makeInput({
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
    ...(options?.config === undefined ? {} : { config: options.config }),
    ...(options?.warnStderr === undefined ? {} : { warnStderr: options.warnStderr }),
  });
}

describe("layer-direction config parsing", () => {
  const parse = (raw: unknown): DriftAiLayerDirectionConfig =>
    layerDirectionCheckConfig.parseConfig(raw, "checks.layer-direction");

  it("defaults to zero rules and zero allowed edges", () => {
    expect(layerDirectionCheckConfig.defaultConfig).toEqual({ rules: [], allowedEdges: [] });
    expect(parse({})).toEqual({ rules: [], allowedEdges: [] });
    expect(DEFAULT_DRIFT_AI_CONFIG.checks["layer-direction"]).toEqual({
      rules: [],
      allowedEdges: [],
    });
  });

  it("keeps runByDefault opt-in", () => {
    expect(layerDirectionCheckConfig.runByDefault).toBe(false);
  });

  it("parses rules and allowed edges, normalizing authored paths", () => {
    const parsed = parse({
      rules: [
        {
          id: "domain-must-not-import-http",
          sourceLayer: "domain",
          sourcePrefix: "./src/domain/",
          targetLayer: "http",
          targetPrefix: "src/http/",
          hint: "keep domain logic independent of transport.",
        },
      ],
      allowedEdges: [["./src/domain/legacy.ts", "src/http/client.ts"]],
    });
    expect(parsed).toEqual({
      rules: [
        {
          id: "domain-must-not-import-http",
          sourceLayer: "domain",
          sourcePrefix: "src/domain/",
          targetLayer: "http",
          targetPrefix: "src/http/",
          hint: "keep domain logic independent of transport.",
        },
      ],
      allowedEdges: [["src/domain/legacy.ts", "src/http/client.ts"]],
    });
  });

  it("rejects unknown keys at the check and rule level", () => {
    expect(() => parse({ rulez: [] })).toThrow(/unknown key 'rulez'/u);
    expect(() =>
      parse({
        rules: [
          {
            id: "a",
            sourceLayer: "x",
            sourcePrefix: "src/x/",
            targetLayer: "y",
            targetPrefix: "src/y/",
            hint: "h",
            severity: "high",
          },
        ],
      }),
    ).toThrow(/unknown key 'severity'/u);
  });

  it("rejects a rule missing a required field or carrying an empty one", () => {
    const rule = {
      id: "a",
      sourceLayer: "x",
      sourcePrefix: "src/x/",
      targetLayer: "y",
      targetPrefix: "src/y/",
      hint: "h",
    };
    const { hint: _hint, ...missingHint } = rule;
    expect(() => parse({ rules: [missingHint] })).toThrow(/hint/u);
    expect(() => parse({ rules: [{ ...rule, sourceLayer: "  " }] })).toThrow(/sourceLayer/u);
    expect(() => parse({ rules: "nope" })).toThrow(/must be an array/u);
  });

  it("rejects duplicate rule ids", () => {
    const rule = {
      id: "same",
      sourceLayer: "x",
      sourcePrefix: "src/x/",
      targetLayer: "y",
      targetPrefix: "src/y/",
      hint: "h",
    };
    expect(() => parse({ rules: [rule, { ...rule, sourceLayer: "z" }] })).toThrow(
      /duplicate rule id 'same'/u,
    );
  });

  it("rejects malformed allowed edges", () => {
    expect(() => parse({ allowedEdges: [["only-one.ts"]] })).toThrow(/two-path/u);
    expect(() => parse({ allowedEdges: [["a.ts", "a.ts"]] })).toThrow(/distinct/u);
    expect(() => parse({ allowedEdges: [["../out.ts", "a.ts"]] })).toThrow(/stay inside the repo/u);
    expect(() => parse({ allowedEdges: "nope" })).toThrow(/must be an array/u);
  });

  it("parses the committed Musi config to exactly the two rules and two allowed edges", () => {
    // type-assertion-boundary: json - narrowing the committed config file for the pin.
    const raw = JSON.parse(readFileSync(COMMITTED_CONFIG_PATH, "utf8")) as unknown;
    const parsed = parseDriftAiConfig(raw, "drift-ai.config.json");
    expect(parsed.checks["layer-direction"]).toEqual(MUSI_LAYER_DIRECTION);
  });
});

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
        rule: "utils-must-not-import-services",
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

  it("honors the configured allowed edges for known legitimate exceptions", () => {
    const findings = violationsForRepo({
      "packages/server/src/utils/character-mapping.test.ts": `import { buildCreateData } from "../services/character-create.js";\nexport const use = buildCreateData;\n`,
      "packages/server/src/services/character-create.ts": `export const buildCreateData = 1;\n`,
      "packages/server/src/utils/__type-tests__/assert-turn-opts-dedup.ts": `import type { AssertTurnOpts } from "../../services/combat-actions/types.js";\nexport type Use = AssertTurnOpts;\n`,
      "packages/server/src/services/combat-actions/types.ts": `export type AssertTurnOpts = { id: string };\n`,
    });

    expect(findings).toEqual([]);
  });

  it("applies rules with free-string layer labels from config", () => {
    const findings = violationsForRepo(
      {
        "packages/server/src/utils/wire.ts": `import { create } from "../services/create.js";\nexport const value = create;\n`,
        "packages/server/src/services/create.ts": `export const create = 1;\n`,
      },
      "current",
      {
        rules: [
          {
            id: "core-must-not-import-app",
            sourceLayer: "core helpers",
            sourcePrefix: "packages/server/src/utils/",
            targetLayer: "application",
            targetPrefix: "packages/server/src/services/",
            hint: "invert the dependency.",
          },
        ],
        allowedEdges: [],
      },
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("core helpers");
    expect(findings[0]?.message).toContain("application layer file");
    expect(findings[0]?.hint).toBe("invert the dependency.");
    expect(findings[0]?.details?.rule).toBe("core-must-not-import-app");
  });

  it("finds nothing under the zero-rules built-in default", () => {
    const findings = violationsForRepo(
      {
        "packages/server/src/utils/wire.ts": `import { create } from "../services/create.js";\nexport const value = create;\n`,
        "packages/server/src/services/create.ts": `export const create = 1;\n`,
      },
      "current",
      { rules: [], allowedEdges: [] },
    );

    expect(findings).toEqual([]);
  });
});

describe("findInertLayerDirectionRuleIds", () => {
  const graph = {
    edges: new Map([
      [
        "packages/server/src/services/a.ts",
        [{ to: "packages/server/src/routers/b.ts", typeOnly: false }],
      ],
    ]),
    candidateCount: 1,
    unresolvedCount: 0,
    fileCount: 2,
    tsconfigCount: 1,
  };

  it("names rules whose prefixes match zero files in the graph", () => {
    const inert = findInertLayerDirectionRuleIds(graph, MUSI_LAYER_DIRECTION.rules);
    expect(inert).toEqual(["utils-must-not-import-services"]);
  });

  it("returns nothing when every rule matches at least one source and target file", () => {
    const [, servicesRule] = MUSI_LAYER_DIRECTION.rules;
    if (servicesRule === undefined) throw new Error("expected the services rule");
    expect(findInertLayerDirectionRuleIds(graph, [servicesRule])).toEqual([]);
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
    const outcome = layerDirectionCheck.runWithSelectedConfig(twoLayerGraphInput());

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

  it("skips with an explicit notice when zero rules are configured", () => {
    let graphBuilds = 0;
    const outcome = layerDirectionCheck.runWithSelectedConfig(
      makeInput({
        moduleGraph: () => {
          graphBuilds += 1;
          return { ok: false, error: "should not be reached" };
        },
        config: configWith({ rules: [], allowedEdges: [] }),
      }),
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") {
      expect(outcome.reason).toContain("no layer-direction rules configured");
      expect(outcome.reason).toContain("not evidence");
    }
    expect(graphBuilds).toBe(0);
  });

  it("warns when a configured rule matches zero files instead of passing silently", () => {
    const warnings: string[] = [];
    const outcome = layerDirectionCheck.runWithSelectedConfig(
      twoLayerGraphInput({
        config: configWith(MUSI_LAYER_DIRECTION),
        warnStderr: (message) => warnings.push(message),
      }),
    );

    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") expect(outcome.findings).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("utils-must-not-import-services");
    expect(warnings[0]).toContain("matched zero files");
    expect(warnings[0]).not.toContain("services-must-not-import-routers");
  });

  it("emits no zero-match warning when every rule sees matching files", () => {
    const warnings: string[] = [];
    const [, servicesRule] = MUSI_LAYER_DIRECTION.rules;
    if (servicesRule === undefined) throw new Error("expected the services rule");
    const outcome = layerDirectionCheck.runWithSelectedConfig(
      twoLayerGraphInput({
        config: configWith({ rules: [servicesRule], allowedEdges: [] }),
        warnStderr: (message) => warnings.push(message),
      }),
    );

    expect(outcome.status).toBe("ran");
    expect(warnings).toEqual([]);
  });
});
