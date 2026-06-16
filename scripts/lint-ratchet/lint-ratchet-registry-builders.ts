import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import type { LintRatchetZeroBaselineDisposition } from "./zero-baseline-types.js";

// Builder-family scope: the per-entry fields the registry supplies inline.
// `principle` is the dedicated harness-controls source of truth (see
// LintRatchetConfigBase.principle), kept separate from zeroBaselineDisposition.
interface RatchetFamilyScope {
  readonly id: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly principle: string;
  readonly zeroBaselineDisposition: LintRatchetZeroBaselineDisposition;
}

export function localTypeAssertionBoundaryRatchet(scope: RatchetFamilyScope): LintRatchetConfig {
  return {
    id: scope.id,
    ruleId: "local/type-assertion-boundary",
    files: scope.files,
    ignores: scope.ignores,
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    principle: scope.principle,
    zeroBaselineDisposition: scope.zeroBaselineDisposition,
  };
}

export function vitestValidExpectRatchet(scope: RatchetFamilyScope): LintRatchetConfig {
  return {
    id: scope.id,
    ruleId: "vitest/valid-expect",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: scope.files,
    ignores: scope.ignores,
    ruleOptions: [{ maxArgs: 2 }],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    principle: scope.principle,
    zeroBaselineDisposition: scope.zeroBaselineDisposition,
  };
}
