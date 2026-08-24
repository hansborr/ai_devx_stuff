import type {
  EnvDefineProviderConfigKey,
  EnvDefineReadKind,
} from "./env-define-provider-metadata.js";

export type { EnvDefineReadKind } from "./env-define-provider-metadata.js";

export type EnvDefineAssumedValue = string | number | boolean | null;

export type EnvDefineAssumption = {
  readonly value: EnvDefineAssumedValue;
  readonly source: string;
};

type EnvDefineTable = Readonly<Record<string, EnvDefineAssumption>>;

type EnvDefineProviderMatrix = {
  readonly [ConfigKey in EnvDefineProviderConfigKey]?: EnvDefineTable;
};

export type EnvDefineMatrix = EnvDefineProviderMatrix & {
  // Optional provider-agnostic fallback for keys whose value is intentionally
  // shared across env providers.
  readonly env?: EnvDefineTable;
};

export type EnvDefineBranchPrediction = "truthy" | "falsy" | "unknown";

export type EnvDefineRange = {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
};

export type EnvDefineReadEvidence = EnvDefineRange & {
  readonly filePath: string;
  readonly kind: EnvDefineReadKind;
  readonly key: string;
  readonly text: string;
  readonly assumedValue: EnvDefineAssumedValue | undefined;
  readonly valueSource: string | undefined;
};

export type EnvDefineConditionReadEvidence = EnvDefineRange & {
  readonly kind: EnvDefineReadKind;
  readonly key: string;
  readonly text: string;
  readonly assumedValue: EnvDefineAssumedValue | undefined;
  readonly valueSource: string | undefined;
};

export type EnvDefineConditionEvidence = EnvDefineRange & {
  readonly filePath: string;
  readonly text: string;
  readonly reads: readonly EnvDefineConditionReadEvidence[];
  readonly predictedBranch: EnvDefineBranchPrediction;
};

export type EnvDefineInventory = {
  readonly reads: readonly EnvDefineReadEvidence[];
  readonly conditions: readonly EnvDefineConditionEvidence[];
};

export type EnvDefineSourceInput = {
  readonly filePath: string;
  readonly source: string;
};

export type EnvDefineReadRef = {
  readonly kind: EnvDefineReadKind;
  readonly key: string;
  readonly text: string;
  readonly assumption: EnvDefineAssumption | undefined;
};
