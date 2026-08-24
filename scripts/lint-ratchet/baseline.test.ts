import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { harnessDiagnosticsSchema } from "@musi/harness-diagnostics/schema.js";
import {
  buildLintRatchetBaseline,
  compareCurrentToBaseline,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetComparison,
  type LintRatchetCurrentById,
  type LintRatchetRuleSourceHashesById,
  parseLintRatchetBaselineStructure,
} from "@musi/lint-ratchet/kernel/baseline.js";
import {
  createLintRatchetBaselineVersionPolicy,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
} from "@musi/lint-ratchet/kernel/baseline-constants.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import { itemsFromResults } from "@musi/lint-ratchet/kernel/current-collector.js";
import type { LintRatchetComplexityFunction } from "@musi/lint-ratchet/kernel/metrics-types.js";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import type { RuleDocsEntry } from "../lib/lint-rule-docs.js";
import {
  assertCheckBaselineComparisonClean,
  buildEnvelope,
  buildEnvelopeFromComparison,
} from "../lint-ratchet.js";
import { musiLintRatchetWorkflowVocabulary } from "./engine-binding.js";
import { lintRatchets } from "./lint-ratchet-config.js";
import { baselinePath, repoRoot } from "./paths.js";

const LINT_RATCHET_BASELINE_REGENERATE = musiLintRatchetWorkflowVocabulary.updateCommand;

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
const PRE_FLIP_BASELINE_REVISION = "08aa91a0ab8ac5b9d60ecc7b57794f8252ed5483";
const FLIP_BASELINE_REVISION = "c6586fffcfd05190ea0daa075e0c0834ab6d09ef";
const COMMITTED_BASELINE_ARTIFACTS = [
  "lint-ratchet.baseline.json",
  "examples/lint-ratchet-demo/lint-ratchet.baseline.json",
] as const;
const fixtureRuleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [baseRatchet.id, FIXTURE_RULE_SOURCE_HASH],
  [complexityRatchet.id, FIXTURE_RULE_SOURCE_HASH],
  [maxLinesRatchet.id, FIXTURE_RULE_SOURCE_HASH],
]);

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

function functionWithEffectiveLines(name: string, effectiveLines: number): string {
  const wrapperLines = 2;
  const statements = Array.from(
    { length: effectiveLines - wrapperLines },
    (_, index) => `  void ${String(index)};`,
  );
  return [`export function ${name}() {`, ...statements, "}"].join("\n");
}

function maxLinesPerFunctionItems(
  ratchet: LintRatchetConfig,
  path: string,
  functions: readonly string[],
): ReturnType<typeof itemsFromResults> {
  const linter = new Linter();
  const messages = linter.verify(
    `${functions.join("\n\n")}\n`,
    [
      {
        languageOptions: { ecmaVersion: 2022, sourceType: "module" },
        rules: { [ratchet.ruleId]: ["error", ...ratchet.ruleOptions] },
      },
    ],
    // Linter's flat-config defaults select JavaScript extensions; the generated
    // source is valid JS and exercises the same core rule/options used by the
    // minimal TypeScript ratchet parser.
    { filename: "baseline-debt.js" },
  );
  return itemsFromResults(ratchet, [{ filePath: path, messages }], "");
}

function lintWithCoreRatchet(
  ratchet: LintRatchetConfig,
  source: string,
): ReturnType<Linter["verify"]> {
  const linter = new Linter();
  return linter.verify(
    source,
    [
      {
        languageOptions: { ecmaVersion: 2022, sourceType: "module" },
        rules: { [ratchet.ruleId]: ["error", ...ratchet.ruleOptions] },
      },
    ],
    { filename: "git-exec-ratchet.js" },
  );
}

function oneTestBaseline(paths: readonly [string, number][]): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [baseRatchet],
    current([[baseRatchet.id, paths.map(([path, count]) => [path, count])]]),
    fixtureRuleSourceHashes,
    { workflowVocabulary: musiLintRatchetWorkflowVocabulary },
  );
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

describe("production function structure ratchets", () => {
  const expectedFiles = ["packages/{client,server,shared}/src/**/*.{ts,tsx}"];
  const expectedIgnores = [
    "**/dist/**",
    "**/generated/**",
    "**/node_modules/**",
    "packages/client/src/**/*.{test,spec}.{ts,tsx}",
    "packages/client/src/**/*test-helper*.{ts,tsx}",
    "packages/client/src/test/**/*.{ts,tsx}",
    "packages/server/src/**/*.{test,spec}.{ts,tsx}",
    "packages/server/src/**/*test-helper*.{ts,tsx}",
    "packages/server/src/**/__type-tests__/**/*.{ts,tsx}",
    "packages/server/src/test/**/*.{ts,tsx}",
    "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
    "packages/shared/src/**/*test-helper*.{ts,tsx}",
    "packages/shared/src/test/**/*.{ts,tsx}",
  ];

  it.each([
    {
      id: "ratchet/max-depth-production",
      ruleId: "max-depth",
      ruleOptions: [{ max: 3 }],
    },
    {
      id: "ratchet/max-lines-per-function-production",
      ruleId: "max-lines-per-function",
      ruleOptions: [{ max: 100, skipBlankLines: true, skipComments: true }],
    },
  ])("registers $id as a production-only core floor", ({ id, ruleId, ruleOptions }) => {
    const ratchet = lintRatchets.find((entry) => entry.id === id);
    expect(ratchet).toMatchObject({
      id,
      ruleId,
      source: { kind: "core" },
      parserProfile: "minimal-ts",
      files: expectedFiles,
      ignores: expectedIgnores,
      ruleOptions,
      mode: "no-new",
      metric: "message-count",
    });
  });

  it("pins the accepted message-count gap for baseline max-lines-per-function debt", () => {
    const ratchet = lintRatchets.find(
      (entry) => entry.id === "ratchet/max-lines-per-function-production",
    );
    if (ratchet === undefined)
      throw new Error("expected production max-lines-per-function ratchet");
    const path = "packages/server/src/baseline-debt.ts";
    const normalLintCeiling = 200;
    const grownEffectiveLines = 180;
    expect(grownEffectiveLines).toBeLessThan(normalLintCeiling);
    const baselineItems = maxLinesPerFunctionItems(ratchet, path, [
      functionWithEffectiveLines("baselineDebt", 120),
    ]);
    const baseline = buildLintRatchetBaseline(
      [ratchet],
      new Map([[ratchet.id, baselineItems]]),
      new Map([[ratchet.id, FIXTURE_RULE_SOURCE_HASH]]),
      { workflowVocabulary: musiLintRatchetWorkflowVocabulary },
    );

    const grownItems = maxLinesPerFunctionItems(ratchet, path, [
      functionWithEffectiveLines("baselineDebt", grownEffectiveLines),
    ]);
    expect(baselineItems.get(path)?.count).toBe(1);
    expect(grownItems.get(path)?.count).toBe(1);
    const grownComparison = compareCurrentToBaseline(
      baseline,
      [ratchet],
      new Map([[ratchet.id, grownItems]]),
      musiLintRatchetWorkflowVocabulary,
    );
    expect(grownComparison.regressions).toEqual([]);
    expect(grownComparison.improvements).toEqual([]);
    expect(() => {
      assertCheckBaselineComparisonClean(grownComparison);
    }).not.toThrow();

    const newDebtItems = maxLinesPerFunctionItems(ratchet, path, [
      functionWithEffectiveLines("baselineDebt", grownEffectiveLines),
      functionWithEffectiveLines("newDebt", 110),
    ]);
    expect(newDebtItems.get(path)?.count).toBe(2);
    const newDebtComparison = compareCurrentToBaseline(
      baseline,
      [ratchet],
      new Map([[ratchet.id, newDebtItems]]),
      musiLintRatchetWorkflowVocabulary,
    );
    expect(newDebtComparison.regressions).toEqual([
      expect.objectContaining({
        testId: ratchet.id,
        ruleId: ratchet.ruleId,
        path,
        baselineCount: 1,
        currentCount: 2,
        reason: "increased-count",
      }),
    ]);
    expect(() => {
      assertCheckBaselineComparisonClean(newDebtComparison);
    }).toThrow("finding count increased from 1 to 2");
  });
});

describe("direct Git exec ratchet", () => {
  function directGitExecRatchet(): LintRatchetConfig {
    const ratchet = lintRatchets.find((entry) => entry.id === "ratchet/no-direct-git-exec-scripts");
    if (ratchet === undefined) throw new Error("expected direct Git exec ratchet");
    return ratchet;
  }

  it("scopes the message-count floor to script callers outside the Git seam", () => {
    expect(directGitExecRatchet()).toMatchObject({
      ruleId: "no-restricted-syntax",
      source: { kind: "core" },
      parserProfile: "minimal-ts",
      files: ["scripts/**/*.ts"],
      ignores: [
        "**/dist/**",
        "**/generated/**",
        "**/node_modules/**",
        "examples/**",
        "scripts/codemods/fixtures/**",
        "scripts/drift-ai/fixtures/**",
        "scripts/fixtures/**",
        "scripts/harness-audit/fixtures/**",
        "scripts/lib/git.ts",
        "scripts/logs-audit/fixtures/**",
      ],
      mode: "no-new",
      metric: "message-count",
    });
  });

  it("reports literal Git calls through the supported child-process functions", () => {
    const ratchet = directGitExecRatchet();
    const sources = [
      'execFile("git", []);',
      'execFileSync("git", []);',
      'spawn("git", []);',
      'spawnSync("git", []);',
    ];

    for (const source of sources) {
      expect(lintWithCoreRatchet(ratchet, source), source).toHaveLength(1);
    }
  });

  it("does not count named seam calls, other executables, or non-process methods", () => {
    const ratchet = directGitExecRatchet();
    const source = [
      'defaultGitRunner()(["status"]);',
      'readGitBlobAtRef(git, "HEAD", "docs/map.md");',
      'execFileSync("bun", ["test"]);',
      'repository.spawnSync("git", []);',
    ].join("\n");

    expect(lintWithCoreRatchet(ratchet, source)).toEqual([]);
  });
});

describe("lint ratchet diagnostics envelope", () => {
  it.each(["ratchet/max-depth-production", "ratchet/max-lines-per-function-production"])(
    "steers %s regressions toward guard clauses without metric gaming",
    (id) => {
      const ratchet = lintRatchets.find((entry) => entry.id === id);
      if (ratchet === undefined) throw new Error(`expected ${id} in the registry`);
      const envelope = buildEnvelope(
        [
          {
            testId: ratchet.id,
            ruleId: ratchet.ruleId,
            path: "packages/server/src/regressed.ts",
            baselineCount: 0,
            currentCount: 1,
            reason: "new-path",
          },
        ],
        [],
        new Map(),
        [ratchet],
      );

      const howToFix = envelope.findings[0]?.howToFix ?? "";
      expect(howToFix).toContain("Prefer early returns and guard clauses");
      expect(howToFix).toContain(
        "Do not compress lines, flatten branches mechanically, or inline useful helpers just to satisfy the metric.",
      );
    },
  );

  it("uses split-first guidance for local effective-line-count regressions", () => {
    const path = "packages/server/src/large.ts";
    const localRuleDocs: RuleDocsEntry = {
      id: maxLinesRatchet.ruleId,
      description: "Keep modules within the local max-lines budget.",
      principle: "Keep modules focused enough to review safely.",
      category: "maintainability",
      pairedGuide: "docs/guides/lint-ratchet.md",
      repairKind: "manual",
    };
    const envelope = buildEnvelope(
      [
        {
          testId: maxLinesRatchet.id,
          ruleId: maxLinesRatchet.ruleId,
          path,
          baselineCount: 1,
          currentCount: 1,
          baselineLines: 320,
          currentLines: 333,
          reason: "increased-lines",
        },
      ],
      [],
      new Map([[localRuleDocs.id, localRuleDocs]]),
      [maxLinesRatchet],
    );

    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.findings[0]).toMatchObject({
      control: maxLinesRatchet.id,
      severity: "block",
      path,
      ruleId: maxLinesRatchet.ruleId,
      baselineCount: 1,
      currentCount: 1,
      baselineLines: 320,
      currentLines: 333,
      reason: "increased-lines",
      repairKind: "manual",
    });
    const howToFix = envelope.findings[0]?.howToFix ?? "";
    expect(howToFix).toContain("Split the module into focused components, helpers, or types");
    expect(howToFix).toContain(
      "brings this file's local/max-lines effective line count back to the committed baseline (320)",
    );
    expect(howToFix).toContain(
      "Do not compress lines or inline useful helpers just to satisfy the metric.",
    );
    expect(howToFix).toContain("before committing your work");
    expect(howToFix).not.toContain("code-golf");
    expect(howToFix).not.toContain("effective line count from 333");
    expect(howToFix).not.toContain("in a cleanup PR");
    expect(howToFix).not.toContain("Repair manually");
    expect(howToFix).not.toContain("Apply the ESLint suggestion");
  });

  it("uses split-first guidance for complexity regressions without duplicated wording", () => {
    const path = "packages/server/src/branchy.ts";
    const envelope = buildEnvelope(
      [
        {
          testId: complexityRatchet.id,
          ruleId: complexityRatchet.ruleId,
          path,
          baselineCount: 1,
          currentCount: 1,
          baselineComplexity: 12,
          currentComplexity: 14,
          reason: "increased-complexity",
        },
      ],
      [],
      new Map(),
      [complexityRatchet],
    );

    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.findings[0]).toMatchObject({
      control: complexityRatchet.id,
      severity: "block",
      path,
      ruleId: complexityRatchet.ruleId,
      baselineCount: 1,
      currentCount: 1,
      baselineComplexity: 12,
      currentComplexity: 14,
      reason: "increased-complexity",
      repairKind: "manual",
    });
    const howToFix = envelope.findings[0]?.howToFix ?? "";
    expect(howToFix).toContain(
      "Split complex logic into focused functions, modules, helpers, or types",
    );
    expect(howToFix).toContain("brings this file's complexity back to the committed baseline (12)");
    expect(howToFix).toContain("before committing your work");
    expect(howToFix).not.toContain("complexity from 14");
    expect(howToFix).not.toContain("complexity complexity");
    expect(howToFix).not.toContain("in a cleanup PR");
  });

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
        kind: "improvement",
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
        kind: "improvement",
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
        kind: "improvement",
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
        kind: "improvement",
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
    expect(
      envelope.findings.map((finding) => [finding.control, finding.reason, finding.kind]),
    ).toEqual([
      [complexityRatchet.id, "lower-count", "improvement"],
      [coreRatchet.id, "increased-count", "regression"],
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

  it("keeps the full allow-worse update form out of per-finding regression guidance", () => {
    const envelope = buildEnvelope(
      [
        {
          testId: thirdPartyRatchet.id,
          ruleId: thirdPartyRatchet.ruleId,
          path: "packages/server/src/regressed.ts",
          baselineCount: 0,
          currentCount: 1,
          reason: "new-path",
        },
      ],
      [],
      new Map(),
      [thirdPartyRatchet],
    );

    const howToFix = envelope.findings[0]?.howToFix ?? "";
    expect(howToFix).toContain("see the run summary recovery command");
    expect(howToFix).not.toContain(
      'bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"',
    );
    expect(howToFix).not.toContain("run `bun run lint:ratchet:update`");
  });

  it("surfaces the registry disposition reason in a generic finding why", () => {
    const strictBoolean = lintRatchets.find(
      (ratchet) => ratchet.id === "ratchet/strict-boolean-expressions-shared",
    );
    if (strictBoolean === undefined) {
      throw new Error("expected ratchet/strict-boolean-expressions-shared in the registry");
    }
    const envelope = buildEnvelope(
      [
        {
          testId: strictBoolean.id,
          ruleId: strictBoolean.ruleId,
          path: "packages/shared/src/regressed.ts",
          baselineCount: 0,
          currentCount: 1,
          reason: "new-path",
        },
      ],
      [],
      new Map(),
      [strictBoolean],
    );

    const why = envelope.findings[0]?.why ?? "";
    expect(why).toContain(`Ratchet regression for ${strictBoolean.ruleId}:`);
    expect(why).toContain("normal ESLint deliberately keeps");
  });

  it("lower-cases the ratchet fix when appended to command-based local rule howToFix", () => {
    const cases = [
      {
        repairKind: "codemod" as const,
        repairCommand: "bun run codemod:type-assertion-boundary",
        prefix: "Run `bun run codemod:type-assertion-boundary`, then reduce this file's",
      },
      {
        repairKind: "autofix" as const,
        prefix: "Run `bun run lint:fix`, then reduce this file's",
      },
    ];

    for (const { repairKind, repairCommand, prefix } of cases) {
      const localRuleDocs: RuleDocsEntry = {
        id: baseRatchet.ruleId,
        description: "Type assertions must stay at framework/JSON/Prisma/test boundaries.",
        principle: "Keep type assertions at boundaries.",
        category: "maintainability",
        pairedGuide: "docs/guides/type-assertions.md",
        repairKind,
        ...(repairCommand === undefined ? {} : { repairCommand }),
      };
      const envelope = buildEnvelope(
        [
          {
            testId: baseRatchet.id,
            ruleId: baseRatchet.ruleId,
            path: "packages/server/src/regressed.ts",
            baselineCount: 1,
            currentCount: 2,
            reason: "increased-count",
          },
        ],
        [],
        new Map([[localRuleDocs.id, localRuleDocs]]),
        [baseRatchet],
      );

      const howToFix = envelope.findings[0]?.howToFix ?? "";
      expect(howToFix).toContain(prefix);
      expect(howToFix).not.toContain(", then Reduce this file's");
    }
  });

  it("uses a manual local-rule message tail before ratchet guidance when available", () => {
    const localRuleDocs: RuleDocsEntry = {
      id: baseRatchet.ruleId,
      description: "Type assertions must stay at framework/JSON/Prisma/test boundaries.",
      principle: "Keep type assertions at boundaries.",
      category: "maintainability",
      pairedGuide: "docs/guides/type-assertions.md",
      repairKind: "manual",
    };
    const envelope = buildEnvelope(
      [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: "packages/server/src/regressed.ts",
          baselineCount: 1,
          currentCount: 2,
          firstMessage:
            "Why: Type assertion escaped the boundary. How to fix: Move the assertion to the JSON parser boundary.",
          firstMessageId: "unexpectedAssertion",
          reason: "increased-count",
        },
      ],
      [],
      new Map([[localRuleDocs.id, localRuleDocs]]),
      [baseRatchet],
    );

    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
    const finding = envelope.findings[0];
    expect(finding).toMatchObject({
      control: baseRatchet.id,
      ruleId: baseRatchet.ruleId,
      messageId: "unexpectedAssertion",
      repairKind: "manual",
    });
    const howToFix = finding?.howToFix ?? "";
    expect(howToFix).toContain("Move the assertion to the JSON parser boundary.");
    expect(howToFix).toContain("See docs/guides/type-assertions.md.");
    expect(howToFix).toContain(
      "Then reduce this file's local/type-assertion-boundary finding count",
    );
    expect(howToFix).toContain("back to the committed baseline (1)");
  });

  it("falls back to generic local-rule ratchet guidance when no message is available", () => {
    const localRuleDocs: RuleDocsEntry = {
      id: baseRatchet.ruleId,
      description: "Type assertions must stay at framework/JSON/Prisma/test boundaries.",
      principle: "Keep type assertions at boundaries.",
      category: "maintainability",
      pairedGuide: "docs/guides/type-assertions.md",
      repairKind: "manual",
    };
    const envelope = buildEnvelope(
      [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path: "packages/server/src/regressed.ts",
          baselineCount: 1,
          currentCount: 2,
          reason: "increased-count",
        },
      ],
      [],
      new Map([[localRuleDocs.id, localRuleDocs]]),
      [baseRatchet],
    );

    const howToFix = envelope.findings[0]?.howToFix ?? "";
    expect(howToFix).toBe(
      "Reduce this file's local/type-assertion-boundary finding count from 2 back to the committed baseline (1), or see the run summary recovery command if the new debt is intentional.",
    );
    expect(howToFix).not.toContain("See docs/guides/type-assertions.md.");
  });

  it("names the differing option in option-mismatch ratchet why text", () => {
    const cases = [
      { id: "ratchet/vitest-expect-expect-drift-ai-tests", option: "assertFunctionNames" },
      { id: "ratchet/vitest-expect-expect-script-tests", option: "assertFunctionNames" },
    ] as const;
    for (const { id, option } of cases) {
      const ratchet = lintRatchets.find((entry) => entry.id === id);
      if (ratchet === undefined) throw new Error(`expected ${id} in the registry`);
      const envelope = buildEnvelope(
        [
          {
            testId: ratchet.id,
            ruleId: ratchet.ruleId,
            path: "scripts/example.test.ts",
            baselineCount: 0,
            currentCount: 1,
            reason: "new-path",
          },
        ],
        [],
        new Map(),
        [ratchet],
      );
      expect(envelope.findings[0]?.why, id).toContain(option);
    }
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

  it("emits equal-count message swaps as info findings without blocking", () => {
    const path = "packages/server/src/app.ts";
    const envelope = buildEnvelopeFromComparison({
      regressions: [],
      improvements: [],
      infos: [
        {
          testId: baseRatchet.id,
          ruleId: baseRatchet.ruleId,
          path,
          baselineCount: 2,
          currentCount: 2,
          reason: "equal-count-message-swap",
        },
      ],
      ruleDocsById: new Map(),
      ratchets: [baseRatchet],
    });

    expect(envelope.findings).toEqual([
      {
        control: baseRatchet.id,
        severity: "info",
        path,
        ruleId: baseRatchet.ruleId,
        kind: "info",
        reason: "equal-count-message-swap",
        baselineCount: 2,
        currentCount: 2,
        why: `${baseRatchet.id} has a different message fingerprint at the same count for ${baseRatchet.ruleId}.`,
        howToFix:
          "Review the equal-count finding swap; if it is intentional, run `bun run lint:ratchet:update` to refresh the message fingerprint.",
        repairKind: "manual",
      },
    ]);
    expect(envelope.summary).toEqual({
      blocking: 0,
      warning: 0,
      info: 1,
      byControl: { [baseRatchet.id]: 1 },
    });
    expect(harnessDiagnosticsSchema.safeParse(envelope).success).toBe(true);
  });
});

describe("lint ratchet baseline parsing", () => {
  it("round-trips the committed baseline byte-identically", () => {
    const committed = readFileSync(baselinePath, "utf8");
    const parsed = parseLintRatchetBaselineStructure(committed, musiLintRatchetWorkflowVocabulary);

    expect(parsed.failures).toEqual([]);
    expect(parsed.baseline).toBeDefined();
    expect(
      formatLintRatchetBaseline(
        parsed.baseline ?? oneTestBaseline([]),
        musiLintRatchetWorkflowVocabulary,
      ),
    ).toBe(committed);
  });

  it("round-trips committed v1 bytes under a write-version-2 engine", () => {
    const committed = execFileSync(
      "git",
      ["show", `${PRE_FLIP_BASELINE_REVISION}:lint-ratchet.baseline.json`],
      { cwd: repoRoot, encoding: "utf8" },
    );
    const writeV2 = createLintRatchetBaselineVersionPolicy(2);
    const parsed = parseLintRatchetBaselineStructure(
      committed,
      musiLintRatchetWorkflowVocabulary,
      writeV2,
    );

    expect(parsed.failures).toEqual([]);
    expect(parsed.baseline?.version).toBe(1);
    expect(
      formatLintRatchetBaseline(
        parsed.baseline ?? oneTestBaseline([]),
        musiLintRatchetWorkflowVocabulary,
      ),
    ).toBe(committed);
  });

  it.each(COMMITTED_BASELINE_ARTIFACTS)(
    "preserves the complete nested tests object across the deliberate flip of %s",
    (artifactPath) => {
      const beforeText = execFileSync(
        "git",
        ["show", `${PRE_FLIP_BASELINE_REVISION}:${artifactPath}`],
        { cwd: repoRoot, encoding: "utf8" },
      );
      const afterText = execFileSync("git", ["show", `${FLIP_BASELINE_REVISION}:${artifactPath}`], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      const before = parseLintRatchetBaselineStructure(
        beforeText,
        musiLintRatchetWorkflowVocabulary,
      );
      const after = parseLintRatchetBaselineStructure(afterText, musiLintRatchetWorkflowVocabulary);

      expect(before.failures).toEqual([]);
      expect(after.failures).toEqual([]);
      expect(before.baseline?.version).toBe(1);
      expect(before.baseline?.regenerate).toBeUndefined();
      expect(after.baseline?.tests).toEqual(before.baseline?.tests);
      expect(after.baseline?.version).toBe(2);
      expect(after.baseline?.regenerate).toBe(LINT_RATCHET_BASELINE_REGENERATE);
    },
  );
});

describe("lint ratchet update decisions", () => {
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
