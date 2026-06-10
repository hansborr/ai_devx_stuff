import { describe, expect, it } from "vitest";

import { makeDefaultDriftAiConfig } from "./config-defaults.js";
import { parseDriftAiConfig } from "./config-parsing.js";
import { parseEnvDefineConfig } from "./env-define-matrix-config.js";

describe("parseEnvDefineConfig", () => {
  it("parses each table, preserving scalar value types", () => {
    const matrix = parseEnvDefineConfig(
      {
        env: { NODE_ENV: { value: "production", source: "prod deploy" } },
        processEnv: { PORT: { value: 3000, source: "prod deploy" } },
        importMetaEnv: { PROD: { value: true, source: "vite" } },
        bunEnv: { ENABLE_CHAT: { value: "1", source: "prod deploy" } },
        defines: { __OPTIONAL__: { value: null, source: "define:test" } },
      },
      "config.envDefine",
    );

    expect(matrix).toEqual({
      env: { NODE_ENV: { value: "production", source: "prod deploy" } },
      processEnv: { PORT: { value: 3000, source: "prod deploy" } },
      importMetaEnv: { PROD: { value: true, source: "vite" } },
      bunEnv: { ENABLE_CHAT: { value: "1", source: "prod deploy" } },
      defines: { __OPTIONAL__: { value: null, source: "define:test" } },
    });
  });

  it("defaults an omitted source to the assumption key path", () => {
    const matrix = parseEnvDefineConfig(
      { defines: { __DEV__: { value: false } } },
      "config.envDefine",
    );

    expect(matrix.defines?.["__DEV__"]).toEqual({
      value: false,
      source: "config.envDefine.defines.__DEV__",
    });
  });

  it("keeps an omitted table absent rather than undefined", () => {
    const matrix = parseEnvDefineConfig(
      { env: { NODE_ENV: { value: "production" } } },
      "config.envDefine",
    );

    expect(Object.keys(matrix)).toEqual(["env"]);
  });

  it("trims a supplied source string", () => {
    const matrix = parseEnvDefineConfig(
      { env: { NODE_ENV: { value: "production", source: "  prod  " } } },
      "config.envDefine",
    );

    expect(matrix.env?.["NODE_ENV"]?.source).toBe("prod");
  });

  it("rejects unknown tables, unknown assumption keys, and bad values", () => {
    expect(() => parseEnvDefineConfig({ nope: {} }, "config.envDefine")).toThrow(/unknown key/u);
    expect(() => parseEnvDefineConfig({ env: [] }, "config.envDefine")).toThrow(
      /must be an object/u,
    );
    expect(() =>
      parseEnvDefineConfig({ env: { KEY: { value: "x", extra: 1 } } }, "config.envDefine"),
    ).toThrow(/unknown key 'extra'/u);
    expect(() =>
      parseEnvDefineConfig({ env: { KEY: { source: "x" } } }, "config.envDefine"),
    ).toThrow(/value' is required/u);
    expect(() =>
      parseEnvDefineConfig({ env: { KEY: { value: { nested: true } } } }, "config.envDefine"),
    ).toThrow(/must be a string, number, boolean, or null/u);
    expect(() =>
      parseEnvDefineConfig({ env: { KEY: { value: Number.NaN } } }, "config.envDefine"),
    ).toThrow(/must be a finite number/u);
    expect(() =>
      parseEnvDefineConfig({ env: { KEY: { value: "x", source: "  " } } }, "config.envDefine"),
    ).toThrow(/source' must be a non-empty string/u);
  });
});

describe("parseDriftAiConfig envDefine section", () => {
  it("defaults envDefine to an empty matrix", () => {
    expect(parseDriftAiConfig({}).envDefine).toEqual({});
    expect(makeDefaultDriftAiConfig().envDefine).toEqual({});
  });

  it("parses a top-level envDefine block", () => {
    const config = parseDriftAiConfig({
      envDefine: { defines: { __DEV__: { value: false, source: "vite" } } },
    });

    expect(config.envDefine).toEqual({ defines: { __DEV__: { value: false, source: "vite" } } });
  });

  it("rejects an unknown envDefine shape", () => {
    expect(() => parseDriftAiConfig({ envDefine: { bogus: {} } })).toThrow(/unknown key 'bogus'/u);
  });
});
