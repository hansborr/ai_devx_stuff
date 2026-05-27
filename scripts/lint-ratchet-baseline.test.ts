import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { harnessDiagnosticsSchema } from "../packages/shared/src/schemas/harness-diagnostics.js";
import { assertCheckBaselineComparisonClean, buildEnvelope } from "./lint-ratchet.js";
import {
  buildLintRatchetBaseline,
  compareCurrentToBaseline,
  computeCoreLintRatchetRuleSourceHash,
  computeLintRatchetConfigHash,
  currentByIdFromBaseline,
  decideLintRatchetUpdate,
  formatLintRatchetBaseline,
  formatZeroToNonzeroWarnings,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  type LintRatchetBaseline,
  type LintRatchetComparison,
  type LintRatchetCurrentById,
  type LintRatchetRuleSourceHashesById,
  parseLintRatchetBaseline,
  parseLintRatchetBaselineStructure,
  ruleNamespace,
  validateLintRatchetRegistry,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import {
  complexityDelta,
  ConfigError,
  type LintRatchetComplexityFunction,
  parseComplexitySeverityMessage,
  uniqueComplexityMap,
} from "./lint-ratchet-metrics.js";

const baseRatchet: LintRatchetConfig = {
  id: "ratchet/local-type-assertion-boundary",
  ruleId: "local/type-assertion-boundary",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
};

const thirdPartyRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-third-party",
  ruleId: "ratchet-fixture/no-fixture-marker",
  files: ["packages/**/*.ts"],
  ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],
  ruleOptions: [],
  source: {
    kind: "third-party",
    pluginModule: "eslint-plugin-ratchet-fixture",
  },
  parserProfile: "minimal-ts",
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
};

const coreRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-core",
  ruleId: "complexity",
  files: ["packages/**/*.ts"],
  ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],
  ruleOptions: [{ max: 10 }],
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
};

const maxLinesRatchet = {
  id: "ratchet/local-max-lines-fixture",
  ruleId: "local/max-lines",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }],
  mode: "no-new",
  target: 0,
  metric: "effective-line-count",
  repairKind: "manual",
} as unknown as LintRatchetConfig;

const complexityRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-complexity",
  ruleId: "complexity",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [{ max: 10 }],
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  mode: "no-new",
  target: 0,
  metric: "complexity-severity",
  repairKind: "manual",
};

const FIXTURE_RULE_SOURCE_HASH = `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"a".repeat(64)}`;
const fixtureRuleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [baseRatchet.id, FIXTURE_RULE_SOURCE_HASH],
  [complexityRatchet.id, FIXTURE_RULE_SOURCE_HASH],
  [maxLinesRatchet.id, FIXTURE_RULE_SOURCE_HASH],
]);

type ComplexityVector = readonly LintRatchetComplexityFunction[];
type CurrentPathEntry = readonly [string, number, number?, number?, ComplexityVector?];

function current(
  entries: readonly [string, readonly CurrentPathEntry[]][],
): LintRatchetCurrentById {
  const byId = new Map<
    string,
    ReadonlyMap<
      string,
      {
        readonly count: number;
        readonly firstLine?: number;
        readonly lines?: number;
        readonly perFunction?: readonly LintRatchetComplexityFunction[];
      }
    >
  >();
  for (const [testId, paths] of entries) {
    const items = new Map<
      string,
      {
        readonly count: number;
        readonly firstLine?: number;
        readonly lines?: number;
        readonly perFunction?: readonly LintRatchetComplexityFunction[];
      }
    >();
    for (const [path, count, firstLine, lines, perFunction] of paths) {
      items.set(path, {
        count,
        ...(firstLine === undefined ? {} : { firstLine }),
        ...(lines === undefined ? {} : { lines }),
        ...(perFunction === undefined ? {} : { perFunction }),
      });
    }
    byId.set(testId, items);
  }
  return byId;
}

function oneTestBaseline(paths: readonly [string, number][]): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [baseRatchet],
    current([[baseRatchet.id, paths.map(([path, count]) => [path, count])]]),
    fixtureRuleSourceHashes,
  );
}

function maxLinesBaseline(path: string, lines: number, count = 1): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [maxLinesRatchet],
    current([[maxLinesRatchet.id, [[path, count, 301, lines]]]]),
    fixtureRuleSourceHashes,
  );
}

function complexityFunction(
  line: number,
  label: string,
  complexity: number,
): LintRatchetComplexityFunction {
  return { line, nodeType: "FunctionDeclaration", label, complexity };
}

function thrownMessage(action: () => void): string {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
  throw new Error("expected action to throw");
}

function complexityBaseline(
  path: string,
  perFunction: readonly LintRatchetComplexityFunction[],
): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [complexityRatchet],
    current([
      [
        complexityRatchet.id,
        [[path, perFunction.length, perFunction[0]?.line, undefined, perFunction]],
      ],
    ]),
    fixtureRuleSourceHashes,
  );
}

describe("complexity message parsing", () => {
  it("parses core complexity diagnostics and rejects unknown message formats", () => {
    expect(
      parseComplexitySeverityMessage("ratchet/fixture-complexity", "packages/app/src/example.ts", {
        message: "Function 'choose' has a complexity of 12. Maximum allowed is 10.",
        line: 7,
        nodeType: "FunctionDeclaration",
        messageId: "complex",
      }),
    ).toEqual(complexityFunction(7, "Function 'choose'", 12));
    expect(
      parseComplexitySeverityMessage("ratchet/fixture-complexity", "packages/app/src/example.ts", {
        message: "Function 'choose' has a complexity of 12. Maximum allowed is 10.",
        line: 7,
        nodeType: "FunctionDeclaration",
      }),
    ).toEqual(complexityFunction(7, "Function 'choose'", 12));
    expect(() =>
      parseComplexitySeverityMessage("ratchet/fixture-complexity", "packages/app/src/example.ts", {
        message: "Function 'choose' has a complexity of 12. Maximum allowed is 10.",
        line: 7,
        nodeType: "FunctionDeclaration",
        messageId: "complexity-high",
      }),
    ).toThrow(ConfigError);
    expect(() =>
      parseComplexitySeverityMessage("ratchet/fixture-complexity", "packages/app/src/example.ts", {
        message: "Function 'choose' is too complex.",
        line: 7,
        nodeType: "FunctionDeclaration",
      }),
    ).toThrow(ConfigError);
  });
});

describe("lint ratchet comparison", () => {
  it("flags a new path with findings as a regression", () => {
    const baseline = oneTestBaseline([]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [baseRatchet],
      current([[baseRatchet.id, [["packages/server/src/new.ts", 1, 7]]]]),
    );

    expect(comparison.regressions).toEqual([
      {
        testId: baseRatchet.id,
        ruleId: baseRatchet.ruleId,
        path: "packages/server/src/new.ts",
        baselineCount: 0,
        currentCount: 1,
        line: 7,
        reason: "new-path",
      },
    ]);
  });

  it("carries effective line severity on new-path regressions", () => {
    const path = "packages/server/src/new-large.ts";
    const baseline = buildLintRatchetBaseline(
      [maxLinesRatchet],
      current([[maxLinesRatchet.id, []]]),
      fixtureRuleSourceHashes,
    );
    const generated = maxLinesBaseline(path, 350);
    const comparison = compareCurrentToBaseline(
      baseline,
      [maxLinesRatchet],
      currentByIdFromBaseline(generated),
    );

    expect(comparison.regressions).toEqual([
      {
        testId: maxLinesRatchet.id,
        ruleId: maxLinesRatchet.ruleId,
        path,
        baselineCount: 0,
        currentCount: 1,
        currentLines: 350,
        reason: "new-path",
      },
    ]);
  });

  it("carries complexity severity on new-path regressions", () => {
    const path = "packages/server/src/new-branchy.ts";
    const baseline = buildLintRatchetBaseline(
      [complexityRatchet],
      current([[complexityRatchet.id, []]]),
      fixtureRuleSourceHashes,
    );
    const generated = complexityBaseline(path, [
      complexityFunction(10, "Function 'newBranch'", 25),
    ]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [complexityRatchet],
      currentByIdFromBaseline(generated),
    );

    expect(comparison.regressions).toEqual([
      {
        testId: complexityRatchet.id,
        ruleId: complexityRatchet.ruleId,
        path,
        baselineCount: 0,
        currentCount: 1,
        currentComplexity: 25,
        line: 10,
        reason: "new-path",
      },
    ]);
  });

  it("reports the maximum complexity entry for live new-path regressions", () => {
    const path = "packages/server/src/new-branchy.ts";
    const baseline = buildLintRatchetBaseline(
      [complexityRatchet],
      current([[complexityRatchet.id, []]]),
      fixtureRuleSourceHashes,
    );
    const comparison = compareCurrentToBaseline(
      baseline,
      [complexityRatchet],
      current([
        [
          complexityRatchet.id,
          [
            [
              path,
              3,
              10,
              undefined,
              [
                complexityFunction(10, "low", 12),
                complexityFunction(200, "high", 25),
                complexityFunction(350, "medium", 14),
              ],
            ],
          ],
        ],
      ]),
    );

    expect(comparison.regressions[0]).toMatchObject({
      testId: complexityRatchet.id,
      ruleId: complexityRatchet.ruleId,
      path,
      currentComplexity: 25,
      line: 200,
      reason: "new-path",
    });
  });

  it("keeps maxComplexity-only fallback for new-path complexity regressions", () => {
    const path = "packages/server/src/new-branchy.ts";
    const baseline = buildLintRatchetBaseline(
      [complexityRatchet],
      current([[complexityRatchet.id, []]]),
      fixtureRuleSourceHashes,
    );
    const currentById: LintRatchetCurrentById = new Map([
      [complexityRatchet.id, new Map([[path, { count: 1, maxComplexity: 33 }]])],
    ]);
    const comparison = compareCurrentToBaseline(baseline, [complexityRatchet], currentById);

    expect(comparison.regressions[0]).toMatchObject({
      testId: complexityRatchet.id,
      ruleId: complexityRatchet.ruleId,
      path,
      currentComplexity: 33,
      reason: "new-path",
    });
  });

  it("flags an existing path with a higher count as a regression", () => {
    const baseline = oneTestBaseline([["packages/server/src/app.ts", 2]]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [baseRatchet],
      current([[baseRatchet.id, [["packages/server/src/app.ts", 3]]]]),
    );

    expect(comparison.regressions).toHaveLength(1);
    expect(comparison.regressions[0]?.reason).toBe("increased-count");
  });

  it("passes equal, lower, and removed path counts while reporting improvements", () => {
    const baseline = oneTestBaseline([
      ["packages/client/src/a.ts", 2],
      ["packages/client/src/b.ts", 3],
      ["packages/client/src/c.ts", 1],
    ]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [baseRatchet],
      current([
        [
          baseRatchet.id,
          [
            ["packages/client/src/a.ts", 2],
            ["packages/client/src/b.ts", 1],
          ],
        ],
      ]),
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([
      {
        testId: baseRatchet.id,
        ruleId: baseRatchet.ruleId,
        path: "packages/client/src/b.ts",
        baselineCount: 3,
        currentCount: 1,
        reason: "lower-count",
      },
      {
        testId: baseRatchet.id,
        ruleId: baseRatchet.ruleId,
        path: "packages/client/src/c.ts",
        baselineCount: 1,
        currentCount: 0,
        reason: "removed-path",
      },
    ]);
  });

  it("flags effective line growth when diagnostic count is unchanged", () => {
    const path = "packages/server/src/large.ts";
    const baseline = maxLinesBaseline(path, 320);
    const comparison = compareCurrentToBaseline(
      baseline,
      [maxLinesRatchet],
      current([[maxLinesRatchet.id, [[path, 1, 301, 321]]]]),
    );

    expect(comparison.regressions).toEqual([
      {
        testId: maxLinesRatchet.id,
        ruleId: maxLinesRatchet.ruleId,
        path,
        baselineCount: 1,
        currentCount: 1,
        baselineLines: 320,
        currentLines: 321,
        line: 301,
        reason: "increased-lines",
      },
    ]);
  });

  it("flags effective line growth even when diagnostic count decreases", () => {
    const path = "packages/server/src/large.ts";
    const baseline = maxLinesBaseline(path, 320, 2);
    const comparison = compareCurrentToBaseline(
      baseline,
      [maxLinesRatchet],
      current([[maxLinesRatchet.id, [[path, 1, 301, 321]]]]),
    );

    expect(comparison.regressions).toEqual([
      {
        testId: maxLinesRatchet.id,
        ruleId: maxLinesRatchet.ruleId,
        path,
        baselineCount: 2,
        currentCount: 1,
        baselineLines: 320,
        currentLines: 321,
        line: 301,
        reason: "increased-lines",
      },
    ]);
    expect(comparison.improvements).toEqual([]);
  });

  it("reports effective line shrinkage as an improvement", () => {
    const path = "packages/server/src/large.ts";
    const comparison = compareCurrentToBaseline(
      maxLinesBaseline(path, 320),
      [maxLinesRatchet],
      current([[maxLinesRatchet.id, [[path, 1, 301, 319]]]]),
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([
      {
        testId: maxLinesRatchet.id,
        ruleId: maxLinesRatchet.ruleId,
        path,
        baselineCount: 1,
        currentCount: 1,
        baselineLines: 320,
        currentLines: 319,
        reason: "lower-lines",
      },
    ]);
  });

  it("flags complexity growth even when diagnostic count decreases", () => {
    const path = "packages/server/src/branchy.ts";
    const baseline = complexityBaseline(path, [
      complexityFunction(12, "Function 'first'", 20),
      complexityFunction(32, "Function 'second'", 11),
    ]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [complexityRatchet],
      current([
        [
          complexityRatchet.id,
          [[path, 1, 14, undefined, [complexityFunction(14, "Function 'current'", 25)]]],
        ],
      ]),
    );

    expect(comparison.regressions).toEqual([
      {
        testId: complexityRatchet.id,
        ruleId: complexityRatchet.ruleId,
        path,
        baselineCount: 2,
        currentCount: 1,
        baselineComplexity: 20,
        currentComplexity: 25,
        line: 14,
        reason: "increased-complexity",
      },
    ]);
    expect(comparison.improvements).toEqual([]);
  });

  it("does not flag a shorter equal-max complexity vector as a regression", () => {
    const path = "packages/server/src/branchy.ts";
    const baseline = complexityBaseline(path, [
      complexityFunction(12, "Function 'first'", 20),
      complexityFunction(32, "Function 'second'", 11),
    ]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [complexityRatchet],
      current([
        [
          complexityRatchet.id,
          [[path, 1, 12, undefined, [complexityFunction(12, "Function 'first'", 20)]]],
        ],
      ]),
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([
      {
        testId: complexityRatchet.id,
        ruleId: complexityRatchet.ruleId,
        path,
        baselineCount: 2,
        currentCount: 1,
        reason: "lower-count",
      },
    ]);
  });

  it("reports lower count and lower complexity as an improvement", () => {
    const path = "packages/server/src/branchy.ts";
    const baseline = complexityBaseline(path, [
      complexityFunction(12, "Function 'first'", 20),
      complexityFunction(32, "Function 'second'", 11),
    ]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [complexityRatchet],
      current([
        [
          complexityRatchet.id,
          [[path, 1, 12, undefined, [complexityFunction(12, "Function 'first'", 18)]]],
        ],
      ]),
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([
      {
        testId: complexityRatchet.id,
        ruleId: complexityRatchet.ruleId,
        path,
        baselineCount: 2,
        currentCount: 1,
        reason: "lower-count",
      },
    ]);
  });

  it("flags complexity growth when diagnostic count is unchanged", () => {
    const path = "packages/server/src/branchy.ts";
    const comparison = compareCurrentToBaseline(
      complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 11)]),
      [complexityRatchet],
      current([
        [
          complexityRatchet.id,
          [[path, 1, 12, undefined, [complexityFunction(12, "Function 'choose'", 12)]]],
        ],
      ]),
    );

    expect(comparison.regressions).toEqual([
      {
        testId: complexityRatchet.id,
        ruleId: complexityRatchet.ruleId,
        path,
        baselineCount: 1,
        currentCount: 1,
        baselineComplexity: 11,
        currentComplexity: 12,
        line: 12,
        reason: "increased-complexity",
      },
    ]);
  });

  it("flags complexity vector growth when functions cannot be matched exactly", () => {
    const path = "packages/server/src/branchy.ts";
    const comparison = compareCurrentToBaseline(
      complexityBaseline(path, [
        complexityFunction(10, "Function 'first'", 15),
        complexityFunction(30, "Function 'second'", 13),
      ]),
      [complexityRatchet],
      current([
        [
          complexityRatchet.id,
          [
            [
              path,
              2,
              11,
              undefined,
              [
                complexityFunction(11, "Function 'movedFirst'", 15),
                complexityFunction(31, "Function 'movedSecond'", 14),
              ],
            ],
          ],
        ],
      ]),
    );

    expect(comparison.regressions[0]).toMatchObject({
      testId: complexityRatchet.id,
      path,
      baselineComplexity: 13,
      currentComplexity: 14,
      line: 31,
      reason: "increased-complexity",
    });
  });

  it("keeps a conservative complexity identity when duplicate diagnostics collide", () => {
    const lower = complexityFunction(12, "Function 'choose'", 11);
    const higher = complexityFunction(12, "Function 'choose'", 13);
    const byIdentity = uniqueComplexityMap([lower, higher]);

    expect([...byIdentity.values()]).toEqual([higher]);
    expect(
      complexityDelta(
        { count: 1, maxComplexity: 13, perFunction: [higher] },
        {
          count: 1,
          maxComplexity: 14,
          perFunction: [complexityFunction(12, "Function 'choose'", 14)],
        },
      ),
    ).toEqual({
      baselineComplexity: 13,
      currentComplexity: 14,
      line: 12,
      regression: true,
    });
  });

  it("reports complexity shrinkage as an improvement", () => {
    const path = "packages/server/src/branchy.ts";
    const comparison = compareCurrentToBaseline(
      complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 12)]),
      [complexityRatchet],
      current([
        [
          complexityRatchet.id,
          [[path, 1, 12, undefined, [complexityFunction(12, "Function 'choose'", 11)]]],
        ],
      ]),
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([
      {
        testId: complexityRatchet.id,
        ruleId: complexityRatchet.ruleId,
        path,
        baselineCount: 1,
        currentCount: 1,
        baselineComplexity: 12,
        currentComplexity: 11,
        reason: "lower-complexity",
      },
    ]);
  });
});

describe("lint ratchet diagnostics envelope", () => {
  it("turns a strict complexity improvement into a blocking finding", () => {
    const path = "packages/server/src/branchy.ts";
    const envelope = buildEnvelope(
      [],
      [
        {
          testId: complexityRatchet.id,
          ruleId: complexityRatchet.ruleId,
          path,
          baselineCount: 1,
          currentCount: 1,
          baselineComplexity: 12,
          currentComplexity: 11,
          reason: "lower-complexity",
        },
      ],
      new Map(),
      [complexityRatchet],
    );

    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.findings).toEqual([
      {
        control: complexityRatchet.id,
        severity: "block",
        path,
        ruleId: complexityRatchet.ruleId,
        baselineCount: 1,
        currentCount: 1,
        baselineComplexity: 12,
        currentComplexity: 11,
        reason: "lower-complexity",
        why: `Current tree is better than the committed baseline for ${complexityRatchet.ruleId}; lock it in.`,
        howToFix:
          "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
        repairKind: "manual",
      },
    ]);
    expect(envelope.summary).toEqual({
      blocking: 1,
      warning: 0,
      info: 0,
      byControl: { [complexityRatchet.id]: 1 },
    });
    expect(envelope.findings[0]).not.toHaveProperty("baselineLines");
    expect(envelope.findings[0]).not.toHaveProperty("currentLines");
    expect(envelope.findings[0]).not.toHaveProperty("line");
  });

  it("turns multiple improvements into sorted blocking findings", () => {
    const envelope = buildEnvelope(
      [],
      [
        {
          testId: maxLinesRatchet.id,
          ruleId: maxLinesRatchet.ruleId,
          path: "packages/server/src/c-removed.ts",
          baselineCount: 1,
          currentCount: 0,
          reason: "removed-path",
        },
        {
          testId: maxLinesRatchet.id,
          ruleId: maxLinesRatchet.ruleId,
          path: "packages/server/src/a-count.ts",
          baselineCount: 2,
          currentCount: 1,
          reason: "lower-count",
        },
        {
          testId: maxLinesRatchet.id,
          ruleId: maxLinesRatchet.ruleId,
          path: "packages/server/src/b-lines.ts",
          baselineCount: 1,
          currentCount: 1,
          baselineLines: 320,
          currentLines: 319,
          reason: "lower-lines",
        },
      ],
      new Map(),
      [maxLinesRatchet],
    );

    expect(envelope.findings).toEqual([
      {
        control: maxLinesRatchet.id,
        severity: "block",
        path: "packages/server/src/a-count.ts",
        ruleId: maxLinesRatchet.ruleId,
        baselineCount: 2,
        currentCount: 1,
        reason: "lower-count",
        why: `Current tree is better than the committed baseline for ${maxLinesRatchet.ruleId}; lock it in.`,
        howToFix:
          "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
        repairKind: "manual",
      },
      {
        control: maxLinesRatchet.id,
        severity: "block",
        path: "packages/server/src/b-lines.ts",
        ruleId: maxLinesRatchet.ruleId,
        baselineCount: 1,
        currentCount: 1,
        baselineLines: 320,
        currentLines: 319,
        reason: "lower-lines",
        why: `Current tree is better than the committed baseline for ${maxLinesRatchet.ruleId}; lock it in.`,
        howToFix:
          "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
        repairKind: "manual",
      },
      {
        control: maxLinesRatchet.id,
        severity: "block",
        path: "packages/server/src/c-removed.ts",
        ruleId: maxLinesRatchet.ruleId,
        baselineCount: 1,
        currentCount: 0,
        reason: "removed-path",
        why: `Current tree is better than the committed baseline for ${maxLinesRatchet.ruleId}; lock it in.`,
        howToFix:
          "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
        repairKind: "manual",
      },
    ]);
    expect(envelope.summary.blocking).toBe(3);
  });

  it("keeps regressions and improvements in one blocking envelope", () => {
    const envelope = buildEnvelope(
      [
        {
          testId: coreRatchet.id,
          ruleId: coreRatchet.ruleId,
          path: "packages/server/src/regressed.ts",
          baselineCount: 1,
          currentCount: 2,
          reason: "increased-count",
        },
      ],
      [
        {
          testId: complexityRatchet.id,
          ruleId: complexityRatchet.ruleId,
          path: "packages/server/src/improved.ts",
          baselineCount: 2,
          currentCount: 1,
          reason: "lower-count",
        },
      ],
      new Map(),
      [coreRatchet, complexityRatchet],
    );

    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.findings.map((finding) => [finding.control, finding.reason])).toEqual([
      [complexityRatchet.id, "lower-count"],
      [coreRatchet.id, "increased-count"],
    ]);
    expect(envelope.summary).toEqual({
      blocking: 2,
      warning: 0,
      info: 0,
      byControl: {
        [complexityRatchet.id]: 1,
        [coreRatchet.id]: 1,
      },
    });
  });

  it("produces no findings for a clean comparison", () => {
    const envelope = buildEnvelope([], [], new Map(), [coreRatchet]);

    expect(envelope.findings).toEqual([]);
    expect(envelope.summary).toEqual({
      blocking: 0,
      warning: 0,
      info: 0,
      byControl: {},
    });
    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
  });
});

describe("lint ratchet baseline parsing", () => {
  it("round-trips deterministic baseline JSON", () => {
    const baseline = oneTestBaseline([["packages/shared/src/schema.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline);
    const parsed = parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes);

    expect(parsed.failures).toEqual([]);
    expect(parsed.baseline).toEqual(baseline);
  });

  it("rejects unknown version, missing tests, bad ids, negative counts, and non-deterministic output", () => {
    expect(
      parseLintRatchetBaseline('{"version":2,"tests":{}}\n', [baseRatchet], fixtureRuleSourceHashes)
        .failures,
    ).toContain("version must be 1");
    expect(
      parseLintRatchetBaseline('{"version":1}\n', [baseRatchet], fixtureRuleSourceHashes).failures,
    ).toContain("tests must be an object");
    expect(
      parseLintRatchetBaseline(
        '{"version":1,"tests":{"bad":{"ruleId":"local/type-assertion-boundary","mode":"no-new","target":0,"metric":"message-count","files":["packages/**/*.ts"],"ignores":[],"ruleOptions":[],"configHash":"sha256:x","items":{}}}}\n',
        [baseRatchet],
        fixtureRuleSourceHashes,
      ).failures,
    ).toContain("bad: id must match ratchet/<name>");
    expect(
      parseLintRatchetBaseline(
        '{"version":1,"tests":{"ratchet/local-type-assertion-boundary":{"ruleId":"local/type-assertion-boundary","mode":"no-new","target":0,"metric":"message-count","files":["packages/**/*.ts"],"ignores":[],"ruleOptions":[],"configHash":"sha256:x","items":{"packages/a.ts":{"count":-1}}}}}\n',
        [baseRatchet],
        fixtureRuleSourceHashes,
      ).failures,
    ).toContain(
      "ratchet/local-type-assertion-boundary.items.packages/a.ts.count must be a non-negative integer",
    );

    const rendered = formatLintRatchetBaseline(oneTestBaseline([])).trimEnd();
    expect(
      parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes).failures,
    ).toContain("baseline JSON is not deterministic; run bun run lint:ratchet:update");
  });

  it("requires effective-line-count items to carry lines in strict parse", () => {
    const path = "packages/server/src/large.ts";
    const rendered = formatLintRatchetBaseline(maxLinesBaseline(path, 320));
    expect(
      parseLintRatchetBaseline(rendered, [maxLinesRatchet], fixtureRuleSourceHashes).failures,
    ).toEqual([]);

    const countOnly = rendered.replace(/,\n\s+"lines": 320/u, "");
    expect(
      parseLintRatchetBaseline(countOnly, [maxLinesRatchet], fixtureRuleSourceHashes).failures,
    ).toContain(`${maxLinesRatchet.id}.items.${path}.lines is required for effective-line-count`);
    expect(parseLintRatchetBaselineStructure(countOnly).failures).toEqual([]);
  });

  it("requires complexity-severity items to carry maxComplexity and perFunction in strict parse", () => {
    const path = "packages/server/src/branchy.ts";
    const rendered = formatLintRatchetBaseline(
      complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 12)]),
    );
    expect(
      parseLintRatchetBaseline(rendered, [complexityRatchet], fixtureRuleSourceHashes).failures,
    ).toEqual([]);

    const countOnly = rendered.replace(
      /,\n\s+"maxComplexity": 12,\n\s+"perFunction": \[(?:[^\n]*\n)*?[ \t]+\]/u,
      "",
    );
    expect(
      parseLintRatchetBaseline(countOnly, [complexityRatchet], fixtureRuleSourceHashes).failures,
    ).toEqual([
      `${complexityRatchet.id}.items.${path}.maxComplexity is required for complexity-severity`,
      `${complexityRatchet.id}.items.${path}.perFunction is required for complexity-severity`,
    ]);
    expect(parseLintRatchetBaselineStructure(countOnly).failures).toEqual([]);
  });

  it("rejects stale config identity, unknown metrics, missing files, missing ruleOptions, and unknown registry ids", () => {
    const baseline = oneTestBaseline([]);
    const rendered = formatLintRatchetBaseline(baseline);
    expect(
      parseLintRatchetBaseline(
        rendered.replace("message-count", "line-count"),
        [baseRatchet],
        fixtureRuleSourceHashes,
      ).failures,
    ).toContain("ratchet/local-type-assertion-boundary.metric is unknown");
    expect(
      parseLintRatchetBaseline(
        '{"version":1,"tests":{"ratchet/local-type-assertion-boundary":{"ruleId":"local/type-assertion-boundary","mode":"no-new","target":0,"metric":"message-count","ignores":[],"ruleOptions":[],"configHash":"sha256:x","items":{}}}}\n',
        [baseRatchet],
        fixtureRuleSourceHashes,
      ).failures,
    ).toContain("ratchet/local-type-assertion-boundary.files is required");
    expect(
      parseLintRatchetBaseline(
        rendered.replace('"ruleOptions": [],', ""),
        [baseRatchet],
        fixtureRuleSourceHashes,
      ).failures,
    ).toContain("ratchet/local-type-assertion-boundary.ruleOptions is required");
    expect(
      parseLintRatchetBaseline(
        rendered.replace(baseRatchet.id, "ratchet/unknown"),
        [baseRatchet],
        fixtureRuleSourceHashes,
      ).failures,
    ).toContain("ratchet/unknown: baseline has no matching ratchet registry entry");
    expect(
      parseLintRatchetBaseline(
        rendered.replace(baseline.tests[baseRatchet.id]?.configHash ?? "", "sha256:stale"),
        [baseRatchet],
        fixtureRuleSourceHashes,
      ).failures,
    ).toContain("ratchet/local-type-assertion-boundary.configHash is stale");
  });
});

describe("lint ratchet update decisions", () => {
  it("refuses worse generated baselines unless allowed with a reason", () => {
    const committed = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const generated = oneTestBaseline([["packages/server/src/a.ts", 2]]);

    const refused = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      allowWorse: false,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.failures[0]).toContain("generated baseline is worse");

    const missingReason = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      allowWorse: true,
      reason: " ",
    });
    expect(missingReason.allowed).toBe(false);
    expect(missingReason.failures).toContain("--allow-worse requires a non-empty --reason");

    const accepted = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      allowWorse: true,
      reason: "intentional migration boundary",
    });
    expect(accepted.allowed).toBe(true);
  });

  it("refuses effective line regressions unless allowed with a reason", () => {
    const path = "packages/server/src/large.ts";
    const committed = maxLinesBaseline(path, 320);
    const generated = maxLinesBaseline(path, 321);
    const refused = decideLintRatchetUpdate(committed, generated, [maxLinesRatchet], {
      allowWorse: false,
    });

    expect(refused.allowed).toBe(false);
    expect(refused.failures[0]).toContain("generated baseline is worse");
    expect(refused.regressions[0]?.reason).toBe("increased-lines");

    const accepted = decideLintRatchetUpdate(committed, generated, [maxLinesRatchet], {
      allowWorse: true,
      reason: "intentional max-lines migration",
    });
    expect(accepted.allowed).toBe(true);
  });

  it("refuses complexity regressions unless allowed with a reason", () => {
    const path = "packages/server/src/branchy.ts";
    const committed = complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 11)]);
    const generated = complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 12)]);
    const refused = decideLintRatchetUpdate(committed, generated, [complexityRatchet], {
      allowWorse: false,
    });

    expect(refused.allowed).toBe(false);
    expect(refused.failures[0]).toContain("generated baseline is worse");
    expect(refused.regressions[0]?.reason).toBe("increased-complexity");

    const accepted = decideLintRatchetUpdate(committed, generated, [complexityRatchet], {
      allowWorse: true,
      reason: "intentional complexity migration",
    });
    expect(accepted.allowed).toBe(true);
  });

  it("does not let total-count improvements mask a new path", () => {
    const committed = oneTestBaseline([["packages/server/src/a.ts", 2]]);
    const generated = oneTestBaseline([
      ["packages/server/src/a.ts", 1],
      ["packages/server/src/b.ts", 1],
    ]);

    const decision = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      allowWorse: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.regressions).toEqual([
      {
        testId: baseRatchet.id,
        ruleId: baseRatchet.ruleId,
        path: "packages/server/src/b.ts",
        baselineCount: 0,
        currentCount: 1,
        reason: "new-path",
      },
    ]);
    expect(decision.improvements).toEqual([
      {
        testId: baseRatchet.id,
        ruleId: baseRatchet.ruleId,
        path: "packages/server/src/a.ts",
        baselineCount: 2,
        currentCount: 1,
        reason: "lower-count",
      },
    ]);
  });

  it("warns when a previously clean ratchet gains findings", () => {
    const committed = oneTestBaseline([]);
    const generated = oneTestBaseline([
      ["packages/server/src/a.ts", 1],
      ["packages/server/src/b.ts", 2],
    ]);

    const refused = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      allowWorse: false,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.warnings).toHaveLength(1);
    expect(refused.warnings[0]).toContain("previously clean ratchet");
    expect(refused.warnings[0]).toContain(baseRatchet.id);
    expect(refused.warnings[0]).toContain(baseRatchet.ruleId);
    expect(refused.warnings[0]).toContain("2 path(s)");
    expect(refused.warnings[0]).toContain("packages/server/src/a.ts: 1");
    expect(refused.warnings[0]).toContain("packages/server/src/b.ts: 2");

    const accepted = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      allowWorse: true,
      reason: "intentional new boundary",
    });
    expect(accepted.allowed).toBe(true);
    expect(accepted.warnings).toHaveLength(1);
    expect(accepted.warnings[0]).toContain("previously clean ratchet");
  });

  it("does not warn when a non-empty ratchet gains more findings", () => {
    const committed = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const generated = oneTestBaseline([
      ["packages/server/src/a.ts", 1],
      ["packages/server/src/b.ts", 1],
    ]);

    const decision = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      allowWorse: true,
      reason: "already had findings",
    });
    expect(decision.warnings).toHaveLength(0);
  });

  it("formats zero-to-nonzero warnings with ratchet id, rule id, and paths", () => {
    const warnings = formatZeroToNonzeroWarnings([
      {
        testId: "ratchet/test-boundary",
        ruleId: "local/type-assertion-boundary",
        newPaths: [
          { path: "packages/server/src/a.ts", count: 1 },
          { path: "packages/server/src/b.ts", count: 2 },
        ],
      },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ratchet/test-boundary");
    expect(warnings[0]).toContain("local/type-assertion-boundary");
    expect(warnings[0]).toContain("2 path(s)");
    expect(warnings[0]).toContain("packages/server/src/a.ts: 1");
    expect(warnings[0]).toContain("packages/server/src/b.ts: 2");
    expect(warnings[0]).toContain("Inspect these paths before committing");
  });

  it("fails check-baseline when current findings improve", () => {
    const comparison = {
      regressions: [],
      improvements: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: "packages/server/src/a.ts",
          baselineCount: 2,
          currentCount: 1,
          reason: "lower-count",
        },
        {
          testId: maxLinesRatchet.id,
          ruleId: maxLinesRatchet.ruleId,
          path: "packages/server/src/large.ts",
          baselineCount: 1,
          currentCount: 1,
          baselineLines: 320,
          currentLines: 319,
          reason: "lower-lines",
        },
        {
          testId: complexityRatchet.id,
          ruleId: complexityRatchet.ruleId,
          path: "packages/server/src/branchy.ts",
          baselineCount: 1,
          currentCount: 1,
          baselineComplexity: 12,
          currentComplexity: 11,
          reason: "lower-complexity",
        },
      ],
    } satisfies LintRatchetComparison;

    expect(
      thrownMessage(() => {
        assertCheckBaselineComparisonClean(comparison);
      }),
    ).toBe(
      "current findings are better than lint-ratchet.baseline.json for 3 path(s): " +
        "ratchet/local-type-assertion-boundary packages/server/src/a.ts: finding count decreased from 2 to 1; " +
        "ratchet/local-max-lines-fixture packages/server/src/large.ts: effective lines decreased from 320 to 319; " +
        "ratchet/fixture-complexity packages/server/src/branchy.ts: complexity decreased from 12 to 11; " +
        "run bun run lint:ratchet:update",
    );
  });

  it("reports regressions and improvements together in check-baseline failures", () => {
    const comparison = {
      regressions: [
        {
          testId: coreRatchet.id,
          ruleId: coreRatchet.ruleId,
          path: "packages/server/src/regressed.ts",
          baselineCount: 1,
          currentCount: 2,
          reason: "increased-count",
        },
      ],
      improvements: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: "packages/server/src/improved.ts",
          baselineCount: 2,
          currentCount: 1,
          reason: "lower-count",
        },
      ],
    } satisfies LintRatchetComparison;

    expect(
      thrownMessage(() => {
        assertCheckBaselineComparisonClean(comparison);
      }),
    ).toBe(
      "current findings are worse than lint-ratchet.baseline.json for 1 path(s): " +
        "ratchet/fixture-core packages/server/src/regressed.ts: finding count increased from 1 to 2; " +
        "current findings are better than lint-ratchet.baseline.json for 1 path(s): " +
        "ratchet/local-type-assertion-boundary packages/server/src/improved.ts: finding count decreased from 2 to 1; " +
        "fix regressions, then run bun run lint:ratchet:update",
    );
  });
});

describe("lint ratchet structural parsing", () => {
  it("accepts a deterministic baseline with stale registry metadata so update can recover", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline);

    // Mutate a registry-identity field that would fail the strict parse but
    // not the structural shape (configHash, files, ruleOptions, etc.).
    const staleConfigHash = rendered.replace(
      baseline.tests[baseRatchet.id]?.configHash ?? "",
      "sha256:stale",
    );
    expect(
      parseLintRatchetBaseline(staleConfigHash, [baseRatchet], fixtureRuleSourceHashes).failures,
    ).toContain("ratchet/local-type-assertion-boundary.configHash is stale");
    const structuralStale = parseLintRatchetBaselineStructure(staleConfigHash);
    expect(structuralStale.failures).toEqual([]);
    expect(structuralStale.baseline?.tests[baseRatchet.id]?.configHash).toBe("sha256:stale");
    expect(structuralStale.baseline?.tests[baseRatchet.id]?.items).toEqual({
      "packages/server/src/a.ts": { count: 1 },
    });
  });

  it("accepts a structural baseline with an unknown registry id so update can drop it", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline).replace(
      baseRatchet.id,
      "ratchet/old-removed-rule",
    );
    expect(
      parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes).failures,
    ).toContain("ratchet/old-removed-rule: baseline has no matching ratchet registry entry");
    const structural = parseLintRatchetBaselineStructure(rendered);
    expect(structural.failures).toEqual([]);
    expect(Object.keys(structural.baseline?.tests ?? {})).toEqual(["ratchet/old-removed-rule"]);
  });

  it("accepts a non-deterministic but well-formed JSON layout so update can re-emit canonical text", () => {
    const baseline = oneTestBaseline([]);
    const rendered = formatLintRatchetBaseline(baseline).trimEnd();
    expect(
      parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes).failures,
    ).toContain("baseline JSON is not deterministic; run bun run lint:ratchet:update");
    expect(parseLintRatchetBaselineStructure(rendered).failures).toEqual([]);
  });

  it("rejects malformed JSON in structural parse as a hard error", () => {
    expect(parseLintRatchetBaselineStructure("{not-json}\n").failures).toEqual([
      expect.stringMatching(/^baseline JSON parse failed: /u),
    ]);
    expect(parseLintRatchetBaselineStructure('"a string"\n').failures).toContain(
      "baseline must be an object",
    );
    expect(parseLintRatchetBaselineStructure('{"version":1}\n').failures).toContain(
      "tests must be an object",
    );
  });

  it("rejects structurally-invalid test entries even when the outer shape is fine", () => {
    const bad = parseLintRatchetBaselineStructure(
      '{"version":1,"tests":{"ratchet/local-type-assertion-boundary":{"ruleId":"local/type-assertion-boundary","mode":"no-new","target":0,"metric":"line-count","files":["packages/**/*.ts"],"ignores":[],"ruleOptions":[],"configHash":"sha256:x","items":{}}}}\n',
    );
    expect(bad.failures).toContain("ratchet/local-type-assertion-boundary.metric is unknown");
  });
});

describe("lint ratchet update mode with stale committed baseline", () => {
  it("refuses a committed baseline with an unknown registry id unless --allow-worse --reason is supplied", () => {
    // Leaf 26: a committed baseline whose id is no longer in the registry
    // looks identical at the comparator layer to a rename and a true removal.
    // Renames bypass count protection silently (the new id has no committed
    // floor); update must require the operator to acknowledge that risk.
    const committedStale = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const stale = formatLintRatchetBaseline(committedStale).replace(
      baseRatchet.id,
      "ratchet/old-removed-rule",
    );
    const structural = parseLintRatchetBaselineStructure(stale);
    expect(structural.baseline).toBeDefined();

    const generated = oneTestBaseline([["packages/server/src/a.ts", 2]]);
    const refused = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      { allowWorse: false },
    );
    expect(refused.allowed).toBe(false);
    expect(refused.failures.some((f) => f.includes("ratchet/old-removed-rule"))).toBe(true);
    expect(refused.failures.some((f) => f.includes("rename or removal"))).toBe(true);

    const accepted = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      { allowWorse: true, reason: "renamed ratchet/local-foo to ratchet/local-bar" },
    );
    expect(accepted.allowed).toBe(true);
  });

  it("lists multiple orphan ids alphabetically in a single failure", () => {
    // Two orphans at once still produce one failure entry; sort order is
    // deterministic so smoke tests and operator output stay stable.
    const committed = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const stale = formatLintRatchetBaseline(committed).replace(
      `"${baseRatchet.id}": {`,
      `"ratchet/old-zeta": ${JSON.stringify(committed.tests[baseRatchet.id])},\n  "ratchet/old-alpha": {`,
    );
    const structural = parseLintRatchetBaselineStructure(stale);
    expect(structural.baseline).toBeDefined();

    const generated = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const refused = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      { allowWorse: false },
    );
    expect(refused.allowed).toBe(false);
    const orphanFailure = refused.failures.find((f) => f.includes("rename or removal"));
    expect(orphanFailure).toBeDefined();
    // Alphabetical: ratchet/old-alpha then ratchet/old-zeta.
    expect(orphanFailure).toContain("ratchet/old-alpha, ratchet/old-zeta");
  });

  it("still rejects worse counts via structural parse when both ids match", () => {
    const committed = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(committed).replace(
      committed.tests[baseRatchet.id]?.configHash ?? "",
      "sha256:stale",
    );
    const structural = parseLintRatchetBaselineStructure(rendered);
    expect(structural.baseline).toBeDefined();

    const generated = oneTestBaseline([["packages/server/src/a.ts", 2]]);
    const decision = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      { allowWorse: false },
    );

    expect(decision.allowed).toBe(false);
    expect(decision.failures[0]).toContain("generated baseline is worse");
  });

  it("allows complexity-severity structural count-only migration while still rejecting worse counts", () => {
    const path = "packages/server/src/branchy.ts";
    const committed = complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 12)]);
    const countOnly = formatLintRatchetBaseline(committed).replace(
      /,\n\s+"maxComplexity": 12,\n\s+"perFunction": \[(?:[^\n]*\n)*?[ \t]+\]/u,
      "",
    );
    const structural = parseLintRatchetBaselineStructure(countOnly);
    expect(structural.failures).toEqual([]);
    expect(structural.baseline?.tests[complexityRatchet.id]?.items[path]).toEqual({ count: 1 });

    const sameCount = decideLintRatchetUpdate(
      structural.baseline ?? committed,
      complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 50)]),
      [complexityRatchet],
      { allowWorse: false },
    );
    expect(sameCount.allowed).toBe(true);

    const worseCount = decideLintRatchetUpdate(
      structural.baseline ?? committed,
      complexityBaseline(path, [
        complexityFunction(12, "Function 'choose'", 50),
        complexityFunction(32, "Function 'other'", 11),
      ]),
      [complexityRatchet],
      { allowWorse: false },
    );
    expect(worseCount.allowed).toBe(false);
    expect(worseCount.regressions[0]?.reason).toBe("increased-count");
  });
});

describe("lint ratchet rule source hash binding", () => {
  it("rejects a baseline whose ruleSourceHash does not match the current rule source", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline);
    const driftedHashes: LintRatchetRuleSourceHashesById = new Map([
      [baseRatchet.id, `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"b".repeat(64)}`],
    ]);
    const parsed = parseLintRatchetBaseline(rendered, [baseRatchet], driftedHashes);
    expect(parsed.baseline).toBeUndefined();
    expect(parsed.failures).toContain(
      'ratchet/local-type-assertion-boundary.ruleSourceHash is stale (run "bun run lint:ratchet:update" to regenerate)',
    );
  });

  it("requires ruleSourceHash to be present in the committed baseline", () => {
    const baseline = oneTestBaseline([]);
    const renderedWithoutRuleSourceHash = formatLintRatchetBaseline(baseline).replace(
      /^\s*"ruleSourceHash": "[^"]+",\n/mu,
      "",
    );
    const parsed = parseLintRatchetBaseline(
      renderedWithoutRuleSourceHash,
      [baseRatchet],
      fixtureRuleSourceHashes,
    );
    expect(parsed.baseline).toBeUndefined();
    expect(parsed.failures).toContain(
      "ratchet/local-type-assertion-boundary.ruleSourceHash is required",
    );
  });

  it("emits ruleSourceHash deterministically and round-trips it", () => {
    const baseline = oneTestBaseline([["packages/shared/src/x.ts", 2]]);
    const rendered = formatLintRatchetBaseline(baseline);
    expect(rendered).toContain(`"ruleSourceHash": "${FIXTURE_RULE_SOURCE_HASH}"`);
    const parsed = parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes);
    expect(parsed.failures).toEqual([]);
    expect(parsed.baseline?.tests[baseRatchet.id]?.ruleSourceHash).toBe(FIXTURE_RULE_SOURCE_HASH);
  });

  it("structural parse accepts a baseline missing ruleSourceHash so update can fill it in", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline).replace(
      /^\s*"ruleSourceHash": "[^"]+",\n/mu,
      "",
    );
    const structural = parseLintRatchetBaselineStructure(rendered);
    expect(structural.failures).toEqual([]);
    expect(structural.baseline?.tests[baseRatchet.id]?.ruleSourceHash).toBe("");
  });

  it("buildLintRatchetBaseline throws when a ratchet has no rule source hash", () => {
    expect(() =>
      buildLintRatchetBaseline([baseRatchet], current([[baseRatchet.id, []]]), new Map()),
    ).toThrow(/missing rule source hash/u);
  });
});

describe("lint ratchet registry validation", () => {
  it("accepts the valid fixture registry and hashes normalized config deterministically", () => {
    expect(
      validateLintRatchetRegistry([baseRatchet], new Set(["local/type-assertion-boundary"])),
    ).toEqual([]);

    const sameConfigDifferentOptionKeyOrder: LintRatchetConfig = {
      ...baseRatchet,
      ruleOptions: [{ b: true, a: 1 }],
    };
    const normalizedOptionOrder: LintRatchetConfig = {
      ...baseRatchet,
      ruleOptions: [{ a: 1, b: true }],
    };

    expect(computeLintRatchetConfigHash(sameConfigDifferentOptionKeyOrder)).toBe(
      computeLintRatchetConfigHash(normalizedOptionOrder),
    );
    expect(computeLintRatchetConfigHash({ ...baseRatchet, target: 1 })).not.toBe(
      computeLintRatchetConfigHash(baseRatchet),
    );
    expect(
      computeLintRatchetConfigHash({
        ...baseRatchet,
        source: { kind: "local" },
        parserProfile: "minimal-ts",
      }),
    ).toBe(computeLintRatchetConfigHash(baseRatchet));
  });

  it("validates third-party sources against the allowlist and hashes parser identity", () => {
    expect(
      validateLintRatchetRegistry([thirdPartyRatchet], {
        localRuleIds: new Set(["local/type-assertion-boundary"]),
        thirdPartyPlugins: [
          {
            pluginModule: "eslint-plugin-ratchet-fixture",
            ruleNamespace: "ratchet-fixture",
          },
        ],
      }),
    ).toEqual([]);

    expect(validateLintRatchetRegistry([thirdPartyRatchet], {}).join("\n")).toContain(
      "third-party plugin eslint-plugin-ratchet-fixture for namespace ratchet-fixture is not allowlisted",
    );
    const scopedNoHyphenRatchet: LintRatchetConfig = {
      ...thirdPartyRatchet,
      ruleId: "@stylistic/indent",
      source: {
        kind: "third-party",
        pluginModule: "eslint-plugin-stylistic",
      },
    };
    expect(
      validateLintRatchetRegistry([scopedNoHyphenRatchet], {
        thirdPartyPlugins: [
          {
            pluginModule: "eslint-plugin-stylistic",
            ruleNamespace: "@stylistic",
          },
        ],
      }),
    ).toEqual([]);
    expect(ruleNamespace("@stylistic/indent")).toBe("@stylistic");
    expect(ruleNamespace("@badly")).toBeUndefined();
    expect(ruleNamespace("Foo/bar")).toBeUndefined();
    expect(ruleNamespace("@typescript-eslint/strict-boolean-expressions")).toBe(
      "@typescript-eslint",
    );
    expect(
      validateLintRatchetRegistry(
        [
          {
            ...thirdPartyRatchet,
            ruleId: "local/type-assertion-boundary",
          },
        ],
        {
          thirdPartyPlugins: [
            {
              pluginModule: "eslint-plugin-ratchet-fixture",
              ruleNamespace: "ratchet-fixture",
            },
          ],
        },
      ).join("\n"),
    ).toContain("third-party source ruleId must be a non-local namespaced rule id");

    expect(
      computeLintRatchetConfigHash({
        ...thirdPartyRatchet,
        parserProfile: "type-aware-ts",
      }),
    ).not.toBe(computeLintRatchetConfigHash(thirdPartyRatchet));
  });

  it("validates core sources as bare ESLint rule ids across parser profiles", () => {
    const typeAwareCoreRatchet: LintRatchetConfig = {
      ...coreRatchet,
      id: "ratchet/fixture-core-type-aware",
      parserProfile: "type-aware-ts",
    };
    expect(
      validateLintRatchetRegistry([coreRatchet, typeAwareCoreRatchet], {
        thirdPartyPlugins: [],
      }),
    ).toEqual([]);
    expect(computeLintRatchetConfigHash(typeAwareCoreRatchet)).not.toBe(
      computeLintRatchetConfigHash(coreRatchet),
    );

    const ruleSourceHash = computeCoreLintRatchetRuleSourceHash(coreRatchet, "9.0.0");
    const baseline = buildLintRatchetBaseline(
      [coreRatchet],
      current([[coreRatchet.id, [["packages/shared/src/core.ts", 1]]]]),
      new Map([[coreRatchet.id, ruleSourceHash]]),
    );
    const parsed = parseLintRatchetBaseline(
      formatLintRatchetBaseline(baseline),
      [coreRatchet],
      new Map([[coreRatchet.id, ruleSourceHash]]),
    );
    expect(parsed.failures).toEqual([]);
  });

  it("rejects core sources with slashed or non-bare rule ids", () => {
    const bareIdError = "core ruleId must be a bare ESLint built-in id (no slash)";
    expect(
      validateLintRatchetRegistry([
        {
          ...coreRatchet,
          ruleId: "foo/bar",
        },
      ]).join("\n"),
    ).toContain(bareIdError);

    for (const ruleId of ["Complexity", "1complexity", "no_underscore"]) {
      expect(
        validateLintRatchetRegistry([
          {
            ...coreRatchet,
            ruleId,
          },
        ]).join("\n"),
      ).toContain(
        `${coreRatchet.id}: core ruleId must be a bare ESLint built-in id (no slash): ${ruleId}`,
      );
    }
  });

  it("hashes core rule sources with rule options and the ESLint package version", () => {
    const version = "9.0.0";
    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "core",
          ruleId: "complexity",
          ruleOptions: [{ max: 10 }],
          eslintVersion: version,
        }),
      )
      .digest("hex");

    expect(computeCoreLintRatchetRuleSourceHash(coreRatchet, version)).toBe(
      `${LINT_RATCHET_CONFIG_HASH_PREFIX}${expectedHash}`,
    );
    expect(computeCoreLintRatchetRuleSourceHash(coreRatchet, "9.0.1")).not.toBe(
      computeCoreLintRatchetRuleSourceHash(coreRatchet, version),
    );
  });

  it("rejects duplicate ids, unknown local rules, unsorted lists, unsupported modes, duplicate scopes, and unsupported metrics", () => {
    const failures = validateLintRatchetRegistry(
      [
        {
          ...baseRatchet,
          id: "ratchet/z",
          ruleId: "local/unknown",
          files: ["z.ts", "a.ts"],
          mode: "report-only",
        },
        { ...baseRatchet, id: "ratchet/b" },
        { ...baseRatchet, id: "ratchet/a" },
        {
          ...baseRatchet,
          id: "ratchet/other",
          metric: "line-count",
        } as unknown as LintRatchetConfig,
      ],
      new Set(["local/type-assertion-boundary"]),
    );

    expect(failures).toContain("ratchet ids must be sorted and unique");
    expect(failures).toContain("ratchet/z: ruleId local/unknown is not registered");
    expect(failures).toContain("ratchet/z: files must be sorted and duplicate-free");
    expect(failures).toContain("ratchet/z: mode report-only is reserved but not implemented");
    expect(failures).toContain("ratchet/a: duplicates ratchet scope already used by ratchet/b");
    expect(failures).toContain("ratchet/other: metric line-count is not implemented");
  });
});
