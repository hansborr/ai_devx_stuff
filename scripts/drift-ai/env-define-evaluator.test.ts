import { describe, expect, it } from "vitest";

import {
  analyzeEnvDefineSource,
  analyzeEnvDefineSources,
  type EnvDefineMatrix,
} from "./env-define-evaluator.js";

const MATRIX: EnvDefineMatrix = {
  env: {
    NODE_ENV: { value: "production", source: "matrix:prod" },
    PROD: { value: false, source: "matrix:vite" },
    ENABLE_CHAT: { value: "1", source: "matrix:prod" },
  },
  defines: {
    __DEV__: { value: false, source: "define:vite" },
    FEATURE_LIMIT: { value: 3, source: "define:esbuild" },
  },
};

describe("analyzeEnvDefineSource", () => {
  it("inventories process.env reads and predicts equality branches", () => {
    const inventory = analyzeEnvDefineSource(
      "src/app.ts",
      [
        "const mode = process.env.NODE_ENV;",
        'if (process.env.NODE_ENV === "production") {',
        "  bootProd();",
        "}",
      ].join("\n"),
      MATRIX,
    );

    expect(inventory.reads).toMatchObject([
      {
        filePath: "src/app.ts",
        kind: "process.env",
        key: "NODE_ENV",
        text: "process.env.NODE_ENV",
        assumedValue: "production",
        valueSource: "matrix:prod",
      },
      {
        filePath: "src/app.ts",
        kind: "process.env",
        key: "NODE_ENV",
        text: "process.env.NODE_ENV",
        assumedValue: "production",
        valueSource: "matrix:prod",
      },
    ]);
    expect(inventory.conditions).toMatchObject([
      {
        text: 'process.env.NODE_ENV === "production"',
        predictedBranch: "truthy",
        reads: [{ kind: "process.env", key: "NODE_ENV", valueSource: "matrix:prod" }],
      },
    ]);
  });

  it("supports negated import.meta.env truthiness checks", () => {
    const inventory = analyzeEnvDefineSource(
      "src/client.ts",
      "if (!import.meta.env.PROD) renderPreview();",
      MATRIX,
    );

    expect(inventory.reads).toMatchObject([
      {
        kind: "import.meta.env",
        key: "PROD",
        assumedValue: false,
        valueSource: "matrix:vite",
      },
    ]);
    expect(inventory.conditions).toMatchObject([
      {
        text: "!import.meta.env.PROD",
        predictedBranch: "truthy",
      },
    ]);
  });

  it("reports unknown branches when the matrix has no matching value", () => {
    const inventory = analyzeEnvDefineSource(
      "src/server.ts",
      "if (Bun.env.EXPERIMENTAL_RULES) enableRules();",
      MATRIX,
    );

    expect(inventory.reads).toMatchObject([
      { kind: "Bun.env", key: "EXPERIMENTAL_RULES", assumedValue: undefined },
    ]);
    expect(inventory.conditions).toMatchObject([
      {
        text: "Bun.env.EXPERIMENTAL_RULES",
        predictedBranch: "unknown",
        reads: [{ kind: "Bun.env", key: "EXPERIMENTAL_RULES", valueSource: undefined }],
      },
    ]);
  });

  it("inventories configured define constants", () => {
    const inventory = analyzeEnvDefineSource(
      "src/flags.ts",
      "if (__DEV__ !== true) startTelemetry();",
      MATRIX,
    );

    expect(inventory.reads).toMatchObject([
      { kind: "define", key: "__DEV__", assumedValue: false, valueSource: "define:vite" },
    ]);
    expect(inventory.conditions).toMatchObject([
      {
        text: "__DEV__ !== true",
        predictedBranch: "truthy",
      },
    ]);
  });

  it("evaluates obvious conjunction and disjunction cases", () => {
    const inventory = analyzeEnvDefineSource(
      "src/combinations.ts",
      [
        'if (process.env.NODE_ENV === "production" && __DEV__) enableDebug();',
        'if (Bun.env.MISSING || process.env.ENABLE_CHAT === "1") enableChat();',
        "if (import.meta.env.PROD || __DEV__) renderProdShell();",
      ].join("\n"),
      MATRIX,
    );

    expect(inventory.conditions.map((condition) => condition.predictedBranch)).toEqual([
      "falsy",
      "truthy",
      "falsy",
    ]);
  });

  it("predicts a conjunction of two known-true operands as truthy", () => {
    const inventory = analyzeEnvDefineSource(
      "src/both-true.ts",
      [
        'if (process.env.NODE_ENV === "production" && process.env.ENABLE_CHAT === "1") enableBoth();',
        'if (process.env.NODE_ENV === "production" && Bun.env.MISSING) enableMaybe();',
      ].join("\n"),
      MATRIX,
    );

    expect(inventory.conditions.map((condition) => condition.predictedBranch)).toEqual([
      "truthy",
      "unknown",
    ]);
  });

  it("evaluates null literals and loose equality coercion deterministically", () => {
    const inventory = analyzeEnvDefineSource(
      "src/coercion.ts",
      [
        "if (__OPTIONAL__ === null) useFallback();",
        "if (process.env.EMPTY_FLAG == false) useDefaultFlag();",
      ].join("\n"),
      {
        env: { EMPTY_FLAG: { value: "", source: "matrix:test" } },
        defines: { __OPTIONAL__: { value: null, source: "define:test" } },
      },
    );

    expect(inventory.conditions.map((condition) => condition.predictedBranch)).toEqual([
      "truthy",
      "truthy",
    ]);
  });

  it("does not collapse logical expressions to boolean values inside equality operands", () => {
    const inventory = analyzeEnvDefineSource(
      "src/logical-value.ts",
      "if ((process.env.ENABLE_CHAT || true) === true) enableChat();",
      MATRIX,
    );

    expect(inventory.conditions).toMatchObject([
      {
        text: "(process.env.ENABLE_CHAT || true) === true",
        predictedBranch: "unknown",
      },
    ]);
  });

  it("allows provider-specific env assumptions to override fallback env values", () => {
    const inventory = analyzeEnvDefineSource(
      "src/providers.ts",
      ["if (import.meta.env.PROD) renderProdShell();", "if (process.env.PROD) bootProd();"].join(
        "\n",
      ),
      {
        env: { PROD: { value: false, source: "matrix:fallback" } },
        processEnv: { PROD: { value: "1", source: "matrix:node" } },
        importMetaEnv: { PROD: { value: false, source: "matrix:vite" } },
      },
    );

    expect(inventory.conditions.map((condition) => condition.predictedBranch)).toEqual([
      "falsy",
      "truthy",
    ]);
    expect(inventory.reads.map((read) => read.valueSource)).toEqual(["matrix:vite", "matrix:node"]);
  });

  it("keeps unsupported expressions as unknown while retaining raw evidence", () => {
    const inventory = analyzeEnvDefineSource(
      "src/unsupported.ts",
      'if (process.env.NODE_ENV.startsWith("prod")) bootProd();',
      MATRIX,
    );

    expect(inventory.reads).toMatchObject([
      {
        kind: "process.env",
        key: "NODE_ENV",
        text: "process.env.NODE_ENV",
        valueSource: "matrix:prod",
      },
    ]);
    expect(inventory.conditions).toMatchObject([
      {
        text: 'process.env.NODE_ENV.startsWith("prod")',
        predictedBranch: "unknown",
        reads: [{ kind: "process.env", key: "NODE_ENV", valueSource: "matrix:prod" }],
      },
    ]);
  });
});

describe("analyzeEnvDefineSources", () => {
  it("returns deterministic evidence ordering by file and range", () => {
    const inventory = analyzeEnvDefineSources(
      [
        { filePath: "src/z.ts", source: "if (__DEV__) z();" },
        { filePath: "src/a.ts", source: "if (Bun.env.ENABLE_CHAT) a();" },
      ],
      MATRIX,
    );

    expect(inventory.conditions.map((condition) => condition.filePath)).toEqual([
      "src/a.ts",
      "src/z.ts",
    ]);
    expect(inventory.reads.map((read) => `${read.filePath}:${read.text}`)).toEqual([
      "src/a.ts:Bun.env.ENABLE_CHAT",
      "src/z.ts:__DEV__",
    ]);
  });
});
