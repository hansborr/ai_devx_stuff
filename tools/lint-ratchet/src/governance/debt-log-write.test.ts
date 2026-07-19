import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildLintRatchetBaseline,
  decideLintRatchetUpdate,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetCurrentById,
  parseLintRatchetBaselineStructure,
} from "../kernel/baseline.js";
import type { LintRatchetConfig } from "../kernel/config-types.js";
import { createLintRatchetEngineContext } from "../kernel/engine-context.js";
import { ConfigError } from "../kernel/metrics-types.js";
import { checkBaselineDebtAccounting } from "./baseline-debt-accounting.js";
import { applyLintRatchetUpdate, type RunUpdateDeps } from "./baseline-update-apply.js";
import type { LintRatchetDebtLogEntry } from "./debt-log-schema.js";
import {
  isAcceptedDebtLogEntry,
  isCoverageShrinkLogEntry,
  isMetricMigrationLogEntry,
  parseLintRatchetDebtLogEntry,
} from "./debt-log-schema.js";
import { appendValidatedDebtLogEntry, buildLintRatchetDebtLogEntry } from "./debt-log-write.js";
import { WorseBaselineError } from "./errors.js";

// A synthetic fixture context: every filesystem access in these suites goes
// through the injected RunUpdateDeps recorder, so the operation only ever sees
// these paths as opaque strings.
const fixtureContext = createLintRatchetEngineContext({ repoRoot: "/lint-ratchet-fixture" });
const { baselinePath, debtLogPath } = fixtureContext;

const PATH = "packages/server/src/legacy.ts";

const ratchet: LintRatchetConfig = {
  id: "ratchet/local-debt-fixture",
  ruleId: "no-debugger",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  repairKind: "manual",
  principle: "Fixture debt-log ratchet principle.",
};

// Same ratchet id, but measuring effective-line-count instead of message-count:
// a metric migration through the update flow must record why the new measure is
// the right one, because per-path values are not comparable across metrics.
const lineRatchet: LintRatchetConfig = {
  ...ratchet,
  metric: "effective-line-count",
};

const ruleSourceHashes = new Map([[ratchet.id, `sha256:${"a".repeat(64)}`]]);

function baselineWith(
  counts: Record<string, number>,
  config: LintRatchetConfig = ratchet,
): LintRatchetBaseline {
  const items = new Map(Object.entries(counts).map(([path, count]) => [path, { count }]));
  const currentById: LintRatchetCurrentById = new Map([[config.id, items]]);
  return buildLintRatchetBaseline([config], currentById, ruleSourceHashes);
}

function lineBaselineWith(lines: Record<string, number>): LintRatchetBaseline {
  const items = new Map(
    Object.entries(lines).map(([path, lineCount]) => [path, { count: 1, lines: lineCount }]),
  );
  const currentById: LintRatchetCurrentById = new Map([[lineRatchet.id, items]]);
  return buildLintRatchetBaseline([lineRatchet], currentById, ruleSourceHashes);
}

function lineBaselineWithCounts(
  items: Record<string, { count: number; lines: number }>,
): LintRatchetBaseline {
  const entries = new Map(
    Object.entries(items).map(([path, value]) => [
      path,
      { count: value.count, lines: value.lines },
    ]),
  );
  const currentById: LintRatchetCurrentById = new Map([[lineRatchet.id, entries]]);
  return buildLintRatchetBaseline([lineRatchet], currentById, ruleSourceHashes);
}

interface Recorder {
  readonly deps: RunUpdateDeps;
  readonly calls: string[];
  readonly appended: string[];
  readonly written: string[];
}

function recorder(
  committedText: string | undefined,
  opts?: {
    readonly debtLogText?: string;
    readonly throwOnAppend?: boolean;
    readonly throwOnWrite?: boolean;
  },
): Recorder {
  const calls: string[] = [];
  const appended: string[] = [];
  const written: string[] = [];
  const deps: RunUpdateDeps = {
    existsSync: (path) =>
      (committedText !== undefined && path === baselinePath) ||
      (opts?.debtLogText !== undefined && path === debtLogPath),
    readFileSync: (path) => {
      if (path === baselinePath && committedText !== undefined) return committedText;
      if (path === debtLogPath && opts?.debtLogText !== undefined) return opts.debtLogText;
      throw new Error(`unexpected readFileSync(${path})`);
    },
    appendFileSync: (path, data) => {
      calls.push(`append:${path === debtLogPath ? "debt-log" : path}`);
      if (opts?.throwOnAppend === true) throw new Error("disk full");
      appended.push(data);
    },
    writeFileAtomicallySync: (path, data) => {
      calls.push(`write:${path === baselinePath ? "baseline" : path}`);
      if (opts?.throwOnWrite === true) throw new Error("write failed");
      written.push(data);
    },
  };
  return { deps, calls, appended, written };
}

const errorLines: string[] = [];

beforeEach(() => {
  errorLines.length = 0;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errorLines.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildLintRatchetDebtLogEntry", () => {
  it("maps an accepted worse decision to a version-1 entry with the acceptance reason", () => {
    const decision = decideLintRatchetUpdate(
      baselineWith({ [PATH]: 1 }),
      baselineWith({ [PATH]: 2 }),
      [ratchet],
      { allowWorse: true, reason: "intentional" },
    );
    const entry = buildLintRatchetDebtLogEntry(decision, "intentional debt for the legacy module");

    expect(entry.version).toBe("1");
    expect(entry.acceptanceReason).toBe("intentional debt for the legacy module");
    expect(entry.regressions).toHaveLength(1);
    expect(entry.regressions[0]).toMatchObject({
      testId: ratchet.id,
      ruleId: "no-debugger",
      path: PATH,
      baselineCount: 1,
      currentCount: 2,
      reason: "increased-count",
    });
    expect(entry.orphansRemoved).toEqual([]);
    expect(parseLintRatchetDebtLogEntry(JSON.parse(JSON.stringify(entry))).failures).toEqual([]);
  });

  it("does not commit current-run message context to debt-log regressions", () => {
    const decision = decideLintRatchetUpdate(
      baselineWith({ [PATH]: 1 }),
      baselineWith({ [PATH]: 2 }),
      [ratchet],
      { allowWorse: true, reason: "intentional" },
    );
    const entry = buildLintRatchetDebtLogEntry(
      {
        ...decision,
        regressions: decision.regressions.map((regression) => ({
          ...regression,
          firstMessage:
            "Why: A local rule found accepted debt. How to fix: Use the live run guidance.",
          firstMessageId: "acceptedDebt",
        })),
      },
      "intentional debt for the legacy module",
    );

    expect(JSON.stringify(entry)).not.toContain("firstMessage");
    expect(JSON.stringify(entry)).not.toContain("acceptedDebt");
    expect(parseLintRatchetDebtLogEntry(JSON.parse(JSON.stringify(entry))).failures).toEqual([]);
  });

  it("records structured orphan removals when no registry id matches", () => {
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 })).replace(
      ratchet.id,
      "ratchet/old-debt-fixture",
    );
    const committed = parseLintRatchetBaselineStructure(committedText).baseline;
    expect(committed).toBeDefined();
    const generated = baselineWith({});

    const decision = decideLintRatchetUpdate(committed ?? generated, generated, [ratchet], {
      allowWorse: true,
      reason: "removed rule",
    });
    expect(decision.regressions).toEqual([]);

    const entry = buildLintRatchetDebtLogEntry(
      decision,
      "removed ratchet/old-debt-fixture: rule deleted",
    );
    expect(entry.orphansRemoved).toEqual([
      {
        testId: "ratchet/old-debt-fixture",
        ruleId: "no-debugger",
        metric: "message-count",
        baselineItems: [{ path: PATH, count: 1 }],
      },
    ]);
    expect(parseLintRatchetDebtLogEntry(JSON.parse(JSON.stringify(entry))).entry).toBeDefined();
  });

  it("carries no timestamp, git, or baseline-hash fields", () => {
    const decision = decideLintRatchetUpdate(
      baselineWith({ [PATH]: 1 }),
      baselineWith({ [PATH]: 2 }),
      [ratchet],
      { allowWorse: true, reason: "intentional" },
    );
    const entry = buildLintRatchetDebtLogEntry(
      decision,
      "intentional debt that is sufficiently described",
    );

    expect(Object.keys(entry).sort()).toEqual([
      "acceptanceReason",
      "orphansRemoved",
      "regressions",
      "version",
    ]);
    const serialized = JSON.stringify(entry);
    for (const forbidden of [
      "timestamp",
      "branch",
      "commit",
      "committedAt",
      "configHash",
      "ruleSourceHash",
      "sha256",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("appendValidatedDebtLogEntry", () => {
  it("refuses an invalid entry and never appends", () => {
    const rec = recorder(undefined);
    const invalid: LintRatchetDebtLogEntry = {
      version: "1",
      acceptanceReason: "missing accepted debt",
      regressions: [],
      orphansRemoved: [],
    };

    expect(() => {
      appendValidatedDebtLogEntry(invalid, debtLogPath, rec.deps);
    }).toThrow(ConfigError);
    expect(rec.appended).toEqual([]);
  });

  it("appends one newline-terminated JSON line for a valid entry", () => {
    const rec = recorder(undefined);
    const entry: LintRatchetDebtLogEntry = {
      version: "1",
      acceptanceReason: "intentional debt that is sufficiently described",
      regressions: [],
      orphansRemoved: [
        {
          testId: "ratchet/old",
          ruleId: "no-debugger",
          metric: "message-count",
          baselineItems: [{ path: PATH, count: 1 }],
        },
      ],
    };

    appendValidatedDebtLogEntry(entry, debtLogPath, rec.deps);
    expect(rec.appended).toHaveLength(1);
    expect(rec.appended[0]?.endsWith("\n")).toBe(true);
    expect(JSON.parse(rec.appended[0] ?? "")).toEqual(entry);
  });

  it("skips appending when the same JSON line is already at the debt-log tail", () => {
    const entry: LintRatchetDebtLogEntry = {
      version: "1",
      acceptanceReason: "intentional debt that is sufficiently described",
      regressions: [
        {
          testId: ratchet.id,
          ruleId: ratchet.ruleId,
          path: PATH,
          baselineCount: 1,
          currentCount: 2,
          reason: "increased-count",
        },
      ],
      orphansRemoved: [],
    };
    const rec = recorder(undefined, { debtLogText: `{"version":"1"}\n${JSON.stringify(entry)}\n` });

    expect(appendValidatedDebtLogEntry(entry, debtLogPath, rec.deps)).toBe(false);
    expect(rec.appended).toEqual([]);
  });

  it("inserts a newline before appending to a non-empty unterminated log", () => {
    const entry = buildLintRatchetDebtLogEntry(
      decideLintRatchetUpdate(baselineWith({ [PATH]: 1 }), baselineWith({ [PATH]: 2 }), [ratchet], {
        allowWorse: true,
        reason: "reviewed",
      }),
      "reviewed debt for the legacy module",
    );
    const rec = recorder(undefined, { debtLogText: '{"version":"1"}' });

    appendValidatedDebtLogEntry(entry, debtLogPath, rec.deps);

    expect(rec.appended[0]?.startsWith("\n")).toBe(true);
    expect(rec.appended[0]?.endsWith("\n")).toBe(true);
  });
});

describe("applyLintRatchetUpdate", () => {
  it("records an accepted glob-driven coverage shrink before writing the baseline", () => {
    const droppedPath = "packages/client/src/legacy.ts";
    const narrowedRatchet: LintRatchetConfig = {
      ...ratchet,
      ignores: [droppedPath],
    };
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1, [droppedPath]: 2 }));
    const generated = baselineWith({ [PATH]: 1 }, narrowedRatchet);
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [narrowedRatchet],
      options: { allowWorse: true, reason: "move client coverage to a dedicated ratchet" },
      currentFindingCount: 1,
      deps: rec.deps,
    });

    expect(logged).toBe(true);
    expect(rec.calls).toEqual(["append:debt-log", "write:baseline"]);
    const parsed = parseLintRatchetDebtLogEntry(JSON.parse(rec.appended[0] ?? ""));
    expect(parsed.entry !== undefined && isCoverageShrinkLogEntry(parsed.entry)).toBe(true);
    if (parsed.entry !== undefined && isCoverageShrinkLogEntry(parsed.entry)) {
      expect(parsed.entry.removedPaths).toEqual([droppedPath]);
      expect(parsed.entry.reason).toBe("move client coverage to a dedicated ratchet");
    }
  });

  it("appends the debt log BEFORE writing the baseline for an accepted worse update", () => {
    const generated = baselineWith({ [PATH]: 2 });
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [ratchet],
      options: { allowWorse: true, reason: "intentional debt: legacy module rewrite pending" },
      currentFindingCount: 2,
      deps: rec.deps,
    });

    expect(logged).toBe(true);
    expect(rec.calls).toEqual(["append:debt-log", "write:baseline"]);
    expect(rec.written).toEqual([rendered]);
    expect(rec.appended).toHaveLength(1);
    const parsed = parseLintRatchetDebtLogEntry(JSON.parse(rec.appended[0] ?? ""));
    expect(parsed.entry !== undefined && isAcceptedDebtLogEntry(parsed.entry)).toBe(true);
    if (parsed.entry !== undefined && isAcceptedDebtLogEntry(parsed.entry)) {
      expect(parsed.entry.acceptanceReason).toBe("intentional debt: legacy module rewrite pending");
    }
    expect(errorLines.join("\n")).toContain("lint-ratchet.debt-log.jsonl");
  });

  it("logs nothing on a true no-op re-run", () => {
    const generated = baselineWith({ [PATH]: 1 });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(rendered);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [ratchet],
      options: { allowWorse: true, reason: "no-op" },
      currentFindingCount: 1,
      deps: rec.deps,
    });

    expect(logged).toBe(false);
    expect(rec.calls).toEqual([]);
    expect(rec.appended).toEqual([]);
    expect(rec.written).toEqual([]);
  });

  it("locks an improvement without recording any debt", () => {
    const generated = baselineWith({ [PATH]: 1 });
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 2 }));
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [ratchet],
      options: { allowWorse: true, reason: "lock the improvement" },
      currentFindingCount: 1,
      deps: rec.deps,
    });

    expect(logged).toBe(false);
    expect(rec.calls).toEqual(["write:baseline"]);
    expect(rec.appended).toEqual([]);
    expect(rec.written).toEqual([rendered]);
  });

  it("aborts before the baseline write when the append fails", () => {
    const generated = baselineWith({ [PATH]: 2 });
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText, { throwOnAppend: true });

    expect(() =>
      applyLintRatchetUpdate({
        context: fixtureContext,
        generated,
        rendered,
        registry: [ratchet],
        options: { allowWorse: true, reason: "intentional debt for the legacy module" },
        currentFindingCount: 2,
        deps: rec.deps,
      }),
    ).toThrow("disk full");

    expect(rec.calls).toEqual(["append:debt-log"]);
    expect(rec.written).toEqual([]);
  });

  it("does not duplicate the debt log when retrying after a failed baseline write", () => {
    const generated = baselineWith({ [PATH]: 2 });
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const rendered = formatLintRatchetBaseline(generated);
    const firstAttempt = recorder(committedText, { throwOnWrite: true });

    expect(() =>
      applyLintRatchetUpdate({
        context: fixtureContext,
        generated,
        rendered,
        registry: [ratchet],
        options: { allowWorse: true, reason: "intentional debt for the legacy module" },
        currentFindingCount: 2,
        deps: firstAttempt.deps,
      }),
    ).toThrow("write failed");
    expect(firstAttempt.appended).toHaveLength(1);

    const retry = recorder(committedText, { debtLogText: firstAttempt.appended.join("") });
    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [ratchet],
      options: { allowWorse: true, reason: "intentional debt for the legacy module" },
      currentFindingCount: 2,
      deps: retry.deps,
    });

    expect(logged).toBe(false);
    expect(retry.calls).toEqual(["write:baseline"]);
    expect(retry.appended).toEqual([]);
    expect(retry.written).toEqual([rendered]);
    expect(errorLines.join("\n")).not.toContain("Recorded the debt acceptance");
  });

  it("does not duplicate earlier rows from a multi-entry crash retry", () => {
    const droppedPath = "packages/client/src/legacy.ts";
    const narrowedRatchet: LintRatchetConfig = {
      ...ratchet,
      ignores: [droppedPath],
    };
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1, [droppedPath]: 1 }));
    const generated = baselineWith({ [PATH]: 2 }, narrowedRatchet);
    const rendered = formatLintRatchetBaseline(generated);
    const params = {
      generated,
      rendered,
      registry: [narrowedRatchet],
      options: { allowWorse: true, reason: "accepted growth and intentional scope move" },
      currentFindingCount: 2,
    } as const;
    const firstAttempt = recorder(committedText, { throwOnWrite: true });

    expect(() =>
      applyLintRatchetUpdate({
        context: fixtureContext,
        ...params,
        deps: firstAttempt.deps,
      }),
    ).toThrow("write failed");
    expect(firstAttempt.appended.join("").trim().split("\n")).toHaveLength(2);

    const retry = recorder(committedText, { debtLogText: firstAttempt.appended.join("") });
    expect(applyLintRatchetUpdate({ context: fixtureContext, ...params, deps: retry.deps })).toBe(
      false,
    );
    expect(retry.calls).toEqual(["write:baseline"]);
    expect(retry.appended).toEqual([]);
  });

  it("blocks a worse update without --allow-worse and records nothing", () => {
    const generated = baselineWith({ [PATH]: 2 });
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    expect(() =>
      applyLintRatchetUpdate({
        context: fixtureContext,
        generated,
        rendered,
        registry: [ratchet],
        options: { allowWorse: false },
        currentFindingCount: 2,
        deps: rec.deps,
      }),
    ).toThrow(WorseBaselineError);

    expect(rec.appended).toEqual([]);
    expect(rec.written).toEqual([]);
  });

  it("logs nothing when creating a first-ever baseline", () => {
    const generated = baselineWith({ [PATH]: 1 });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(undefined);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [ratchet],
      options: { allowWorse: false },
      currentFindingCount: 1,
      deps: rec.deps,
    });

    expect(logged).toBe(false);
    expect(rec.appended).toEqual([]);
    expect(rec.written).toEqual([rendered]);
  });

  it("records a proven zero-finding retirement before writing the baseline", () => {
    // Committed has an orphaned zero-finding id; generated (from the registry)
    // drops it, so the write removes the floor. With proven promotion, retire
    // must skip --allow-worse and accepted debt while recording the retirement.
    const committedText = formatLintRatchetBaseline(baselineWith({})).replace(
      ratchet.id,
      "ratchet/old-promoted",
    );
    const generated = baselineWith({});
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [ratchet],
      options: {
        allowWorse: false,
        retire: { id: "ratchet/old-promoted", normalErrorProven: true },
      },
      currentFindingCount: 0,
      deps: rec.deps,
    });

    expect(logged).toBe(false);
    expect(rec.calls).toEqual(["append:debt-log", "write:baseline"]);
    expect(rec.appended).toHaveLength(1);
    expect(JSON.parse(rec.appended[0] ?? "")).toEqual({
      version: "1",
      kind: "retirement",
      ratchetId: "ratchet/old-promoted",
      promotionProof: "normal-lint-error",
    });
    expect(rec.written).toEqual([rendered]);
    expect(errorLines.join("\n")).toContain("Retired ratchet ratchet/old-promoted");
    expect(errorLines.join("\n")).toContain("retirement recorded");
  });

  it("refuses to retire an orphan when promotion is not proven", () => {
    const committedText = formatLintRatchetBaseline(baselineWith({})).replace(
      ratchet.id,
      "ratchet/old-promoted",
    );
    const generated = baselineWith({});
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    expect(() =>
      applyLintRatchetUpdate({
        context: fixtureContext,
        generated,
        rendered,
        registry: [ratchet],
        options: {
          allowWorse: false,
          retire: { id: "ratchet/old-promoted", normalErrorProven: false },
        },
        currentFindingCount: 0,
        deps: rec.deps,
      }),
    ).toThrow(WorseBaselineError);

    expect(rec.appended).toEqual([]);
    expect(rec.written).toEqual([]);
  });

  it("records a metric migration that satisfies the debt-accounting gate", () => {
    // message-count -> effective-line-count for the same ratchet id. The update
    // must emit a metric-migration entry so lint:ratchet:check-debt-accounting
    // (which requires a reasoned migration record for a metric change) stays
    // green instead of failing forever.
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const generated = lineBaselineWith({ [PATH]: 100 });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [lineRatchet],
      options: {
        allowWorse: false,
        reason: "the ratchet now measures effective line count instead of message count",
      },
      currentFindingCount: 1,
      deps: rec.deps,
    });

    expect(logged).toBe(false);
    expect(rec.calls).toEqual(["append:debt-log", "write:baseline"]);
    expect(rec.appended).toHaveLength(1);
    const parsed = parseLintRatchetDebtLogEntry(JSON.parse(rec.appended[0] ?? ""));
    expect(parsed.entry !== undefined && isMetricMigrationLogEntry(parsed.entry)).toBe(true);
    if (parsed.entry !== undefined && isMetricMigrationLogEntry(parsed.entry)) {
      expect(parsed.entry).toMatchObject({
        ratchetId: lineRatchet.id,
        fromMetric: "message-count",
        toMetric: "effective-line-count",
        reason: "the ratchet now measures effective line count instead of message count",
      });
    }
    expect(errorLines.join("\n")).toContain("metric migration");

    // End-to-end: the emitted entry actually clears the debt-accounting gate.
    const accounting = checkBaselineDebtAccounting({
      baseBaselineText: committedText,
      currentBaselineText: rendered,
      baseDebtLogText: "",
      currentDebtLogText: rec.appended.join(""),
    });
    expect(accounting.failures).toEqual([]);
  });

  it("still demands --allow-worse for a count increase during a metric migration", () => {
    // count is the ESLint finding count under every metric, so a 1 -> 2 growth
    // is real debt even while the metric changes; a plain --reason must not let
    // it through as if it were only an incomparable metric swap.
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const generated = lineBaselineWithCounts({ [PATH]: { count: 2, lines: 80 } });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    expect(() =>
      applyLintRatchetUpdate({
        context: fixtureContext,
        generated,
        rendered,
        registry: [lineRatchet],
        options: { allowWorse: false, reason: "migrate the ratchet to effective line count" },
        currentFindingCount: 2,
        deps: rec.deps,
      }),
    ).toThrow(WorseBaselineError);

    expect(rec.appended).toEqual([]);
    expect(rec.written).toEqual([]);
  });

  it("records both accepted debt and a migration for a count increase during migration", () => {
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const generated = lineBaselineWithCounts({ [PATH]: { count: 2, lines: 80 } });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [lineRatchet],
      options: {
        allowWorse: true,
        reason: "migrate to effective line count and accept the extra finding",
      },
      currentFindingCount: 2,
      deps: rec.deps,
    });

    expect(logged).toBe(true);
    expect(rec.calls).toEqual(["append:debt-log", "write:baseline"]);
    const entries = (rec.appended[0] ?? "")
      .trim()
      .split("\n")
      .map((line) => parseLintRatchetDebtLogEntry(JSON.parse(line)).entry);
    expect(entries.some((entry) => entry !== undefined && isAcceptedDebtLogEntry(entry))).toBe(
      true,
    );
    expect(entries.some((entry) => entry !== undefined && isMetricMigrationLogEntry(entry))).toBe(
      true,
    );

    // End-to-end: both entries together clear the debt-accounting gate.
    const accounting = checkBaselineDebtAccounting({
      baseBaselineText: committedText,
      currentBaselineText: rendered,
      baseDebtLogText: "",
      currentDebtLogText: rec.appended.join(""),
    });
    expect(accounting.failures).toEqual([]);
  });

  it("records per-kind reasons for a mixed update with --migration-reason", () => {
    // The accepted-debt entry answers "why accept this increase" while the
    // migration entry answers "why is the new metric the right measure"; one
    // shared string cannot honestly answer both, so each record must carry the
    // reason given for its own question.
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const generated = lineBaselineWithCounts({ [PATH]: { count: 2, lines: 80 } });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    const logged = applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [lineRatchet],
      options: {
        allowWorse: true,
        reason: "accept the extra finding surfaced during the migration",
        migrationReason: "effective line count is the right measure for this rule",
      },
      currentFindingCount: 2,
      deps: rec.deps,
    });

    expect(logged).toBe(true);
    const entries = (rec.appended[0] ?? "")
      .trim()
      .split("\n")
      .flatMap((line) => {
        const entry = parseLintRatchetDebtLogEntry(JSON.parse(line)).entry;
        return entry === undefined ? [] : [entry];
      });
    const accepted = entries.find(isAcceptedDebtLogEntry);
    const migration = entries.find(isMetricMigrationLogEntry);
    expect(accepted?.acceptanceReason).toBe(
      "accept the extra finding surfaced during the migration",
    );
    expect(migration?.reason).toBe("effective line count is the right measure for this rule");

    // End-to-end: both per-kind-reasoned entries clear the debt-accounting gate.
    const accounting = checkBaselineDebtAccounting({
      baseBaselineText: committedText,
      currentBaselineText: rendered,
      baseDebtLogText: "",
      currentDebtLogText: rec.appended.join(""),
    });
    expect(accounting.failures).toEqual([]);
  });

  it("names --migration-reason when a mixed update passes an invalid migration reason", () => {
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const generated = lineBaselineWithCounts({ [PATH]: { count: 2, lines: 80 } });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    expect(() =>
      applyLintRatchetUpdate({
        context: fixtureContext,
        generated,
        rendered,
        registry: [lineRatchet],
        options: {
          allowWorse: true,
          reason: "accept the extra finding surfaced during the migration",
          migrationReason: "   ",
        },
        currentFindingCount: 2,
        deps: rec.deps,
      }),
    ).toThrow(/needs --migration-reason/);

    expect(rec.appended).toEqual([]);
    expect(rec.written).toEqual([]);
  });

  it("accepts a migration gated by --migration-reason alone", () => {
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const generated = lineBaselineWith({ [PATH]: 100 });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered,
      registry: [lineRatchet],
      options: {
        allowWorse: false,
        migrationReason: "effective line count is the right measure for this rule",
      },
      currentFindingCount: 1,
      deps: rec.deps,
    });

    expect(rec.appended).toHaveLength(1);
    const parsed = parseLintRatchetDebtLogEntry(JSON.parse(rec.appended[0] ?? ""));
    expect(
      parsed.entry !== undefined && isMetricMigrationLogEntry(parsed.entry)
        ? parsed.entry.reason
        : undefined,
    ).toBe("effective line count is the right measure for this rule");
  });

  it("refuses a metric migration without a reason and records nothing", () => {
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const generated = lineBaselineWith({ [PATH]: 100 });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    expect(() =>
      applyLintRatchetUpdate({
        context: fixtureContext,
        generated,
        rendered,
        registry: [lineRatchet],
        options: { allowWorse: false },
        currentFindingCount: 1,
        deps: rec.deps,
      }),
    ).toThrow(WorseBaselineError);

    expect(rec.appended).toEqual([]);
    expect(rec.written).toEqual([]);
  });

  it("records the attested options delta for a different-options retirement", () => {
    const committedText = formatLintRatchetBaseline(baselineWith({})).replace(
      ratchet.id,
      "ratchet/old-promoted",
    );
    const generated = baselineWith({});
    const rec = recorder(committedText);

    applyLintRatchetUpdate({
      context: fixtureContext,
      generated,
      rendered: formatLintRatchetBaseline(generated),
      registry: [ratchet],
      options: {
        allowWorse: false,
        retire: {
          id: "ratchet/old-promoted",
          normalErrorProven: true,
          optionsAttestation: {
            reason: "normal lint uses a stricter reviewed threshold",
            ratchetOptions: [{ max: 20 }],
            normalLintOptions: [[{ max: 10 }]],
          },
        },
      },
      currentFindingCount: 0,
      deps: rec.deps,
    });

    expect(JSON.parse(rec.appended[0] ?? "")).toMatchObject({
      kind: "retirement",
      optionsAttestation: {
        reason: "normal lint uses a stricter reviewed threshold",
        ratchetOptions: [{ max: 20 }],
        normalLintOptions: [[{ max: 10 }]],
      },
    });
  });
});
