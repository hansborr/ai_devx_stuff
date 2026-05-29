import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyLintRatchetUpdate,
  type RunUpdateDeps,
} from "./lint-ratchet/baseline-update-apply.js";
import type { LintRatchetDebtLogEntry } from "./lint-ratchet/debt-log-schema.js";
import { parseLintRatchetDebtLogEntry } from "./lint-ratchet/debt-log-schema.js";
import {
  appendValidatedDebtLogEntry,
  buildLintRatchetDebtLogEntry,
} from "./lint-ratchet/debt-log-write.js";
import { WorseBaselineError } from "./lint-ratchet/errors.js";
import { baselinePath, debtLogPath } from "./lint-ratchet/paths.js";
import {
  buildLintRatchetBaseline,
  decideLintRatchetUpdate,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetCurrentById,
  parseLintRatchetBaselineStructure,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { ConfigError } from "./lint-ratchet-metrics.js";

const PATH = "packages/server/src/legacy.ts";

const ratchet: LintRatchetConfig = {
  id: "ratchet/local-debt-fixture",
  ruleId: "no-debugger",
  files: ["packages/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
};

const ruleSourceHashes = new Map([[ratchet.id, `sha256:${"a".repeat(64)}`]]);

function baselineWith(counts: Record<string, number>): LintRatchetBaseline {
  const items = new Map(Object.entries(counts).map(([path, count]) => [path, { count }]));
  const currentById: LintRatchetCurrentById = new Map([[ratchet.id, items]]);
  return buildLintRatchetBaseline([ratchet], currentById, ruleSourceHashes);
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
    writeFileSync: (path, data) => {
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
});

describe("applyLintRatchetUpdate", () => {
  it("appends the debt log BEFORE writing the baseline for an accepted worse update", () => {
    const generated = baselineWith({ [PATH]: 2 });
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    const logged = applyLintRatchetUpdate({
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
    expect(parsed.entry?.acceptanceReason).toBe("intentional debt: legacy module rewrite pending");
    expect(errorLines.join("\n")).toContain("lint-ratchet.debt-log.jsonl");
  });

  it("logs nothing on a true no-op re-run", () => {
    const generated = baselineWith({ [PATH]: 1 });
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(rendered);

    const logged = applyLintRatchetUpdate({
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
      generated,
      rendered,
      registry: [ratchet],
      options: { allowWorse: true, reason: "intentional debt for the legacy module" },
      currentFindingCount: 2,
      deps: retry.deps,
    });

    expect(logged).toBe(true);
    expect(retry.calls).toEqual(["write:baseline"]);
    expect(retry.appended).toEqual([]);
    expect(retry.written).toEqual([rendered]);
  });

  it("blocks a worse update without --allow-worse and records nothing", () => {
    const generated = baselineWith({ [PATH]: 2 });
    const committedText = formatLintRatchetBaseline(baselineWith({ [PATH]: 1 }));
    const rendered = formatLintRatchetBaseline(generated);
    const rec = recorder(committedText);

    expect(() =>
      applyLintRatchetUpdate({
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
});
