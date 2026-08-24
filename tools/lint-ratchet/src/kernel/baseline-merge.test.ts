import { describe, expect, it } from "vitest";

import { fixtureWorkflowVocabulary } from "../../test/fixture-workflow-vocabulary.js";
import {
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetBaselineTest,
} from "./baseline.js";
import {
  createLintRatchetBaselineVersionPolicy,
  LINT_RATCHET_BASELINE_WRITE_VERSION,
  lintRatchetBaselineRegenerateForVersion,
  type LintRatchetBaselineVersion,
} from "./baseline-constants.js";
import { mergeLintRatchetBaselines } from "./baseline-merge.js";
import type { LintRatchetComplexityFunction, LintRatchetMetricItem } from "./metrics-types.js";

const CONFIG_HASH = `sha256:${"a".repeat(64)}`;
const RULE_SOURCE_HASH = `sha256:${"b".repeat(64)}`;
const MESSAGE_FINGERPRINT_A = `sha256:${"c".repeat(64)}`;
const MESSAGE_FINGERPRINT_B = `sha256:${"d".repeat(64)}`;
const LINT_RATCHET_BASELINE_REGENERATE = fixtureWorkflowVocabulary.updateCommand;
const WRITE_REGENERATE = lintRatchetBaselineRegenerateForVersion(
  LINT_RATCHET_BASELINE_WRITE_VERSION,
  fixtureWorkflowVocabulary.updateCommand,
);

type MessageItemFixture = number | LintRatchetMetricItem;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageBaseline(
  tests: Readonly<Record<string, Readonly<Record<string, MessageItemFixture>>>>,
): LintRatchetBaseline {
  const baselineTests: Record<string, LintRatchetBaselineTest> = {};
  for (const [testId, items] of Object.entries(tests)) {
    const baselineItems: Record<string, LintRatchetMetricItem> = {};
    for (const [path, item] of Object.entries(items)) {
      baselineItems[path] = typeof item === "number" ? { count: item } : item;
    }
    baselineTests[testId] = {
      ruleId: "local/example-rule",
      mode: "no-new",
      metric: "message-count",
      files: ["packages/**/*.ts"],
      ignores: [],
      ruleOptions: [],
      configHash: CONFIG_HASH,
      ruleSourceHash: RULE_SOURCE_HASH,
      items: baselineItems,
    };
  }
  return {
    version: LINT_RATCHET_BASELINE_WRITE_VERSION,
    ...(WRITE_REGENERATE === undefined ? {} : { regenerate: WRITE_REGENERATE }),
    tests: baselineTests,
  };
}

function baselineAtVersion(
  baseline: LintRatchetBaseline,
  version: LintRatchetBaselineVersion,
): LintRatchetBaseline {
  return {
    version,
    ...(version === 2 ? { regenerate: LINT_RATCHET_BASELINE_REGENERATE } : {}),
    tests: baseline.tests,
  };
}

function requireBaselineTest(
  baseline: LintRatchetBaseline,
  testId: string,
): LintRatchetBaselineTest {
  const test = baseline.tests[testId];
  if (test === undefined) throw new Error(`missing test fixture: ${testId}`);
  return test;
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
  return {
    version: LINT_RATCHET_BASELINE_WRITE_VERSION,
    ...(WRITE_REGENERATE === undefined ? {} : { regenerate: WRITE_REGENERATE }),
    tests: {
      "ratchet/fixture-complexity": {
        ruleId: "complexity",
        mode: "no-new",
        metric: "complexity-severity",
        files: ["packages/**/*.ts"],
        ignores: [],
        ruleOptions: [{ max: 10 }],
        configHash: CONFIG_HASH,
        ruleSourceHash: RULE_SOURCE_HASH,
        items: {
          [path]: {
            count: perFunction.length,
            maxComplexity: Math.max(...perFunction.map((entry) => entry.complexity)),
            perFunction,
          },
        },
      },
    },
  };
}

function maxLinesBaseline(path: string, lines: number, count = 1): LintRatchetBaseline {
  return {
    version: LINT_RATCHET_BASELINE_WRITE_VERSION,
    ...(WRITE_REGENERATE === undefined ? {} : { regenerate: WRITE_REGENERATE }),
    tests: {
      "ratchet/local-max-lines-fixture": {
        ruleId: "local/max-lines",
        mode: "no-new",
        metric: "effective-line-count",
        files: ["packages/**/*.ts"],
        ignores: [],
        ruleOptions: [],
        configHash: CONFIG_HASH,
        ruleSourceHash: RULE_SOURCE_HASH,
        items: { [path]: { count, lines } },
      },
    },
  };
}

function mergeResult(
  base: LintRatchetBaseline,
  current: LintRatchetBaseline,
  other: LintRatchetBaseline,
): ReturnType<typeof mergeLintRatchetBaselines> {
  return mergeLintRatchetBaselines({
    workflowVocabulary: fixtureWorkflowVocabulary,
    baseText: formatLintRatchetBaseline(base, fixtureWorkflowVocabulary),
    currentText: formatLintRatchetBaseline(current, fixtureWorkflowVocabulary),
    otherText: formatLintRatchetBaseline(other, fixtureWorkflowVocabulary),
  });
}

function baselineTextWithoutRuleSourceHash(
  baseline: LintRatchetBaseline,
  testId = "ratchet/fixture-one",
): string {
  const parsed: unknown = JSON.parse(
    formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary),
  );
  if (!isRecord(parsed) || !isRecord(parsed.tests)) {
    throw new Error("expected baseline object fixture");
  }
  const test = parsed.tests[testId];
  if (!isRecord(test)) throw new Error("expected baseline test fixture");
  delete test.ruleSourceHash;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

const MERGE_CHARACTERIZATION_CASES = [
  {
    name: "retains an empty group as lifecycle state",
    base: messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/drained.ts": 2 },
    }),
    current: messageBaseline({ "ratchet/fixture-one": {} }),
    other: messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/drained.ts": 2 },
    }),
    expected: messageBaseline({ "ratchet/fixture-one": {} }),
    failures: [],
  },
  {
    name: "keeps a one-sided orphan group added without a base",
    base: messageBaseline({}),
    current: messageBaseline({}),
    other: messageBaseline({
      "ratchet/fixture-orphan": { "packages/server/src/orphan.ts": 3 },
    }),
    expected: messageBaseline({
      "ratchet/fixture-orphan": { "packages/server/src/orphan.ts": 3 },
    }),
    failures: [],
  },
  {
    name: "rejects a metadata conflict",
    base: messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    }),
    current: messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
    }),
    other: {
      ...messageBaseline({
        "ratchet/fixture-one": { "packages/server/src/shared.ts": 2 },
      }),
      tests: {
        "ratchet/fixture-one": {
          ...requireBaselineTest(
            messageBaseline({
              "ratchet/fixture-one": { "packages/server/src/shared.ts": 2 },
            }),
            "ratchet/fixture-one",
          ),
          configHash: `sha256:${"c".repeat(64)}`,
        },
      },
    },
    expected: undefined,
    failures: [
      "ratchet/fixture-one: ratchet metadata differs between sides; regenerate the baseline after resolving other conflicts",
    ],
  },
] as const;

function sensitivityMetaVariant(overrides: Partial<LintRatchetBaselineTest>): LintRatchetBaseline {
  const baseline = messageBaseline({
    "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
  });
  return {
    ...baseline,
    tests: {
      "ratchet/fixture-one": {
        ...requireBaselineTest(baseline, "ratchet/fixture-one"),
        ...overrides,
      },
    },
  };
}

// One case per semantic group field. `mode` is absent because it is
// single-valued (`no-new`) and the metadata codec rejects any other value
// before the merge decision can see it.
const MERGE_FIELD_SENSITIVITY_CASES = [
  {
    field: "ruleId",
    groupId: "ratchet/fixture-one",
    base: sensitivityMetaVariant({}),
    current: sensitivityMetaVariant({ ruleId: "local/other-rule" }),
  },
  {
    field: "metric",
    groupId: "ratchet/fixture-one",
    base: sensitivityMetaVariant({}),
    current: sensitivityMetaVariant({ metric: "effective-line-count" }),
  },
  {
    field: "files",
    groupId: "ratchet/fixture-one",
    base: sensitivityMetaVariant({}),
    current: sensitivityMetaVariant({ files: ["packages/**/*.ts", "scripts/**/*.ts"] }),
  },
  {
    field: "ignores",
    groupId: "ratchet/fixture-one",
    base: sensitivityMetaVariant({}),
    current: sensitivityMetaVariant({ ignores: ["packages/**/*.test.ts"] }),
  },
  {
    field: "ruleOptions",
    groupId: "ratchet/fixture-one",
    base: sensitivityMetaVariant({}),
    current: sensitivityMetaVariant({ ruleOptions: [{ max: 5 }] }),
  },
  {
    field: "configHash",
    groupId: "ratchet/fixture-one",
    base: sensitivityMetaVariant({}),
    current: sensitivityMetaVariant({ configHash: `sha256:${"e".repeat(64)}` }),
  },
  {
    field: "ruleSourceHash",
    groupId: "ratchet/fixture-one",
    base: sensitivityMetaVariant({}),
    current: sensitivityMetaVariant({ ruleSourceHash: `sha256:${"f".repeat(64)}` }),
  },
  {
    field: "item count",
    groupId: "ratchet/fixture-one",
    base: messageBaseline({ "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 } }),
    current: messageBaseline({ "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 } }),
  },
  {
    field: "item path",
    groupId: "ratchet/fixture-one",
    base: messageBaseline({ "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 } }),
    current: messageBaseline({ "ratchet/fixture-one": { "packages/server/src/renamed.ts": 4 } }),
  },
  {
    field: "item set (entry added)",
    groupId: "ratchet/fixture-one",
    base: messageBaseline({ "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 } }),
    current: messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/extra.ts": 1,
        "packages/server/src/shared.ts": 4,
      },
    }),
  },
  {
    field: "item set (entry removed)",
    groupId: "ratchet/fixture-one",
    base: messageBaseline({ "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 } }),
    current: messageBaseline({ "ratchet/fixture-one": {} }),
  },
  {
    field: "messagesFingerprint payload",
    groupId: "ratchet/fixture-one",
    base: messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 4, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    }),
    current: messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 4, messagesFingerprint: MESSAGE_FINGERPRINT_B },
      },
    }),
  },
  {
    field: "lines payload",
    groupId: "ratchet/local-max-lines-fixture",
    base: maxLinesBaseline("packages/server/src/long.ts", 120),
    current: maxLinesBaseline("packages/server/src/long.ts", 130),
  },
  {
    field: "perFunction payload",
    groupId: "ratchet/fixture-complexity",
    base: complexityBaseline("packages/server/src/complex.ts", [
      complexityFunction(3, "alpha", 12),
    ]),
    current: complexityBaseline("packages/server/src/complex.ts", [
      complexityFunction(3, "beta", 12),
    ]),
  },
] as const;

describe("lint ratchet baseline semantic merge", () => {
  it.each([
    [1, 1, 1],
    [1, 1, 2],
    [1, 2, 1],
    [1, 2, 2],
    [2, 1, 1],
    [2, 1, 2],
    [2, 2, 1],
    [2, 2, 2],
  ] as const)(
    "merges base/current/other versions %i/%i/%i to each engine write version",
    (baseVersion, currentVersion, otherVersion) => {
      const base = messageBaseline({
        "ratchet/fixture-one": { "packages/server/src/shared.ts": 5 },
      });
      const current = messageBaseline({
        "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
      });
      const other = messageBaseline({
        "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
      });

      for (const engineWriteVersion of [1, 2] as const) {
        const result = mergeLintRatchetBaselines({
          workflowVocabulary: fixtureWorkflowVocabulary,
          baseText: formatLintRatchetBaseline(
            baselineAtVersion(base, baseVersion),
            fixtureWorkflowVocabulary,
          ),
          currentText: formatLintRatchetBaseline(
            baselineAtVersion(current, currentVersion),
            fixtureWorkflowVocabulary,
          ),
          otherText: formatLintRatchetBaseline(
            baselineAtVersion(other, otherVersion),
            fixtureWorkflowVocabulary,
          ),
          versionPolicy: createLintRatchetBaselineVersionPolicy(engineWriteVersion),
        });

        expect(result.failures).toEqual([]);
        expect(result.postMergeTruthUpRequired).toBe(true);
        expect(result.mergedText).toBe(
          formatLintRatchetBaseline(
            baselineAtVersion(other, engineWriteVersion),
            fixtureWorkflowVocabulary,
          ),
        );
      }
    },
  );

  it("merges a v1 base and lower v1 side through a v2 current document", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 5 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
    });

    const result = mergeLintRatchetBaselines({
      workflowVocabulary: fixtureWorkflowVocabulary,
      baseText: formatLintRatchetBaseline(baselineAtVersion(base, 1), fixtureWorkflowVocabulary),
      currentText: formatLintRatchetBaseline(
        baselineAtVersion(current, 2),
        fixtureWorkflowVocabulary,
      ),
      otherText: formatLintRatchetBaseline(baselineAtVersion(other, 1), fixtureWorkflowVocabulary),
    });

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(baselineAtVersion(other, 2), fixtureWorkflowVocabulary),
    );
    expect(result.mergedText).toContain(`"regenerate": "${LINT_RATCHET_BASELINE_REGENERATE}"`);
  });

  it.each(MERGE_CHARACTERIZATION_CASES)(
    "characterizes $name for the kernel migration oracle",
    ({ base, current, other, expected, failures }) => {
      const result = mergeResult(base, current, other);

      expect(result.failures).toEqual(failures);
      expect(result.mergedText).toBe(
        expected === undefined
          ? undefined
          : formatLintRatchetBaseline(expected, fixtureWorkflowVocabulary),
      );
    },
  );

  it("keeps independent one-sided ratchet entry changes from both sides", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 4 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 6 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 6 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 4 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
          "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
        }),
        fixtureWorkflowVocabulary,
      ),
    );
  });

  it("merges same-ratchet item conflicts by taking minimum floors and treating missing as drained", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained-by-current.ts": 5,
        "packages/server/src/drained-by-other.ts": 7,
        "packages/server/src/shared.ts": 8,
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained-by-other.ts": 7,
        "packages/server/src/shared.ts": 4,
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained-by-current.ts": 5,
        "packages/server/src/shared.ts": 6,
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
        }),
        fixtureWorkflowVocabulary,
      ),
    );
  });

  it("keeps an item added on one side without requesting truth-up", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 5 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added.ts": 2,
        "packages/server/src/shared.ts": 4,
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(false);
    expect(result.mergedText).toBe(formatLintRatchetBaseline(current, fixtureWorkflowVocabulary));
  });

  it("drops an item drained on one side and requests truth-up", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained.ts": 2,
        "packages/server/src/shared.ts": 5,
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained.ts": 2,
        "packages/server/src/shared.ts": 4,
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(formatLintRatchetBaseline(current, fixtureWorkflowVocabulary));
  });

  it("takes the minimum when both sides add the same item", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 5 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added.ts": 3,
        "packages/server/src/shared.ts": 4,
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added.ts": 2,
        "packages/server/src/shared.ts": 4,
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(formatLintRatchetBaseline(other, fixtureWorkflowVocabulary));
  });

  it("uses item-level base semantics for a mixed both-sides-changed test", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/drained.ts": 4,
        "packages/server/src/shared.ts": 8,
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added-current.ts": 2,
        "packages/server/src/added-shared.ts": 5,
        "packages/server/src/drained.ts": 4,
        "packages/server/src/shared.ts": 6,
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/added-other.ts": 3,
        "packages/server/src/added-shared.ts": 4,
        "packages/server/src/shared.ts": 7,
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/added-current.ts": 2,
            "packages/server/src/added-other.ts": 3,
            "packages/server/src/added-shared.ts": 4,
            "packages/server/src/shared.ts": 6,
          },
        }),
        fixtureWorkflowVocabulary,
      ),
    );
  });

  it("treats a missing base test as empty item-level base", () => {
    const base = messageBaseline({});
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/current.ts": 2 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/other.ts": 3 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(false);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/current.ts": 2,
            "packages/server/src/other.ts": 3,
          },
        }),
        fixtureWorkflowVocabulary,
      ),
    );
  });

  it("does not request post-merge truth-up for independent one-sided ratchet changes", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 4 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 6 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 6 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 4 },
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(false);
  });

  it("preserves equal-count message fingerprints when both sides agree", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/lower.ts": 5,
        "packages/server/src/shared.ts": { count: 3, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/lower.ts": 2,
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_B },
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/lower.ts": 3,
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_B },
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/lower.ts": 2,
            "packages/server/src/shared.ts": {
              count: 2,
              messagesFingerprint: MESSAGE_FINGERPRINT_B,
            },
          },
        }),
        fixtureWorkflowVocabulary,
      ),
    );
  });

  it("keeps a deterministic message fingerprint and requests truth-up when equal counts differ", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 3, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_B },
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/shared.ts": {
              count: 2,
              messagesFingerprint: MESSAGE_FINGERPRINT_A,
            },
          },
        }),
        fixtureWorkflowVocabulary,
      ),
    );
  });

  it("preserves a one-sided message fingerprint and requests truth-up", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": {
        "packages/server/src/shared.ts": { count: 2, messagesFingerprint: MESSAGE_FINGERPRINT_A },
      },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 2 },
    });

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.postMergeTruthUpRequired).toBe(true);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": {
            "packages/server/src/shared.ts": {
              count: 2,
              messagesFingerprint: MESSAGE_FINGERPRINT_A,
            },
          },
        }),
        fixtureWorkflowVocabulary,
      ),
    );
  });

  it("treats an empty base file as an empty baseline for add/add merges", () => {
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
    });
    const other = messageBaseline({
      "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
    });

    const result = mergeLintRatchetBaselines({
      workflowVocabulary: fixtureWorkflowVocabulary,
      baseText: "",
      currentText: formatLintRatchetBaseline(current, fixtureWorkflowVocabulary),
      otherText: formatLintRatchetBaseline(other, fixtureWorkflowVocabulary),
    });

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(
        messageBaseline({
          "ratchet/fixture-one": { "packages/server/src/one.ts": 2 },
          "ratchet/fixture-two": { "packages/client/src/two.tsx": 3 },
        }),
        fixtureWorkflowVocabulary,
      ),
    );
  });

  it("refuses a semantic success when the merged baseline is strict-invalid", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
    });

    const result = mergeLintRatchetBaselines({
      workflowVocabulary: fixtureWorkflowVocabulary,
      baseText: formatLintRatchetBaseline(base, fixtureWorkflowVocabulary),
      currentText: baselineTextWithoutRuleSourceHash(current),
      otherText: formatLintRatchetBaseline(base, fixtureWorkflowVocabulary),
    });

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual(["ratchet/fixture-one.ruleSourceHash is required"]);
  });

  it("takes the lower effective-line-count payload when counts tie", () => {
    const path = "packages/server/src/large.ts";
    const base = maxLinesBaseline(path, 450);
    const current = maxLinesBaseline(path, 320);
    const other = maxLinesBaseline(path, 300);

    const result = mergeResult(base, current, other);

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(maxLinesBaseline(path, 300), fixtureWorkflowVocabulary),
    );
  });

  it("refuses equal-count complexity payloads when function vectors differ", () => {
    const path = "packages/server/src/branchy.ts";
    const base = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 20),
      complexityFunction(30, "Function 'route'", 18),
    ]);
    const current = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 16),
      complexityFunction(30, "Function 'route'", 18),
    ]);
    const other = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 20),
      complexityFunction(30, "Function 'route'", 14),
    ]);

    const result = mergeResult(base, current, other);

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual([
      "ratchet/fixture-complexity.items.packages/server/src/branchy.ts: equal-count complexity-severity payloads differ",
    ]);
  });

  it("validates the surviving items of an item-conflict ratchet on the failure path", () => {
    const path = "packages/server/src/branchy.ts";
    const base = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 20),
      complexityFunction(30, "Function 'route'", 18),
    ]);
    const current = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 16),
      complexityFunction(30, "Function 'route'", 18),
    ]);
    const other = complexityBaseline(path, [
      complexityFunction(10, "Function 'choose'", 20),
      complexityFunction(30, "Function 'route'", 14),
    ]);

    const result = mergeLintRatchetBaselines({
      workflowVocabulary: fixtureWorkflowVocabulary,
      baseText: baselineTextWithoutRuleSourceHash(base, "ratchet/fixture-complexity"),
      currentText: baselineTextWithoutRuleSourceHash(current, "ratchet/fixture-complexity"),
      otherText: baselineTextWithoutRuleSourceHash(other, "ratchet/fixture-complexity"),
    });

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual([
      "ratchet/fixture-complexity.items.packages/server/src/branchy.ts: equal-count complexity-severity payloads differ",
      "ratchet/fixture-complexity.ruleSourceHash is required",
    ]);
  });

  it("refuses both-sides metadata changes instead of guessing", () => {
    const base = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });
    const current = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 3 },
    });
    const other = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 2 },
    });
    const otherWithHashDrift: LintRatchetBaseline = {
      ...other,
      tests: {
        "ratchet/fixture-one": {
          ...requireBaselineTest(other, "ratchet/fixture-one"),
          configHash: `sha256:${"c".repeat(64)}`,
        },
      },
    };

    const result = mergeResult(base, current, otherWithHashDrift);

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual([
      "ratchet/fixture-one: ratchet metadata differs between sides; regenerate the baseline after resolving other conflicts",
    ]);
  });

  it("treats a formatting-only files reorder as unchanged so the other side's removal merges", () => {
    // Pinned ruling (lint-arch-review-2026-07 leaf 11 item 3): "side unchanged
    // vs base" compares canonically formatted groups, so noncanonical
    // hand-edits that only reorder normalized lists are not changes and do not
    // raise a remove-vs-change conflict.
    const withTest = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });
    const base: LintRatchetBaseline = {
      ...withTest,
      tests: {
        "ratchet/fixture-one": {
          ...requireBaselineTest(withTest, "ratchet/fixture-one"),
          files: ["packages/client/**/*.ts", "packages/server/**/*.ts"],
        },
      },
    };
    const parsed: unknown = JSON.parse(formatLintRatchetBaseline(base, fixtureWorkflowVocabulary));
    if (!isRecord(parsed) || !isRecord(parsed.tests)) {
      throw new Error("expected baseline object fixture");
    }
    const test = parsed.tests["ratchet/fixture-one"];
    if (!isRecord(test) || !Array.isArray(test.files)) {
      throw new Error("expected baseline test fixture with files");
    }
    test.files.reverse();
    const reorderedCurrentText = `${JSON.stringify(parsed, null, 2)}\n`;

    const result = mergeLintRatchetBaselines({
      workflowVocabulary: fixtureWorkflowVocabulary,
      baseText: formatLintRatchetBaseline(base, fixtureWorkflowVocabulary),
      currentText: reorderedCurrentText,
      otherText: formatLintRatchetBaseline(messageBaseline({}), fixtureWorkflowVocabulary),
    });

    expect(result.failures).toEqual([]);
    expect(result.mergedText).toBe(
      formatLintRatchetBaseline(messageBaseline({}), fixtureWorkflowVocabulary),
    );
  });

  // Companion guard to the reorder pin above. Comparing canonically formatted
  // groups is sound only while formatting emits every semantic field; if a
  // formatter stops emitting one, a change to that field becomes invisible to
  // "side unchanged vs base" and the removal below merges silently instead of
  // conflicting — these cases are what fail first.
  it.each(MERGE_FIELD_SENSITIVITY_CASES)(
    "conflicts a $field change on one side with the other side's removal",
    ({ groupId, base, current }) => {
      const result = mergeResult(base, current, messageBaseline({}));

      expect(result.mergedText).toBeUndefined();
      expect(result.failures).toEqual([
        `${groupId}: one side removed the ratchet while the other changed it; regenerate the baseline after resolving other conflicts`,
      ]);
    },
  );

  it("reports malformed inputs so the shell driver can fall back to the manual recipe", () => {
    const baseline = messageBaseline({
      "ratchet/fixture-one": { "packages/server/src/shared.ts": 4 },
    });

    const result = mergeLintRatchetBaselines({
      workflowVocabulary: fixtureWorkflowVocabulary,
      baseText: formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary),
      currentText: "{not json",
      otherText: formatLintRatchetBaseline(baseline, fixtureWorkflowVocabulary),
    });

    expect(result.mergedText).toBeUndefined();
    expect(result.failures).toEqual([
      expect.stringContaining("current baseline is not valid JSON"),
    ]);
  });
});
