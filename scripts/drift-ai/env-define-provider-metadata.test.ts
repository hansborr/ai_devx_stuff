import { describe, expect, it } from "vitest";

import { ENV_DEFINE_MATRIX_KEYS, ENV_DEFINE_PROVIDERS } from "./env-define-provider-metadata.js";

describe("env define provider metadata", () => {
  it("describes every provider while keeping shared env as a sibling matrix key", () => {
    expect(ENV_DEFINE_PROVIDERS).toEqual([
      {
        configKey: "processEnv",
        readKind: "process.env",
        sharedEnvFallback: true,
        staticInline: false,
      },
      {
        configKey: "importMetaEnv",
        readKind: "import.meta.env",
        sharedEnvFallback: true,
        staticInline: true,
      },
      {
        configKey: "bunEnv",
        readKind: "Bun.env",
        sharedEnvFallback: true,
        staticInline: false,
      },
      {
        configKey: "defines",
        readKind: "define",
        sharedEnvFallback: false,
        staticInline: true,
      },
    ]);
    expect(ENV_DEFINE_MATRIX_KEYS).toEqual([
      "env",
      ...ENV_DEFINE_PROVIDERS.map((provider) => provider.configKey),
    ]);
  });
});
