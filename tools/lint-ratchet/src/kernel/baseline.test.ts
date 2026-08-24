import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { fixtureWorkflowVocabulary } from "../../test/fixture-workflow-vocabulary.js";
import {
  buildLintRatchetBaseline,
  compareCurrentToBaseline,
  computeLintRatchetConfigHash,
  currentByIdFromBaseline,
  decideLintRatchetUpdate,
  formatLintRatchetBaseline,
  formatZeroToNonzeroWarnings,
  type LintRatchetBaseline,
  type LintRatchetComparison,
  type LintRatchetCurrentById,
  type LintRatchetRuleSourceHashesById,
  parseLintRatchetBaseline,
  parseLintRatchetBaselineStructure,
  ruleNamespace,
  validateLintRatchetRegistry,
} from "./baseline.js";
import {
  createLintRatchetBaselineVersionPolicy,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
} from "./baseline-constants.js";
import { computeCoreLintRatchetRuleSourceHash } from "./baseline-hash.js";

const LINT_RATCHET_BASELINE_REGENERATE = fixtureWorkflowVocabulary.updateCommand;
import { normalizeStringList } from "./baseline-hash.js";
import type { LintRatchetConfig } from "./config-types.js";
import { itemsFromResults } from "./current-collector.js";
import {
  complexityDelta,
  parseComplexitySeverityMessage,
  uniqueComplexityMap,
} from "./metrics-complexity.js";
import { ConfigError, type LintRatchetComplexityFunction } from "./metrics-types.js";
import { RATCHET_REGRESSION_REASON_PLACEHOLDER } from "./recovery-command.js";

// Engine-semantics suites re-homed from scripts/lint-ratchet/baseline.test.ts
// (leaf 12): every ratchet, registry, baseline, and current here is a synthetic
// fixture — the Musi-bound suites (diagnostics envelope rendering, the
// production structure ratchets, committed-baseline byte round-trips, and the
// check-baseline CLI assertions) stay adapter-side.

const baseRatchet: LintRatchetConfig = {
  id: "ratchet/local-type-assertion-boundary",
  ruleId: "local/type-assertion-boundary",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  principle: "Fixture base ratchet principle.",
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
  metric: "message-count",
  principle: "Fixture third-party ratchet principle.",
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
  metric: "message-count",
  principle: "Fixture core ratchet principle.",
};

const maxLinesRatchet = {
  id: "ratchet/local-max-lines-fixture",
  ruleId: "local/max-lines",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [{ max: 300, skipBlankLines: true, skipComments: true }],
  mode: "no-new",
  metric: "effective-line-count",
  principle: "Fixture max-lines ratchet principle.",
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
  metric: "complexity-severity",
  principle: "Fixture complexity ratchet principle.",
};

const FIXTURE_RULE_SOURCE_HASH = `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"a".repeat(64)}`;
const fixtureRuleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [baseRatchet.id, FIXTURE_RULE_SOURCE_HASH],
  [complexityRatchet.id, FIXTURE_RULE_SOURCE_HASH],
  [maxLinesRatchet.id, FIXTURE_RULE_SOURCE_HASH],
]);

function expectedMessageFingerprint(identities: readonly string[]): string {
  const hash = createHash("sha256")
    .update(JSON.stringify([...identities].sort()))
    .digest("hex");
  return `${LINT_RATCHET_CONFIG_HASH_PREFIX}${hash}`;
}

function expectedMessageIdentity(message: string, messageId?: string): string {
  return messageId === undefined ? JSON.stringify({ message }) : JSON.stringify({ messageId });
}

type ComplexityVector = readonly LintRatchetComplexityFunction[];
type CurrentPathEntry = readonly [
  string,
  number,
  number?,
  number?,
  ComplexityVector?,
  string?,
  string?,
  string?,
];

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
        readonly firstMessage?: string;
        readonly firstMessageId?: string;
        readonly messagesFingerprint?: string;
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
        readonly firstMessage?: string;
        readonly firstMessageId?: string;
        readonly messagesFingerprint?: string;
      }
    >();
    for (const [
      path,
      count,
      firstLine,
      lines,
      perFunction,
      firstMessage,
      firstMessageId,
      messagesFingerprint,
    ] of paths) {
      items.set(path, {
        count,
        ...(firstLine === undefined ? {} : { firstLine }),
        ...(lines === undefined ? {} : { lines }),
        ...(perFunction === undefined ? {} : { perFunction }),
        ...(firstMessage === undefined ? {} : { firstMessage }),
        ...(firstMessageId === undefined ? {} : { firstMessageId }),
        ...(messagesFingerprint === undefined ? {} : { messagesFingerprint }),
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
    { workflowVocabulary: fixtureWorkflowVocabulary },
  );
}

function maxLinesBaseline(path: string, lines: number, count = 1): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [maxLinesRatchet],
    current([[maxLinesRatchet.id, [[path, count, 301, lines]]]]),
    fixtureRuleSourceHashes,
    { workflowVocabulary: fixtureWorkflowVocabulary },
  );
}

function complexityFunction(
  line: number,
  label: string,
  complexity: number,
): LintRatchetComplexityFunction {
  return { line, label, complexity };
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
    { workflowVocabulary: fixtureWorkflowVocabulary },
  );
}

interface ComparatorCharacterizationCase {
  readonly name: string;
  readonly baseline: () => LintRatchetBaseline;
  readonly ratchet: LintRatchetConfig;
  readonly current: () => LintRatchetCurrentById;
  readonly expected: LintRatchetComparison;
}

const CHARACTERIZATION_PATH = "packages/server/src/characterization.ts";
const COMPARATOR_CHARACTERIZATION_CASES: readonly ComparatorCharacterizationCase[] = [
  {
    name: "new path",
    baseline: () => oneTestBaseline([]),
    ratchet: baseRatchet,
    current: () => current([[baseRatchet.id, [[CHARACTERIZATION_PATH, 1, 7]]]]),
    expected: {
      regressions: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 0,
          currentCount: 1,
          line: 7,
          reason: "new-path",
        },
      ],
      improvements: [],
      infos: [],
    },
  },
  {
    name: "increased count",
    baseline: () => oneTestBaseline([[CHARACTERIZATION_PATH, 2]]),
    ratchet: baseRatchet,
    current: () => current([[baseRatchet.id, [[CHARACTERIZATION_PATH, 3, 9]]]]),
    expected: {
      regressions: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 2,
          currentCount: 3,
          line: 9,
          reason: "increased-count",
        },
      ],
      improvements: [],
      infos: [],
    },
  },
  {
    name: "increased lines",
    baseline: () => maxLinesBaseline(CHARACTERIZATION_PATH, 320),
    ratchet: maxLinesRatchet,
    current: () => current([[maxLinesRatchet.id, [[CHARACTERIZATION_PATH, 1, 301, 321]]]]),
    expected: {
      regressions: [
        {
          testId: maxLinesRatchet.id,
          ruleId: maxLinesRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 1,
          currentCount: 1,
          baselineLines: 320,
          currentLines: 321,
          line: 301,
          reason: "increased-lines",
        },
      ],
      improvements: [],
      infos: [],
    },
  },
  {
    name: "increased complexity",
    baseline: () =>
      complexityBaseline(CHARACTERIZATION_PATH, [
        complexityFunction(12, "Function 'characterize'", 11),
      ]),
    ratchet: complexityRatchet,
    current: () =>
      current([
        [
          complexityRatchet.id,
          [
            [
              CHARACTERIZATION_PATH,
              1,
              12,
              undefined,
              [complexityFunction(12, "Function 'characterize'", 12)],
            ],
          ],
        ],
      ]),
    expected: {
      regressions: [
        {
          testId: complexityRatchet.id,
          ruleId: complexityRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 1,
          currentCount: 1,
          baselineComplexity: 11,
          currentComplexity: 12,
          line: 12,
          reason: "increased-complexity",
        },
      ],
      improvements: [],
      infos: [],
    },
  },
  {
    name: "removed path",
    baseline: () => oneTestBaseline([[CHARACTERIZATION_PATH, 2]]),
    ratchet: baseRatchet,
    current: () => current([[baseRatchet.id, []]]),
    expected: {
      regressions: [],
      improvements: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 2,
          currentCount: 0,
          reason: "removed-path",
        },
      ],
      infos: [],
    },
  },
  {
    name: "baseline-only item when the current group is absent",
    baseline: () => oneTestBaseline([[CHARACTERIZATION_PATH, 2]]),
    ratchet: baseRatchet,
    current: () => current([]),
    expected: {
      regressions: [],
      improvements: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 2,
          currentCount: 0,
          reason: "removed-path",
        },
      ],
      infos: [],
    },
  },
  {
    name: "empty group",
    baseline: () => oneTestBaseline([]),
    ratchet: baseRatchet,
    current: () => current([]),
    expected: { regressions: [], improvements: [], infos: [] },
  },
  {
    name: "orphan group",
    baseline: () => {
      const registered = oneTestBaseline([]);
      const registeredTest = registered.tests[baseRatchet.id];
      if (registeredTest === undefined) throw new Error("missing registered characterization test");
      return {
        ...registered,
        tests: {
          ...registered.tests,
          "ratchet/orphan-characterization": {
            ...registeredTest,
            items: { [CHARACTERIZATION_PATH]: { count: 4 } },
          },
        },
      };
    },
    ratchet: baseRatchet,
    current: () => current([]),
    expected: { regressions: [], improvements: [], infos: [] },
  },
  {
    name: "lowered count",
    baseline: () => oneTestBaseline([[CHARACTERIZATION_PATH, 2]]),
    ratchet: baseRatchet,
    current: () => current([[baseRatchet.id, [[CHARACTERIZATION_PATH, 1]]]]),
    expected: {
      regressions: [],
      improvements: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 2,
          currentCount: 1,
          reason: "lower-count",
        },
      ],
      infos: [],
    },
  },
  {
    name: "lowered lines",
    baseline: () => maxLinesBaseline(CHARACTERIZATION_PATH, 320),
    ratchet: maxLinesRatchet,
    current: () => current([[maxLinesRatchet.id, [[CHARACTERIZATION_PATH, 1, 301, 319]]]]),
    expected: {
      regressions: [],
      improvements: [
        {
          testId: maxLinesRatchet.id,
          ruleId: maxLinesRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 1,
          currentCount: 1,
          baselineLines: 320,
          currentLines: 319,
          reason: "lower-lines",
        },
      ],
      infos: [],
    },
  },
  {
    name: "lowered complexity",
    baseline: () =>
      complexityBaseline(CHARACTERIZATION_PATH, [
        complexityFunction(12, "Function 'characterize'", 12),
      ]),
    ratchet: complexityRatchet,
    current: () =>
      current([
        [
          complexityRatchet.id,
          [
            [
              CHARACTERIZATION_PATH,
              1,
              12,
              undefined,
              [complexityFunction(12, "Function 'characterize'", 11)],
            ],
          ],
        ],
      ]),
    expected: {
      regressions: [],
      improvements: [
        {
          testId: complexityRatchet.id,
          ruleId: complexityRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 1,
          currentCount: 1,
          baselineComplexity: 12,
          currentComplexity: 11,
          reason: "lower-complexity",
        },
      ],
      infos: [],
    },
  },
  {
    name: "equal-count payload swap",
    baseline: () =>
      buildLintRatchetBaseline(
        [baseRatchet],
        current([
          [
            baseRatchet.id,
            [
              [
                CHARACTERIZATION_PATH,
                2,
                7,
                undefined,
                undefined,
                undefined,
                undefined,
                expectedMessageFingerprint(["first", "second"]),
              ],
            ],
          ],
        ]),
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ),
    ratchet: baseRatchet,
    current: () =>
      current([
        [
          baseRatchet.id,
          [
            [
              CHARACTERIZATION_PATH,
              2,
              11,
              undefined,
              undefined,
              undefined,
              undefined,
              expectedMessageFingerprint(["first", "replacement"]),
            ],
          ],
        ],
      ]),
    expected: {
      regressions: [],
      improvements: [],
      infos: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: CHARACTERIZATION_PATH,
          baselineCount: 2,
          currentCount: 2,
          reason: "equal-count-message-swap",
        },
      ],
    },
  },
];

describe("complexity message parsing", () => {
  it.each([
    ["Function 'choose'", 12],
    ["Method 'choose'", 13],
    ["Arrow function", 14],
  ])("parses core complexity diagnostics for %s", (label, complexity) => {
    expect(
      parseComplexitySeverityMessage("ratchet/fixture-complexity", "packages/app/src/example.ts", {
        message: `${label} has a complexity of ${String(complexity)}. Maximum allowed is 10.`,
        line: 7,
        messageId: "complex",
      }),
    ).toEqual(complexityFunction(7, label, complexity));
  });

  it("allows core complexity diagnostics without messageId", () => {
    expect(
      parseComplexitySeverityMessage("ratchet/fixture-complexity", "packages/app/src/example.ts", {
        message: "Function 'choose' has a complexity of 12. Maximum allowed is 10.",
        line: 7,
      }),
    ).toEqual(complexityFunction(7, "Function 'choose'", 12));
  });

  it("rejects unknown complexity diagnostic message shapes", () => {
    expect(() =>
      parseComplexitySeverityMessage("ratchet/fixture-complexity", "packages/app/src/example.ts", {
        message: "Function 'choose' has a complexity of 12. Maximum allowed is 10.",
        line: 7,
        messageId: "complexity-high",
      }),
    ).toThrow(ConfigError);
    expect(() =>
      parseComplexitySeverityMessage("ratchet/fixture-complexity", "packages/app/src/example.ts", {
        message: "Function 'choose' is too complex.",
        line: 7,
      }),
    ).toThrow(ConfigError);
  });
});

describe("lint ratchet comparison", () => {
  it.each(COMPARATOR_CHARACTERIZATION_CASES)(
    "characterizes $name for the kernel migration oracle",
    ({ baseline, ratchet, current: currentFixture, expected }) => {
      expect(
        compareCurrentToBaseline(
          baseline(),
          [ratchet],
          currentFixture(),
          fixtureWorkflowVocabulary,
        ),
      ).toEqual(expected);
    },
  );

  it("flags a new path with findings as a regression", () => {
    const baseline = oneTestBaseline([]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [baseRatchet],
      current([[baseRatchet.id, [["packages/server/src/new.ts", 1, 7]]]]),
      fixtureWorkflowVocabulary,
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
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );
    const generated = maxLinesBaseline(path, 350);
    const comparison = compareCurrentToBaseline(
      baseline,
      [maxLinesRatchet],
      currentByIdFromBaseline(generated),
      fixtureWorkflowVocabulary,
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
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );
    const generated = complexityBaseline(path, [
      complexityFunction(10, "Function 'newBranch'", 25),
    ]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [complexityRatchet],
      currentByIdFromBaseline(generated),
      fixtureWorkflowVocabulary,
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
      { workflowVocabulary: fixtureWorkflowVocabulary },
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
      fixtureWorkflowVocabulary,
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
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );
    const currentById: LintRatchetCurrentById = new Map([
      [complexityRatchet.id, new Map([[path, { count: 1, maxComplexity: 33 }]])],
    ]);
    const comparison = compareCurrentToBaseline(
      baseline,
      [complexityRatchet],
      currentById,
      fixtureWorkflowVocabulary,
    );

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
      fixtureWorkflowVocabulary,
    );

    expect(comparison.regressions).toHaveLength(1);
    expect(comparison.regressions[0]?.reason).toBe("increased-count");
  });

  it("carries first message context on message-count regressions", () => {
    const path = "packages/server/src/app.ts";
    const comparison = compareCurrentToBaseline(
      oneTestBaseline([[path, 1]]),
      [baseRatchet],
      current([
        [
          baseRatchet.id,
          [
            [
              path,
              2,
              12,
              undefined,
              undefined,
              "Why: Type assertion escaped the boundary. How to fix: Keep the assertion near JSON parsing.",
              "unexpectedAssertion",
            ],
          ],
        ],
      ]),
      fixtureWorkflowVocabulary,
    );

    expect(comparison.regressions).toEqual([
      {
        testId: baseRatchet.id,
        ruleId: baseRatchet.ruleId,
        path,
        baselineCount: 1,
        currentCount: 2,
        line: 12,
        firstMessage:
          "Why: Type assertion escaped the boundary. How to fix: Keep the assertion near JSON parsing.",
        firstMessageId: "unexpectedAssertion",
        reason: "increased-count",
      },
    ]);
  });

  it("keeps first message text and messageId paired while aggregating findings", () => {
    const path = "packages/server/src/app.ts";
    const items = itemsFromResults(
      baseRatchet,
      [
        {
          filePath: path,
          messages: [
            {
              ruleId: baseRatchet.ruleId,
              severity: 2,
              line: 12,
              message: "Why: first finding. How to fix: Keep the first guidance.",
            },
            {
              ruleId: baseRatchet.ruleId,
              severity: 2,
              line: 20,
              message: "Why: second finding. How to fix: Do not mix message ids.",
              messageId: "secondMessage",
            },
          ],
        },
      ],
      "",
    );

    expect(items.get(path)).toEqual({
      count: 2,
      firstLine: 12,
      firstMessage: "Why: first finding. How to fix: Keep the first guidance.",
      messagesFingerprint: expectedMessageFingerprint([
        expectedMessageIdentity("Why: first finding. How to fix: Keep the first guidance."),
        expectedMessageIdentity(
          "Why: second finding. How to fix: Do not mix message ids.",
          "secondMessage",
        ),
      ]),
    });
  });

  it("fingerprints sorted message identities without line-number churn", () => {
    const path = "packages/server/src/app.ts";
    const items = itemsFromResults(
      baseRatchet,
      [
        {
          filePath: path,
          messages: [
            {
              ruleId: baseRatchet.ruleId,
              severity: 2,
              line: 40,
              message: "Why: message-only finding. How to fix: Keep the message.",
            },
            {
              ruleId: baseRatchet.ruleId,
              severity: 2,
              line: 10,
              message: "Why: identified finding. How to fix: Keep the id.",
              messageId: "identifiedFinding",
            },
          ],
        },
      ],
      "",
    );

    expect(items.get(path)).toMatchObject({
      count: 2,
      firstLine: 10,
      messagesFingerprint: expectedMessageFingerprint([
        expectedMessageIdentity("Why: message-only finding. How to fix: Keep the message."),
        expectedMessageIdentity(
          "Why: identified finding. How to fix: Keep the id.",
          "identifiedFinding",
        ),
      ]),
    });
  });

  it("fingerprints only messageId while preserving duplicate identities in the multiset", () => {
    const path = "packages/server/src/router.ts";
    const items = itemsFromResults(
      baseRatchet,
      [
        {
          filePath: path,
          messages: [
            {
              ruleId: baseRatchet.ruleId,
              severity: 2,
              line: 10,
              message: "Why: first branch. How to fix: Do the first repair.",
              messageId: "staticMessage",
            },
            {
              ruleId: baseRatchet.ruleId,
              severity: 2,
              line: 20,
              message: "Why: second branch. How to fix: Do the second repair.",
              messageId: "staticMessage",
            },
          ],
        },
      ],
      "",
    );

    expect(items.get(path)).toMatchObject({
      count: 2,
      messagesFingerprint: expectedMessageFingerprint([
        expectedMessageIdentity(
          "Why: first branch. How to fix: Do the first repair.",
          "staticMessage",
        ),
        expectedMessageIdentity(
          "Why: second branch. How to fix: Do the second repair.",
          "staticMessage",
        ),
      ]),
    });
  });

  it("normalizes message-less compiler locations and code frames without hiding semantics", () => {
    const relativeFilePath = "packages/client/src/example.tsx";
    const semanticMessage = "Error: Calling setState synchronously is not supported.";

    function fingerprintFor(rootPath: string, line: number, semantic = semanticMessage): string {
      const filePath = `${rootPath}/${relativeFilePath}`;
      const items = itemsFromResults(
        baseRatchet,
        [
          {
            filePath,
            messages: [
              {
                ruleId: baseRatchet.ruleId,
                severity: 2,
                line,
                column: 7,
                message: `${semantic}\n\n${filePath}:${String(line)}:7\n  ${String(line - 1)} | useEffect(() => {\n> ${String(line)} |       setValue(next);\n     |       ^^^^^^^^ Avoid calling setState() directly within an effect\n  ${String(line + 1)} | });`,
              },
            ],
          },
        ],
        rootPath,
      );
      const fingerprint = items.get(relativeFilePath)?.messagesFingerprint;
      expect(fingerprint).toBeDefined();
      return fingerprint ?? "";
    }

    const first = fingerprintFor("/tmp/first-clone", 10);
    const second = fingerprintFor("/opt/another/repo", 310);
    const semanticChange = fingerprintFor(
      "/opt/another/repo",
      310,
      "Error: Calling a different API is not supported.",
    );

    expect(first).toBe(second);
    expect(semanticChange).not.toBe(first);
  });

  it("counts only this ratchet's ruleId, excluding foreign-rule messages", () => {
    // One matching message plus one from a DIFFERENT rule on the same path.
    // The foreign-rule message must be filtered out, so count is 1 — killing
    // the `message.ruleId !== ratchet.ruleId` -> `false` mutant (finding 80),
    // which would count the foreign rule and report 2.
    const path = "packages/server/src/app.ts";
    const items = itemsFromResults(
      baseRatchet,
      [
        {
          filePath: path,
          messages: [
            {
              ruleId: baseRatchet.ruleId,
              severity: 2,
              line: 7,
              message: "Why: matching finding. How to fix: Keep the boundary.",
            },
            {
              ruleId: "local/some-other-rule",
              severity: 2,
              line: 9,
              message: "Why: a different rule entirely. How to fix: ignored here.",
            },
          ],
        },
      ],
      "",
    );

    expect(items.get(path)).toEqual({
      count: 1,
      firstLine: 7,
      firstMessage: "Why: matching finding. How to fix: Keep the boundary.",
      messagesFingerprint: expectedMessageFingerprint([
        expectedMessageIdentity("Why: matching finding. How to fix: Keep the boundary."),
      ]),
    });
  });

  it("throws ConfigError on a fatal null-ruleId parse failure", () => {
    // ruleId: null + fatal: true is an ESLint parse failure and must throw so
    // the ratchet fails loudly rather than silently recording zero findings.
    // Kills the `message.ruleId === null &&` -> `false` mutant (finding 80).
    const path = "packages/server/src/broken.ts";
    expect(() =>
      itemsFromResults(
        baseRatchet,
        [
          {
            filePath: path,
            messages: [
              {
                ruleId: null,
                severity: 2,
                fatal: true,
                message: "Parsing error: Unexpected token",
              },
            ],
          },
        ],
        "",
      ),
    ).toThrow(/ESLint could not parse/);
  });

  it("throws ConfigError on a null-ruleId error-severity message", () => {
    // The `&&`'s second clause: ruleId: null with error severity (2) and no
    // explicit fatal flag still signals an unparseable file. Pins the
    // `severity === ESLINT_SEVERITY_ERROR` branch of the fatal-parse guard.
    const path = "packages/server/src/broken.ts";
    expect(() =>
      itemsFromResults(
        baseRatchet,
        [
          {
            filePath: path,
            messages: [{ ruleId: null, severity: 2, message: "Parsing error: Unexpected token" }],
          },
        ],
        "",
      ),
    ).toThrow(/ESLint could not parse/);
  });

  it("skips a null-ruleId warning without throwing or recording a finding", () => {
    // ruleId: null with WARNING severity (1) and fatal: false is not a parse
    // failure: it must not throw, and — being a foreign (null) ruleId — it is
    // skipped, so no entry is added. Pins the second clause of the `&&` guard
    // as a guard, not an unconditional throw.
    const path = "packages/server/src/warned.ts";
    const items = itemsFromResults(
      baseRatchet,
      [
        {
          filePath: path,
          messages: [
            { ruleId: null, severity: 1, fatal: false, message: "A non-fatal processor warning" },
          ],
        },
      ],
      "",
    );

    expect(items.has(path)).toBe(false);
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
      fixtureWorkflowVocabulary,
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

  it("reports equal-count message fingerprint swaps as informational", () => {
    const path = "packages/client/src/a.ts";
    const baseline = buildLintRatchetBaseline(
      [baseRatchet],
      current([
        [
          baseRatchet.id,
          [
            [
              path,
              2,
              7,
              undefined,
              undefined,
              undefined,
              undefined,
              expectedMessageFingerprint(["first", "second"]),
            ],
          ],
        ],
      ]),
      fixtureRuleSourceHashes,
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );
    const comparison = compareCurrentToBaseline(
      baseline,
      [baseRatchet],
      current([
        [
          baseRatchet.id,
          [
            [
              path,
              2,
              11,
              undefined,
              undefined,
              undefined,
              undefined,
              expectedMessageFingerprint(["first", "replacement"]),
            ],
          ],
        ],
      ]),
      fixtureWorkflowVocabulary,
    );

    expect(comparison.regressions).toEqual([]);
    expect(comparison.improvements).toEqual([]);
    expect(comparison.infos).toEqual([
      {
        testId: baseRatchet.id,
        ruleId: baseRatchet.ruleId,
        path,
        baselineCount: 2,
        currentCount: 2,
        reason: "equal-count-message-swap",
      },
    ]);
  });

  it("does not report equal-count swaps before a baseline has a message fingerprint", () => {
    const path = "packages/client/src/a.ts";
    const comparison = compareCurrentToBaseline(
      oneTestBaseline([[path, 2]]),
      [baseRatchet],
      current([
        [
          baseRatchet.id,
          [
            [
              path,
              2,
              11,
              undefined,
              undefined,
              undefined,
              undefined,
              expectedMessageFingerprint(["replacement"]),
            ],
          ],
        ],
      ]),
      fixtureWorkflowVocabulary,
    );

    expect(comparison.infos).toEqual([]);
  });

  it("flags effective line growth when diagnostic count is unchanged", () => {
    const path = "packages/server/src/large.ts";
    const baseline = maxLinesBaseline(path, 320);
    const comparison = compareCurrentToBaseline(
      baseline,
      [maxLinesRatchet],
      current([[maxLinesRatchet.id, [[path, 1, 301, 321]]]]),
      fixtureWorkflowVocabulary,
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
      fixtureWorkflowVocabulary,
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
      fixtureWorkflowVocabulary,
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
      fixtureWorkflowVocabulary,
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
      fixtureWorkflowVocabulary,
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
      fixtureWorkflowVocabulary,
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
      fixtureWorkflowVocabulary,
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
      fixtureWorkflowVocabulary,
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
      fixtureWorkflowVocabulary,
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

describe("lint ratchet baseline parsing", () => {
  it("orders baseline item keys by codepoint rather than locale collation", () => {
    const paths = ["a_b", "a-b", "ab", "aB"];

    expect(
      Object.keys(
        oneTestBaseline(paths.map((path) => [path, 1])).tests[baseRatchet.id]?.items ?? {},
      ),
    ).toEqual(["a-b", "aB", "a_b", "ab"]);
  });

  it("does not serialize current-run message context into the baseline", () => {
    const baseline = buildLintRatchetBaseline(
      [baseRatchet],
      current([
        [
          baseRatchet.id,
          [
            [
              "packages/server/src/app.ts",
              1,
              7,
              undefined,
              undefined,
              "Why: Type assertion escaped the boundary. How to fix: Keep it near JSON parsing.",
              "unexpectedAssertion",
              expectedMessageFingerprint(["unexpectedAssertion"]),
            ],
          ],
        ],
      ]),
      fixtureRuleSourceHashes,
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );

    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary);

    expect(rendered).not.toContain("Type assertion escaped");
    expect(rendered).not.toContain("unexpectedAssertion");
    expect(rendered).toContain(
      `"messagesFingerprint": "${expectedMessageFingerprint(["unexpectedAssertion"])}"`,
    );
    expect(
      parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).baseline,
    ).toEqual(baseline);
  });

  it("round-trips deterministic baseline JSON", () => {
    const baseline = oneTestBaseline([["packages/shared/src/schema.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary);
    const parsed = parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes, {
      workflowVocabulary: fixtureWorkflowVocabulary,
    });

    expect(parsed.failures).toEqual([]);
    expect(parsed.baseline).toEqual(baseline);
  });

  it("emits and preserves the v2 regenerate annotation without making staleness fatal", () => {
    const writeV2 = createLintRatchetBaselineVersionPolicy(2);
    const generated = buildLintRatchetBaseline(
      [baseRatchet],
      current([[baseRatchet.id, []]]),
      fixtureRuleSourceHashes,
      { workflowVocabulary: fixtureWorkflowVocabulary, versionPolicy: writeV2 },
    );
    const rendered = formatLintRatchetBaseline(generated, fixtureWorkflowVocabulary);

    expect(rendered).toContain('"version": 2');
    expect(rendered).toContain(`"regenerate": "${LINT_RATCHET_BASELINE_REGENERATE}"`);

    const staleCommand = "bun run lint:ratchet:legacy-update";
    const stale = rendered.replace(LINT_RATCHET_BASELINE_REGENERATE, staleCommand);
    const parsed = parseLintRatchetBaseline(stale, [baseRatchet], fixtureRuleSourceHashes, {
      workflowVocabulary: fixtureWorkflowVocabulary,
      versionPolicy: writeV2,
    });

    expect(parsed.failures).toEqual([]);
    expect(parsed.warnings).toEqual([
      `baseline regenerate annotation is stale; regenerate with \`${LINT_RATCHET_BASELINE_REGENERATE}\` (committed ${JSON.stringify(staleCommand)})`,
    ]);
    expect(formatLintRatchetBaseline(parsed.baseline ?? generated, fixtureWorkflowVocabulary)).toBe(
      stale,
    );
  });

  it("tolerates a missing v2 regenerate annotation", () => {
    const writeV2 = createLintRatchetBaselineVersionPolicy(2);
    const rendered = formatLintRatchetBaseline(
      buildLintRatchetBaseline(
        [baseRatchet],
        current([[baseRatchet.id, []]]),
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary, versionPolicy: writeV2 },
      ),
      fixtureWorkflowVocabulary,
    ).replace(/^ {2}"regenerate": .*\n/mu, "");
    const parsed = parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes, {
      workflowVocabulary: fixtureWorkflowVocabulary,
      versionPolicy: writeV2,
    });

    expect(parsed.failures).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(
      formatLintRatchetBaseline(parsed.baseline ?? oneTestBaseline([]), fixtureWorkflowVocabulary),
    ).toBe(rendered);
  });

  it("rejects unknown version, missing tests, bad ids, negative counts, and non-deterministic output", () => {
    expect(
      parseLintRatchetBaseline(
        '{"version":3,"tests":{}}\n',
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain("baseline version must be one of 1, 2");
    expect(
      parseLintRatchetBaseline(
        '{"version":2,"tool":"fixture","metric":"count","entries":[]}\n',
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain("baseline has wrong document family: expected 'tests', found 'entries'");
    expect(
      parseLintRatchetBaseline('{"version":1}\n', [baseRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toContain("baseline tests must be an object");
    expect(
      parseLintRatchetBaseline(
        '{"version":1,"tests":{"bad":{"ruleId":"local/type-assertion-boundary","mode":"no-new","target":0,"metric":"message-count","files":["packages/**/*.ts"],"ignores":[],"ruleOptions":[],"configHash":"sha256:x","items":{}}}}\n',
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain("bad: id must match ratchet/<name>");
    expect(
      parseLintRatchetBaseline(
        '{"version":1,"tests":{"ratchet/local-type-assertion-boundary":{"ruleId":"local/type-assertion-boundary","mode":"no-new","target":0,"metric":"message-count","files":["packages/**/*.ts"],"ignores":[],"ruleOptions":[],"configHash":"sha256:x","items":{"packages/a.ts":{"count":-1}}}}}\n',
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain(
      "ratchet/local-type-assertion-boundary.items.packages/a.ts: count must be a non-negative integer",
    );

    const rendered = formatLintRatchetBaseline(
      oneTestBaseline([]),
      fixtureWorkflowVocabulary,
    ).trimEnd();
    expect(
      parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toContain("baseline JSON is not deterministic; run bun run lint:ratchet:update");
  });

  it("requires effective-line-count items to carry lines in strict parse", () => {
    const path = "packages/server/src/large.ts";
    const rendered = formatLintRatchetBaseline(
      maxLinesBaseline(path, 320),
      fixtureWorkflowVocabulary,
    );
    expect(
      parseLintRatchetBaseline(rendered, [maxLinesRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toEqual([]);

    const countOnly = rendered.replace(/,\n\s+"lines": 320/u, "");
    expect(
      parseLintRatchetBaseline(countOnly, [maxLinesRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toContain(`${maxLinesRatchet.id}.items.${path}.lines is required for effective-line-count`);
    expect(
      parseLintRatchetBaselineStructure(countOnly, fixtureWorkflowVocabulary).failures,
    ).toEqual([]);
  });

  it("validates message fingerprints only on message-count items", () => {
    const messagePath = "packages/server/src/app.ts";
    const fingerprint = expectedMessageFingerprint([
      expectedMessageIdentity(
        "Why: Type assertion escaped the boundary. How to fix: Keep the assertion near JSON parsing.",
        "unexpectedAssertion",
      ),
    ]);
    const messageBaseline = buildLintRatchetBaseline(
      [baseRatchet],
      current([
        [
          baseRatchet.id,
          [[messagePath, 1, 7, undefined, undefined, undefined, undefined, fingerprint]],
        ],
      ]),
      fixtureRuleSourceHashes,
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );
    const renderedMessageBaseline = formatLintRatchetBaseline(
      messageBaseline,
      fixtureWorkflowVocabulary,
    );
    expect(
      parseLintRatchetBaseline(renderedMessageBaseline, [baseRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toEqual([]);

    const invalidFingerprint = renderedMessageBaseline.replace(fingerprint, "sha256:not-a-hash");
    expect(
      parseLintRatchetBaseline(invalidFingerprint, [baseRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toContain(
      `${baseRatchet.id}.items.${messagePath}: messagesFingerprint must be a sha256 hash`,
    );

    const linePath = "packages/server/src/large.ts";
    const lineBaseline = formatLintRatchetBaseline(
      maxLinesBaseline(linePath, 320),
      fixtureWorkflowVocabulary,
    ).replace(/"count": 1,/u, `"count": 1,\n          "messagesFingerprint": "${fingerprint}",`);
    expect(
      parseLintRatchetBaseline(lineBaseline, [maxLinesRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toContain(
      `${maxLinesRatchet.id}.items.${linePath}.messagesFingerprint is only valid for message-count`,
    );
  });

  it("requires complexity-severity items to carry maxComplexity and perFunction in strict parse", () => {
    const path = "packages/server/src/branchy.ts";
    const rendered = formatLintRatchetBaseline(
      complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 12)]),
      fixtureWorkflowVocabulary,
    );
    expect(
      parseLintRatchetBaseline(rendered, [complexityRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toEqual([]);

    const countOnly = rendered.replace(
      /,\n\s+"maxComplexity": 12,\n\s+"perFunction": \[(?:[^\n]*\n)*?[ \t]+\]/u,
      "",
    );
    expect(
      parseLintRatchetBaseline(countOnly, [complexityRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toEqual([
      `${complexityRatchet.id}.items.${path}.maxComplexity is required for complexity-severity`,
      `${complexityRatchet.id}.items.${path}.perFunction is required for complexity-severity`,
    ]);
    expect(
      parseLintRatchetBaselineStructure(countOnly, fixtureWorkflowVocabulary).failures,
    ).toEqual([]);
  });

  it("rejects stale config identity, unknown metrics, missing files, missing ruleOptions, and unknown registry ids", () => {
    const baseline = oneTestBaseline([]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary);
    expect(
      parseLintRatchetBaseline(
        rendered.replace("message-count", "line-count"),
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain("ratchet/local-type-assertion-boundary: metric is unknown");
    expect(
      parseLintRatchetBaseline(
        '{"version":1,"tests":{"ratchet/local-type-assertion-boundary":{"ruleId":"local/type-assertion-boundary","mode":"no-new","target":0,"metric":"message-count","ignores":[],"ruleOptions":[],"configHash":"sha256:x","items":{}}}}\n',
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain("ratchet/local-type-assertion-boundary: files is required");
    expect(
      parseLintRatchetBaseline(
        rendered.replace('"ruleOptions": [],', ""),
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain("ratchet/local-type-assertion-boundary: ruleOptions is required");
    expect(
      parseLintRatchetBaseline(
        rendered.replace(baseRatchet.id, "ratchet/unknown"),
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain("ratchet/unknown: baseline has no matching ratchet registry entry");
    expect(
      parseLintRatchetBaseline(
        rendered.replace(
          baseline.tests[baseRatchet.id]?.configHash ?? "",
          `sha256:${"e".repeat(64)}`,
        ),
        [baseRatchet],
        fixtureRuleSourceHashes,
        { workflowVocabulary: fixtureWorkflowVocabulary },
      ).failures,
    ).toContain("ratchet/local-type-assertion-boundary.configHash is stale");
  });
});

describe("lint ratchet update decisions", () => {
  it("requires explicit acceptance when changed globs drop baselined paths", () => {
    const droppedPath = "packages/server/src/excluded.ts";
    const fixedPath = "packages/server/src/fixed.ts";
    const narrowedRatchet = {
      ...baseRatchet,
      ignores: [droppedPath],
    } satisfies LintRatchetConfig;
    const committed = oneTestBaseline([
      ["packages/server/src/a.ts", 1],
      [droppedPath, 2],
      [fixedPath, 1],
    ]);
    const generated = buildLintRatchetBaseline(
      [narrowedRatchet],
      new Map([[narrowedRatchet.id, new Map([["packages/server/src/a.ts", { count: 1 }]])]]),
      fixtureRuleSourceHashes,
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );

    const refused = decideLintRatchetUpdate(committed, generated, [narrowedRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.failures.join("\n")).toContain("coverage shrink");
    expect(refused.coverageShrinks).toEqual([
      expect.objectContaining({
        ratchetId: baseRatchet.id,
        removedPaths: [droppedPath],
      }),
    ]);

    const accepted = decideLintRatchetUpdate(committed, generated, [narrowedRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: true,
      reason: "exclude generated compatibility code from this floor",
    });
    expect(accepted.allowed).toBe(true);
    expect(accepted.coverageShrinks).toHaveLength(1);
  });

  it("keeps covered removed paths as improvements when globs also change", () => {
    const changedRatchet = {
      ...baseRatchet,
      ignores: ["packages/server/src/unrelated.ts"],
    } satisfies LintRatchetConfig;
    const committed = oneTestBaseline([
      ["packages/server/src/a.ts", 1],
      ["packages/server/src/fixed.ts", 1],
    ]);
    const generated = buildLintRatchetBaseline(
      [changedRatchet],
      new Map([[changedRatchet.id, new Map([["packages/server/src/a.ts", { count: 1 }]])]]),
      fixtureRuleSourceHashes,
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );

    const decision = decideLintRatchetUpdate(committed, generated, [changedRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.coverageShrinks).toEqual([]);
    expect(decision.improvements).toEqual([
      expect.objectContaining({
        path: "packages/server/src/fixed.ts",
        reason: "removed-path",
      }),
    ]);
  });

  it("keeps removed paths as improvements when ratchet globs are unchanged", () => {
    const committed = oneTestBaseline([
      ["packages/server/src/a.ts", 1],
      ["packages/server/src/fixed.ts", 1],
    ]);
    const generated = oneTestBaseline([["packages/server/src/a.ts", 1]]);

    const decision = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.coverageShrinks).toEqual([]);
    expect(decision.improvements).toEqual([
      expect.objectContaining({
        path: "packages/server/src/fixed.ts",
        reason: "removed-path",
      }),
    ]);
  });

  it("refuses worse generated baselines unless allowed with a reason", () => {
    const committed = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const generated = oneTestBaseline([["packages/server/src/a.ts", 2]]);

    const refused = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.failures[0]).toContain("generated baseline is worse");
    expect(refused.failures[0]).toContain(`--reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}"`);

    const missingReason = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: true,
      reason: " ",
    });
    expect(missingReason.allowed).toBe(false);
    expect(missingReason.failures).toContain("--allow-worse requires a non-empty --reason");

    const placeholderReason = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: true,
      reason: RATCHET_REGRESSION_REASON_PLACEHOLDER,
    });
    expect(placeholderReason.allowed).toBe(false);
    expect(placeholderReason.failures).toContain(
      "--allow-worse requires a real --reason, not the placeholder",
    );

    const accepted = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
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
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
    });

    expect(refused.allowed).toBe(false);
    expect(refused.failures[0]).toContain("generated baseline is worse");
    expect(refused.regressions[0]?.reason).toBe("increased-lines");

    const accepted = decideLintRatchetUpdate(committed, generated, [maxLinesRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
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
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
    });

    expect(refused.allowed).toBe(false);
    expect(refused.failures[0]).toContain("generated baseline is worse");
    expect(refused.regressions[0]?.reason).toBe("increased-complexity");

    const accepted = decideLintRatchetUpdate(committed, generated, [complexityRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
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
      workflowVocabulary: fixtureWorkflowVocabulary,
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
      workflowVocabulary: fixtureWorkflowVocabulary,
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
      workflowVocabulary: fixtureWorkflowVocabulary,
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
      workflowVocabulary: fixtureWorkflowVocabulary,
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
});

describe("lint ratchet structural parsing", () => {
  it("accepts a deterministic baseline with stale registry metadata so update can recover", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary);

    // Mutate a registry-identity field that would fail the strict parse but
    // not the structural shape (configHash, files, ruleOptions, etc.).
    const staleConfigHash = rendered.replace(
      baseline.tests[baseRatchet.id]?.configHash ?? "",
      `sha256:${"f".repeat(64)}`,
    );
    expect(
      parseLintRatchetBaseline(staleConfigHash, [baseRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toContain("ratchet/local-type-assertion-boundary.configHash is stale");
    const structuralStale = parseLintRatchetBaselineStructure(
      staleConfigHash,
      fixtureWorkflowVocabulary,
    );
    expect(structuralStale.failures).toEqual([]);
    expect(structuralStale.baseline?.tests[baseRatchet.id]?.configHash).toBe(
      `sha256:${"f".repeat(64)}`,
    );
    expect(structuralStale.baseline?.tests[baseRatchet.id]?.items).toEqual({
      "packages/server/src/a.ts": { count: 1 },
    });
  });

  it("rejects malformed config and rule-source hashes in structural parsing", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary);
    for (const field of ["configHash", "ruleSourceHash"] as const) {
      const valid = baseline.tests[baseRatchet.id]?.[field] ?? "";
      for (const malformed of ["sha256:", "sha256:not-a-hash"]) {
        expect(
          parseLintRatchetBaselineStructure(
            rendered.replace(valid, malformed),
            fixtureWorkflowVocabulary,
          ).failures,
        ).toContain(`${baseRatchet.id}: ${field} must be a sha256 hash`);
      }
    }
  });

  it("accepts a structural baseline with an unknown registry id so update can drop it", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary).replace(
      baseRatchet.id,
      "ratchet/old-removed-rule",
    );
    expect(
      parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toContain("ratchet/old-removed-rule: baseline has no matching ratchet registry entry");
    const structural = parseLintRatchetBaselineStructure(rendered, fixtureWorkflowVocabulary);
    expect(structural.failures).toEqual([]);
    expect(Object.keys(structural.baseline?.tests ?? {})).toEqual(["ratchet/old-removed-rule"]);
  });

  it("accepts a non-deterministic but well-formed JSON layout so update can re-emit canonical text", () => {
    const baseline = oneTestBaseline([]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary).trimEnd();
    expect(
      parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes, {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }).failures,
    ).toContain("baseline JSON is not deterministic; run bun run lint:ratchet:update");
    expect(parseLintRatchetBaselineStructure(rendered, fixtureWorkflowVocabulary).failures).toEqual(
      [],
    );
  });

  it("rejects malformed JSON in structural parse as a hard error", () => {
    expect(
      parseLintRatchetBaselineStructure("{not-json}\n", fixtureWorkflowVocabulary).failures,
    ).toEqual([expect.stringMatching(/^baseline is not valid JSON: /u)]);
    expect(
      parseLintRatchetBaselineStructure('"a string"\n', fixtureWorkflowVocabulary).failures,
    ).toContain("baseline must be a JSON object");
    expect(
      parseLintRatchetBaselineStructure('{"version":1}\n', fixtureWorkflowVocabulary).failures,
    ).toContain("baseline tests must be an object");
  });

  it("replaces a generic JSON error with merge-driver recovery for conflict markers", () => {
    expect(
      parseLintRatchetBaselineStructure(
        '<<<<<<< ours\n{"version":1}\n=======\n{"version":1}\n>>>>>>> theirs\n',
        fixtureWorkflowVocabulary,
      ).failures,
    ).toEqual([
      "lint-ratchet.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run lint:ratchet:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours lint-ratchet.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then resolve by regenerating with `bun run lint:ratchet:update`; never hand-merge this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.",
    ]);
  });

  it("rejects structurally-invalid test entries even when the outer shape is fine", () => {
    const bad = parseLintRatchetBaselineStructure(
      '{"version":1,"tests":{"ratchet/local-type-assertion-boundary":{"ruleId":"local/type-assertion-boundary","mode":"no-new","target":0,"metric":"line-count","files":["packages/**/*.ts"],"ignores":[],"ruleOptions":[],"configHash":"sha256:x","items":{}}}}\n',
      fixtureWorkflowVocabulary,
    );
    expect(bad.failures).toContain("ratchet/local-type-assertion-boundary: metric is unknown");
  });

  it("accumulates every structural defect across tests, fields, and items in one pass", () => {
    const text = `${JSON.stringify(
      {
        version: 1,
        tests: {
          "ratchet/fixture-one": {
            ruleId: "Not A Rule",
            mode: "no-new",
            metric: "message-count",
            files: ["packages/**/*.ts"],
            ignores: [],
            ruleOptions: [],
            configHash: "sha256:x",
            items: {},
          },
          "ratchet/fixture-two": {
            ruleId: "local/example-rule",
            mode: "no-new",
            metric: "message-count",
            files: ["packages/**/*.ts"],
            ignores: [],
            ruleOptions: [],
            configHash: `sha256:${"a".repeat(64)}`,
            ruleSourceHash: `sha256:${"b".repeat(64)}`,
            items: { "packages/server/src/a.ts": { count: "two" } },
          },
          "ratchet/fixture-three": {
            ruleId: "local/example-rule",
            mode: "no-new",
            metric: "message-count",
            files: ["packages/**/*.ts"],
            ignores: [],
            ruleOptions: [],
            configHash: "sha256:y",
            items: "not an items object",
          },
        },
      },
      null,
      2,
    )}\n`;

    const parsed = parseLintRatchetBaselineStructure(text, fixtureWorkflowVocabulary);

    expect(parsed.baseline).toBeUndefined();
    expect(parsed.failures).toEqual([
      "ratchet/fixture-one: ruleId must be a bare or namespaced ESLint rule id",
      "ratchet/fixture-one: configHash must be a sha256 hash",
      "ratchet/fixture-two.items.packages/server/src/a.ts: count must be a non-negative integer",
      "ratchet/fixture-three: baseline group must contain an items object",
      "ratchet/fixture-three: configHash must be a sha256 hash",
    ]);
  });
});

describe("lint ratchet update mode with stale committed baseline", () => {
  it("refuses a committed baseline with an unknown registry id unless --allow-worse --reason is supplied", () => {
    // A committed baseline whose id is no longer in the registry
    // looks identical at the comparator layer to a rename and a true removal.
    // Renames bypass count protection silently (the new id has no committed
    // floor); update must require the operator to acknowledge that risk.
    const committedStale = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const stale = formatLintRatchetBaseline(committedStale, fixtureWorkflowVocabulary).replace(
      baseRatchet.id,
      "ratchet/old-removed-rule",
    );
    const structural = parseLintRatchetBaselineStructure(stale, fixtureWorkflowVocabulary);
    expect(structural.baseline).toBeDefined();

    const generated = oneTestBaseline([["packages/server/src/a.ts", 2]]);
    const refused = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: false,
      },
    );
    expect(refused.allowed).toBe(false);
    expect(refused.failures.some((f) => f.includes("ratchet/old-removed-rule"))).toBe(true);
    expect(refused.failures.some((f) => f.includes("rename or removal"))).toBe(true);

    const accepted = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: true,
        reason: "renamed ratchet/local-foo to ratchet/local-bar",
      },
    );
    expect(accepted.allowed).toBe(true);
  });

  it("records structured orphan removals on the decision regardless of --allow-worse", () => {
    // The debt log needs the dropped baseline evidence, not just the id, so the
    // removal snapshot is always computed; --allow-worse only flips the gate.
    const committedStale = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const stale = formatLintRatchetBaseline(committedStale, fixtureWorkflowVocabulary).replace(
      baseRatchet.id,
      "ratchet/old-removed-rule",
    );
    const structural = parseLintRatchetBaselineStructure(stale, fixtureWorkflowVocabulary);
    expect(structural.baseline).toBeDefined();
    const generated = oneTestBaseline([["packages/server/src/a.ts", 1]]);

    const expectedRemovals = [
      {
        testId: "ratchet/old-removed-rule",
        ruleId: "local/type-assertion-boundary",
        metric: "message-count",
        baselineItems: [{ path: "packages/server/src/a.ts", count: 1 }],
      },
    ];

    const refused = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: false,
      },
    );
    expect(refused.allowed).toBe(false);
    expect(refused.orphanRemovals).toEqual(expectedRemovals);

    const accepted = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: true,
        reason: "removed ratchet/old-removed-rule after deleting the rule",
      },
    );
    expect(accepted.allowed).toBe(true);
    expect(accepted.orphanRemovals).toEqual(expectedRemovals);
  });

  it("writes the orphan baselineItems snapshot in codepoint order, not localeCompare", () => {
    // The snapshot is serialized into the debt-log orphan record and matched
    // back by baseline-debt-accounting-lifecycle, which canonicalizes to
    // codepoint order (compareByCodepoint). A localeCompare snapshot orders
    // uppercase after lowercase, disagreeing with that canonical order and
    // defeating the exact-byte crash-retry dedup on a differently-collating
    // machine. `Zeta.ts` (U+005A) sorts before `alpha.ts` (U+0061) by codepoint
    // but after it under localeCompare, so the two orderings diverge here.
    const committedStale = oneTestBaseline([
      ["packages/server/src/alpha.ts", 1],
      ["packages/server/src/Zeta.ts", 1],
    ]);
    const stale = formatLintRatchetBaseline(committedStale, fixtureWorkflowVocabulary).replace(
      baseRatchet.id,
      "ratchet/old-removed-rule",
    );
    const structural = parseLintRatchetBaselineStructure(stale, fixtureWorkflowVocabulary);
    expect(structural.baseline).toBeDefined();
    const generated = oneTestBaseline([["packages/server/src/alpha.ts", 1]]);

    const decision = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: true,
        reason: "removed ratchet/old-removed-rule after deleting the rule",
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.orphanRemovals[0]?.baselineItems.map((item) => item.path)).toEqual([
      "packages/server/src/Zeta.ts",
      "packages/server/src/alpha.ts",
    ]);
  });

  it("lists multiple orphan ids alphabetically in a single failure", () => {
    // Two orphans at once still produce one failure entry; sort order is
    // deterministic so smoke tests and operator output stay stable.
    const committed = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const stale = formatLintRatchetBaseline(committed, fixtureWorkflowVocabulary).replace(
      `"${baseRatchet.id}": {`,
      `"ratchet/old-zeta": ${JSON.stringify(committed.tests[baseRatchet.id])},\n  "ratchet/old-alpha": {`,
    );
    const structural = parseLintRatchetBaselineStructure(stale, fixtureWorkflowVocabulary);
    expect(structural.baseline).toBeDefined();

    const generated = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const refused = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: false,
      },
    );
    expect(refused.allowed).toBe(false);
    const orphanFailure = refused.failures.find((f) => f.includes("rename or removal"));
    expect(orphanFailure).toBeDefined();
    // Alphabetical: ratchet/old-alpha then ratchet/old-zeta.
    expect(orphanFailure).toContain("ratchet/old-alpha, ratchet/old-zeta");
    expect(orphanFailure).toContain(`--reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}"`);
  });

  it("still rejects worse counts via structural parse when both ids match", () => {
    const committed = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(committed, fixtureWorkflowVocabulary).replace(
      committed.tests[baseRatchet.id]?.configHash ?? "",
      `sha256:${"e".repeat(64)}`,
    );
    const structural = parseLintRatchetBaselineStructure(rendered, fixtureWorkflowVocabulary);
    expect(structural.baseline).toBeDefined();

    const generated = oneTestBaseline([["packages/server/src/a.ts", 2]]);
    const decision = decideLintRatchetUpdate(
      structural.baseline ?? generated,
      generated,
      [baseRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: false,
      },
    );

    expect(decision.allowed).toBe(false);
    expect(decision.failures[0]).toContain("generated baseline is worse");
  });

  it("allows complexity-severity structural count-only migration while still rejecting worse counts", () => {
    const path = "packages/server/src/branchy.ts";
    const committed = complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 12)]);
    const countOnly = formatLintRatchetBaseline(committed, fixtureWorkflowVocabulary).replace(
      /,\n\s+"maxComplexity": 12,\n\s+"perFunction": \[(?:[^\n]*\n)*?[ \t]+\]/u,
      "",
    );
    const structural = parseLintRatchetBaselineStructure(countOnly, fixtureWorkflowVocabulary);
    expect(structural.failures).toEqual([]);
    expect(structural.baseline?.tests[complexityRatchet.id]?.items[path]).toEqual({ count: 1 });

    const sameCount = decideLintRatchetUpdate(
      structural.baseline ?? committed,
      complexityBaseline(path, [complexityFunction(12, "Function 'choose'", 50)]),
      [complexityRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: false,
      },
    );
    expect(sameCount.allowed).toBe(true);

    const worseCount = decideLintRatchetUpdate(
      structural.baseline ?? committed,
      complexityBaseline(path, [
        complexityFunction(12, "Function 'choose'", 50),
        complexityFunction(32, "Function 'other'", 11),
      ]),
      [complexityRatchet],
      {
        workflowVocabulary: fixtureWorkflowVocabulary,
        allowWorse: false,
      },
    );
    expect(worseCount.allowed).toBe(false);
    expect(worseCount.regressions[0]?.reason).toBe("increased-count");
  });
});

describe("lint ratchet retire-ratchet path", () => {
  // A retired ratchet is an orphan whose committed floor is at zero: the rule
  // was promoted into normal lint and the floor is being dropped. Retiring it
  // is a strict improvement, not accepted debt, so it must not be forced through
  // --allow-worse + the debt log — but only once promotion is machine-proven.
  function zeroOrphanBaseline(): LintRatchetBaseline {
    const stale = formatLintRatchetBaseline(oneTestBaseline([]), fixtureWorkflowVocabulary).replace(
      baseRatchet.id,
      "ratchet/old-promoted-rule",
    );
    const structural = parseLintRatchetBaselineStructure(stale, fixtureWorkflowVocabulary);
    expect(structural.baseline).toBeDefined();
    return structural.baseline ?? oneTestBaseline([]);
  }

  it("retires a zero-finding orphan without --allow-worse when promotion is proven", () => {
    const committed = zeroOrphanBaseline();
    const generated = oneTestBaseline([]);

    const decision = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
      retire: { id: "ratchet/old-promoted-rule", normalErrorProven: true },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.retiredRatchetId).toBe("ratchet/old-promoted-rule");
    // The proven retirement is not accounted as dropped debt.
    expect(decision.orphanRemovals).toEqual([]);
    expect(decision.failures).toEqual([]);
  });

  it("refuses to retire when normal lint does not error on the orphan scope", () => {
    const committed = zeroOrphanBaseline();
    const generated = oneTestBaseline([]);

    const decision = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
      retire: { id: "ratchet/old-promoted-rule", normalErrorProven: false },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.retiredRatchetId).toBeUndefined();
    const failure = decision.failures.find((f) => f.includes("ratchet/old-promoted-rule"));
    expect(failure).toBeDefined();
    expect(failure).toContain("normal lint");
    expect(failure).toContain("--allow-worse");
    // The unproven orphan is still tracked as a removal so --allow-worse can log it.
    expect(decision.orphanRemovals).toHaveLength(1);
  });

  it("refuses to retire a nonzero-finding orphan even with proof", () => {
    const stale = formatLintRatchetBaseline(
      oneTestBaseline([["packages/server/src/a.ts", 1]]),
      fixtureWorkflowVocabulary,
    ).replace(baseRatchet.id, "ratchet/old-promoted-rule");
    const structural = parseLintRatchetBaselineStructure(stale, fixtureWorkflowVocabulary);
    expect(structural.baseline).toBeDefined();
    const committed = structural.baseline ?? oneTestBaseline([]);
    const generated = oneTestBaseline([]);

    const decision = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
      retire: { id: "ratchet/old-promoted-rule", normalErrorProven: true },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.retiredRatchetId).toBeUndefined();
    const failure = decision.failures.find((f) => f.includes("ratchet/old-promoted-rule"));
    expect(failure).toBeDefined();
    expect(failure).toContain("finding");
  });

  it("refuses to retire an id that is not an orphan baseline entry", () => {
    const committed = oneTestBaseline([]);
    const generated = oneTestBaseline([]);

    const decision = decideLintRatchetUpdate(committed, generated, [baseRatchet], {
      workflowVocabulary: fixtureWorkflowVocabulary,
      allowWorse: false,
      retire: { id: "ratchet/not-in-baseline", normalErrorProven: true },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.retiredRatchetId).toBeUndefined();
    expect(decision.failures.some((f) => f.includes("ratchet/not-in-baseline"))).toBe(true);
  });
});

describe("lint ratchet rule source hash binding", () => {
  it("rejects a baseline whose ruleSourceHash does not match the current rule source", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary);
    const driftedHashes: LintRatchetRuleSourceHashesById = new Map([
      [baseRatchet.id, `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"b".repeat(64)}`],
    ]);
    const parsed = parseLintRatchetBaseline(rendered, [baseRatchet], driftedHashes, {
      workflowVocabulary: fixtureWorkflowVocabulary,
    });
    expect(parsed.baseline).toBeUndefined();
    expect(parsed.failures).toContain(
      'ratchet/local-type-assertion-boundary.ruleSourceHash is stale (run "bun run lint:ratchet:update" to regenerate)',
    );
    expect(parsed.validationFailures).toContainEqual({
      code: "rule-source-drift",
      message:
        'ratchet/local-type-assertion-boundary.ruleSourceHash is stale (run "bun run lint:ratchet:update" to regenerate)',
    });
  });

  it("requires ruleSourceHash to be present in the committed baseline", () => {
    const baseline = oneTestBaseline([]);
    const renderedWithoutRuleSourceHash = formatLintRatchetBaseline(
      baseline,
      fixtureWorkflowVocabulary,
    ).replace(/^\s*"ruleSourceHash": "[^"]+",\n/mu, "");
    const parsed = parseLintRatchetBaseline(
      renderedWithoutRuleSourceHash,
      [baseRatchet],
      fixtureRuleSourceHashes,
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );
    expect(parsed.baseline).toBeUndefined();
    expect(parsed.failures).toContain(
      "ratchet/local-type-assertion-boundary.ruleSourceHash is required",
    );
    expect(parsed.validationFailures).toContainEqual({
      code: "rule-source-hash-required",
      message: "ratchet/local-type-assertion-boundary.ruleSourceHash is required",
    });
  });

  it("emits one structured validation code for every strict validation failure", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", -1]]);
    const baselineTest = baseline.tests[baseRatchet.id];
    if (baselineTest === undefined) throw new Error("missing base ratchet fixture");
    const rendered = formatLintRatchetBaseline(
      {
        ...baseline,
        tests: {
          [baseRatchet.id]: {
            ...baselineTest,
            configHash: `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"c".repeat(64)}`,
            ruleSourceHash: `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"d".repeat(64)}`,
          },
          "ratchet/orphan": {
            ...baselineTest,
            ruleId: "local/orphan",
          },
        },
      },
      fixtureWorkflowVocabulary,
    );
    const parsed = parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes, {
      workflowVocabulary: fixtureWorkflowVocabulary,
    });

    expect(parsed.baseline).toBeUndefined();
    expect(parsed.validationFailures.map((failure) => failure.message)).toEqual(parsed.failures);
    expect(parsed.validationFailures.every((failure) => failure.code.length > 0)).toBe(true);
  });

  it("emits ruleSourceHash deterministically and round-trips it", () => {
    const baseline = oneTestBaseline([["packages/shared/src/x.ts", 2]]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary);
    expect(rendered).toContain(`"ruleSourceHash": "${FIXTURE_RULE_SOURCE_HASH}"`);
    const parsed = parseLintRatchetBaseline(rendered, [baseRatchet], fixtureRuleSourceHashes, {
      workflowVocabulary: fixtureWorkflowVocabulary,
    });
    expect(parsed.failures).toEqual([]);
    expect(parsed.baseline?.tests[baseRatchet.id]?.ruleSourceHash).toBe(FIXTURE_RULE_SOURCE_HASH);
  });

  it("structural parse accepts a baseline missing ruleSourceHash so update can fill it in", () => {
    const baseline = oneTestBaseline([["packages/server/src/a.ts", 1]]);
    const rendered = formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary).replace(
      /^\s*"ruleSourceHash": "[^"]+",\n/mu,
      "",
    );
    const structural = parseLintRatchetBaselineStructure(rendered, fixtureWorkflowVocabulary);
    expect(structural.failures).toEqual([]);
    expect(structural.baseline?.tests[baseRatchet.id]?.ruleSourceHash).toBe("");
  });

  it("buildLintRatchetBaseline throws when a ratchet has no rule source hash", () => {
    expect(() =>
      buildLintRatchetBaseline([baseRatchet], current([[baseRatchet.id, []]]), new Map(), {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }),
    ).toThrow(/missing rule source hash/u);
  });
});

describe("lint ratchet registry validation", () => {
  it("accepts the valid fixture registry and hashes normalized config deterministically", () => {
    expect(
      validateLintRatchetRegistry([baseRatchet], {
        localRuleIds: new Set(["local/type-assertion-boundary"]),
      }),
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
    expect(
      computeLintRatchetConfigHash({
        ...baseRatchet,
        source: { kind: "local" },
        parserProfile: "minimal-ts",
      }),
    ).toBe(computeLintRatchetConfigHash(baseRatchet));
  });

  it("rejects a registry entry whose dedicated principle is empty", () => {
    const blankPrincipleRatchet: LintRatchetConfig = { ...baseRatchet, principle: "   " };
    expect(
      validateLintRatchetRegistry([blankPrincipleRatchet], {
        localRuleIds: new Set(["local/type-assertion-boundary"]),
      }).join("\n"),
    ).toContain(`${baseRatchet.id}: principle must be a non-empty string`);
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

    const ruleSourceHash = computeCoreLintRatchetRuleSourceHash(coreRatchet, "9.0.0", "8.59.4");
    const baseline = buildLintRatchetBaseline(
      [coreRatchet],
      current([[coreRatchet.id, [["packages/shared/src/core.ts", 1]]]]),
      new Map([[coreRatchet.id, ruleSourceHash]]),
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );
    const parsed = parseLintRatchetBaseline(
      formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary),
      [coreRatchet],
      new Map([[coreRatchet.id, ruleSourceHash]]),
      { workflowVocabulary: fixtureWorkflowVocabulary },
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

  it("hashes core rule sources with rule options and parser toolchain versions", () => {
    const eslintVersion = "9.0.0";
    const typescriptEslintVersion = "8.59.4";
    const expectedHash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "core",
          ruleId: "complexity",
          ruleOptions: [{ max: 10 }],
          eslintVersion,
          typescriptEslintVersion,
        }),
      )
      .digest("hex");

    expect(
      computeCoreLintRatchetRuleSourceHash(coreRatchet, eslintVersion, typescriptEslintVersion),
    ).toBe(`${LINT_RATCHET_CONFIG_HASH_PREFIX}${expectedHash}`);
    expect(
      computeCoreLintRatchetRuleSourceHash(coreRatchet, "9.0.1", typescriptEslintVersion),
    ).not.toBe(
      computeCoreLintRatchetRuleSourceHash(coreRatchet, eslintVersion, typescriptEslintVersion),
    );
    expect(computeCoreLintRatchetRuleSourceHash(coreRatchet, eslintVersion, "8.60.0")).not.toBe(
      computeCoreLintRatchetRuleSourceHash(coreRatchet, eslintVersion, typescriptEslintVersion),
    );
  });

  it("orders configHash string inputs by codepoint, not locale collation", () => {
    // localeCompare would interleave case and de-prioritize punctuation
    // (e.g. `_x`/`a` before `B`/`Z`); codepoint order — the only cross-machine
    // stable choice for a committed hash — sorts uppercase and `_` ahead of
    // lowercase. Locking the exact order guards the committed configHash.
    expect(normalizeStringList(["Z", "a", "_x", "b-c", "B", "a.b", "a-b"])).toEqual([
      "B",
      "Z",
      "_x",
      "a",
      "a-b",
      "a.b",
      "b-c",
    ]);
  });

  it("rejects duplicate ids, unknown local rules, unsorted lists, duplicate scopes, and unsupported metrics", () => {
    const failures = validateLintRatchetRegistry(
      [
        {
          ...baseRatchet,
          id: "ratchet/z",
          ruleId: "local/unknown",
          files: ["z.ts", "a.ts"],
        },
        { ...baseRatchet, id: "ratchet/b" },
        { ...baseRatchet, id: "ratchet/a" },
        {
          ...baseRatchet,
          id: "ratchet/other",
          metric: "line-count",
        } as unknown as LintRatchetConfig,
      ],
      { localRuleIds: new Set(["local/type-assertion-boundary"]) },
    );

    expect(failures).toContain("ratchet ids must be sorted (by codepoint) and unique");
    expect(failures).toContain("ratchet/z: ruleId local/unknown is not registered");
    expect(failures).toContain("ratchet/z: files must be sorted (by codepoint) and duplicate-free");
    expect(failures).toContain("ratchet/a: duplicates ratchet scope already used by ratchet/b");
    expect(failures).toContain("ratchet/other: metric line-count is not implemented");
  });

  it("rejects negated file and ignore globs before minimatch evaluation", () => {
    const failures = validateLintRatchetRegistry([
      {
        ...baseRatchet,
        files: ["!packages/generated/**", "packages/**/*.ts"],
        ignores: ["!packages/server/src/keep.ts"],
      },
    ]);

    expect(failures).toContain(
      "ratchet/local-type-assertion-boundary: file glob must not use ! negation: !packages/generated/**",
    );
    expect(failures).toContain(
      "ratchet/local-type-assertion-boundary: ignore glob must not use ! negation: !packages/server/src/keep.ts",
    );
  });
});
