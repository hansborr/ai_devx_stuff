import type {
  JsonValue,
  LintRatchetConfig,
  LintRatchetParserProfile,
} from "./lint-ratchet-config.js";
import { maxLinesPolicy } from "./max-lines-policy.js";
import type { LintRatchetZeroBaselineDisposition } from "./zero-baseline-types.js";

type RatchetFamilyScope = {
  readonly id: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly zeroBaselineDisposition: LintRatchetZeroBaselineDisposition;
};

type ParserRatchetFamilyScope = RatchetFamilyScope & {
  readonly parserProfile: LintRatchetParserProfile;
};

const maxLinesRatchetRuleOptions = [
  {
    max: maxLinesPolicy.ratchetFloor.cap,
    skipBlankLines: maxLinesPolicy.counting.skipBlankLines,
    skipComments: maxLinesPolicy.counting.skipComments,
  },
] as const satisfies readonly JsonValue[];

export function coreComplexityRatchet(scope: ParserRatchetFamilyScope): LintRatchetConfig {
  return {
    id: scope.id,
    ruleId: "complexity",
    source: { kind: "core" },
    parserProfile: scope.parserProfile,
    files: scope.files,
    ignores: scope.ignores,
    ruleOptions: [{ max: 10 }],
    mode: "no-new",
    target: 0,
    metric: "complexity-severity",
    repairKind: "manual",
    zeroBaselineDisposition: scope.zeroBaselineDisposition,
  };
}

export function coreNoMagicNumbersRatchet(scope: ParserRatchetFamilyScope): LintRatchetConfig {
  return {
    id: scope.id,
    ruleId: "no-magic-numbers",
    source: { kind: "core" },
    parserProfile: scope.parserProfile,
    files: scope.files,
    ignores: scope.ignores,
    ruleOptions: [
      {
        ignore: [0, 1, -1],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        enforceConst: true,
      },
    ],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
    zeroBaselineDisposition: scope.zeroBaselineDisposition,
  };
}

export function localMaxLinesRatchet(scope: RatchetFamilyScope): LintRatchetConfig {
  return {
    id: scope.id,
    ruleId: "local/max-lines",
    files: scope.files,
    ignores: scope.ignores,
    ruleOptions: maxLinesRatchetRuleOptions,
    mode: "no-new",
    target: 0,
    metric: "effective-line-count",
    repairKind: "manual",
    zeroBaselineDisposition: scope.zeroBaselineDisposition,
  };
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
    zeroBaselineDisposition: scope.zeroBaselineDisposition,
  };
}

export function regexpNoUnusedCapturingGroupRatchet(scope: RatchetFamilyScope): LintRatchetConfig {
  return {
    id: scope.id,
    ruleId: "regexp/no-unused-capturing-group",
    source: { kind: "third-party", pluginModule: "eslint-plugin-regexp" },
    parserProfile: "minimal-ts",
    files: scope.files,
    ignores: scope.ignores,
    ruleOptions: [],
    mode: "no-new",
    target: 0,
    metric: "message-count",
    repairKind: "manual",
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
    zeroBaselineDisposition: scope.zeroBaselineDisposition,
  };
}
