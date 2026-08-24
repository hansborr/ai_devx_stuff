export const ENV_DEFINE_PROVIDERS = [
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
] as const;

type EnvDefineProvider = (typeof ENV_DEFINE_PROVIDERS)[number];
export type EnvDefineProviderConfigKey = EnvDefineProvider["configKey"];
export type EnvDefineReadKind = EnvDefineProvider["readKind"];

const ENV_DEFINE_PROVIDER_CONFIG_KEYS = ENV_DEFINE_PROVIDERS.map((provider) => provider.configKey);

// `env` is a provider-agnostic fallback, not a provider descriptor row.
export const ENV_DEFINE_MATRIX_KEYS = ["env", ...ENV_DEFINE_PROVIDER_CONFIG_KEYS] as const;
export type EnvDefineMatrixKey = (typeof ENV_DEFINE_MATRIX_KEYS)[number];
