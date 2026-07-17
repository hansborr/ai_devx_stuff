const MODULE_REGISTRY_MUTATION_METHOD_NAMES = [
  "mock",
  "unmock",
  "doMock",
  "doUnmock",
  "resetModules",
] as const;

export const MODULE_REGISTRY_MUTATION_METHODS: ReadonlySet<string> = new Set(
  MODULE_REGISTRY_MUTATION_METHOD_NAMES,
);

type ClientTestIsolationMode = "no-isolate" | "isolated";
export type ModuleRegistryMutationMethod = (typeof MODULE_REGISTRY_MUTATION_METHOD_NAMES)[number];

export type ClientTestIsolationReason = {
  readonly kind: "module-registry-mutation";
  readonly line: number;
  readonly method: ModuleRegistryMutationMethod;
  readonly expression: string;
  readonly moduleName?: string;
};

export type ClientTestFileClassification = {
  readonly file: string;
  readonly mode: ClientTestIsolationMode;
  readonly reasons: readonly ClientTestIsolationReason[];
};

export type IsolatedClientTestFileClassification = ClientTestFileClassification & {
  readonly mode: "isolated";
  readonly reasons: readonly [ClientTestIsolationReason, ...ClientTestIsolationReason[]];
};

export type ClientTestIsolationTotals = {
  readonly testFiles: number;
  readonly noIsolate: number;
  readonly isolated: number;
};

export type ClientTestIsolationClassification = {
  readonly noIsolateFiles: readonly string[];
  readonly isolatedFiles: readonly IsolatedClientTestFileClassification[];
  readonly totals: ClientTestIsolationTotals;
};

export type ClassifyClientTestIsolationOptions = {
  readonly cwd?: string;
  readonly clientSourceDir?: string;
  readonly files?: readonly string[];
};

export type ClassifyClientTestFileSourceOptions = {
  readonly file: string;
  readonly source: string;
};

export type RunClientTestIsolationClassifierCliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
};

export type ClientTestIsolationClassifierCliResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};
