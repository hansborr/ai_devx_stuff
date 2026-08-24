import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Stub the expensive ESLint sweep so the edit-time check can be exercised
// against a generated fixture baseline + synthetic registry without running
// ESLint. An empty item map means "linted, no findings" — distinct from a
// soft-skip, which never reaches the collector at all.
vi.mock("../kernel/current-collector.js", () => ({
  collectCurrentForRatchet: vi.fn(() => Promise.resolve(new Map())),
}));

import type * as NodeFsModule from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fixtureWorkflowVocabulary } from "../../test/fixture-workflow-vocabulary.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetCurrentById,
} from "../kernel/baseline.js";
import type * as BaselineValidationModule from "../kernel/baseline-validation.js";
import type { LintRatchetConfig } from "../kernel/config-types.js";
import { collectCurrentForRatchet } from "../kernel/current-collector.js";
import {
  DEFAULT_BASELINE_FILENAME,
  type LintRatchetEngineBinding,
} from "../kernel/engine-context.js";
import { buildRuleSourceHashesById } from "../kernel/rule-source.js";
import {
  type EditCheckTarget,
  type LintRatchetEditCheckEngine,
  runEditCheckRegressions,
} from "./edit-check.js";

// A synthetic registry: one cache-using (minimal-TS) core ratchet the target
// pairs with, and one type-aware ratchet intentionally excluded from the
// edit-time hot path.
const MINIMAL_TS_TEST_ID = "ratchet/fixture-no-debugger";
const MINIMAL_TS_RULE_ID = "no-debugger";
const MINIMAL_TS_FILE = "src/example.ts";
const TYPE_AWARE_TEST_ID = "ratchet/fixture-type-aware";
const TYPE_AWARE_RULE_ID = "complexity";

const minimalRatchet: LintRatchetConfig = {
  id: MINIMAL_TS_TEST_ID,
  ruleId: MINIMAL_TS_RULE_ID,
  files: ["src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  mode: "no-new",
  metric: "message-count",
  principle: "Fixture edit-check minimal-TS ratchet principle.",
};

const typeAwareRatchet: LintRatchetConfig = {
  id: TYPE_AWARE_TEST_ID,
  ruleId: TYPE_AWARE_RULE_ID,
  files: ["src/**/*.ts"],
  ignores: [],
  ruleOptions: [{ max: 10 }],
  source: { kind: "core" },
  parserProfile: "type-aware-ts",
  mode: "no-new",
  metric: "message-count",
  principle: "Fixture edit-check type-aware ratchet principle.",
};

const registry: readonly LintRatchetConfig[] = [minimalRatchet, typeAwareRatchet];

// A suite-lifetime fixture repo: rule-source hashing reads toolchain package
// versions from node_modules under the binding root, so the installed store is
// borrowed exactly as the non-Musi acceptance test does. The baseline is
// GENERATED from the synthetic registry with real rule-source hashes, so the
// drift guard's validateBaselineTestForRatchet passes on the live pair (the
// no-drift control) without any Musi baseline.
const realRepoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const fixtureRepoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-edit-check-"));
// "junction" is ignored on POSIX and avoids the Windows Developer-Mode privilege
// a "dir" symlink needs; junction targets must be absolute, and realRepoRoot is.
symlinkSync(join(realRepoRoot, "node_modules"), join(fixtureRepoRoot, "node_modules"), "junction");
mkdirSync(join(fixtureRepoRoot, "src"), { recursive: true });
afterAll(() => {
  rmSync(fixtureRepoRoot, { recursive: true, force: true });
});

const binding: LintRatchetEngineBinding = {
  repoRoot: fixtureRepoRoot,
  thirdPartyPluginAllowlist: [],
};
const ruleSourceHashesById = buildRuleSourceHashesById(registry, binding);
const emptyCurrent: LintRatchetCurrentById = new Map(
  registry.map((ratchet) => [ratchet.id, new Map()]),
);
const baselinePath = join(fixtureRepoRoot, DEFAULT_BASELINE_FILENAME);
writeFileSync(
  baselinePath,
  formatLintRatchetBaseline(
    buildLintRatchetBaseline(registry, emptyCurrent, ruleSourceHashesById, {
      workflowVocabulary: fixtureWorkflowVocabulary,
    }),
    fixtureWorkflowVocabulary,
  ),
);

const editCheckEngine: LintRatchetEditCheckEngine = {
  repoRoot: fixtureRepoRoot,
  baselinePath,
  registry,
  binding,
  workflowVocabulary: fixtureWorkflowVocabulary,
};

describe("runEditCheckRegressions soft-skip guards", () => {
  it("returns an empty result without touching the collector when there are no targets", async () => {
    const result = await runEditCheckRegressions(editCheckEngine, [], 1);
    expect(result).toStrictEqual({ regressions: [], checked: [] });
    expect(collectCurrentForRatchet).not.toHaveBeenCalled();
  });

  it("lints a target whose wire ruleId matches the registry ratchet (collector runs, file checked)", async () => {
    const target: EditCheckTarget = {
      path: MINIMAL_TS_FILE,
      testId: MINIMAL_TS_TEST_ID,
      ruleId: MINIMAL_TS_RULE_ID,
    };
    const result = await runEditCheckRegressions(editCheckEngine, [target], 1);
    // An empty mocked collector means the file was genuinely linted with no
    // findings: it appears in `checked` (not a soft skip) with no regressions.
    expect(result).toStrictEqual({ regressions: [], checked: [MINIMAL_TS_FILE] });
    expect(collectCurrentForRatchet).toHaveBeenCalledTimes(1);
  });

  it("soft-skips a target whose ruleId mismatches the registry ratchet rather than linting it", async () => {
    const target: EditCheckTarget = {
      path: MINIMAL_TS_FILE,
      testId: MINIMAL_TS_TEST_ID,
      ruleId: "wrong/rule-id",
    };
    const result = await runEditCheckRegressions(editCheckEngine, [target], 1);
    // The ruleId-mismatch guard (`target.ruleId !== ratchet.ruleId`) drops the
    // pair: no false regression, and the file is NOT reported as checked.
    expect(result).toStrictEqual({ regressions: [], checked: [] });
    expect(collectCurrentForRatchet).not.toHaveBeenCalled();
  });

  it("soft-skips a target whose testId has no registry ratchet", async () => {
    const target: EditCheckTarget = {
      path: MINIMAL_TS_FILE,
      testId: "ratchet/does-not-exist",
      ruleId: MINIMAL_TS_RULE_ID,
    };
    const result = await runEditCheckRegressions(editCheckEngine, [target], 1);
    expect(result).toStrictEqual({ regressions: [], checked: [] });
    expect(collectCurrentForRatchet).not.toHaveBeenCalled();
  });

  it("soft-skips a type-aware ratchet target so the hot path never rebuilds a TS program", async () => {
    const target: EditCheckTarget = {
      path: MINIMAL_TS_FILE,
      testId: TYPE_AWARE_TEST_ID,
      ruleId: TYPE_AWARE_RULE_ID,
    };
    const result = await runEditCheckRegressions(editCheckEngine, [target], 1);
    // groupTargets drops any ratchet for which usesEslintCache is false.
    expect(result).toStrictEqual({ regressions: [], checked: [] });
    expect(collectCurrentForRatchet).not.toHaveBeenCalled();
  });
});

describe("runEditCheckRegressions drift guard", () => {
  afterEach(() => {
    vi.doUnmock("../kernel/baseline-validation.js");
    vi.resetModules();
  });

  it("soft-skips a target whose baseline test has drifted from the live registry", async () => {
    vi.resetModules();
    vi.doMock("../kernel/baseline-validation.js", async (importOriginal) => {
      const actual = await importOriginal<typeof BaselineValidationModule>();
      return {
        ...actual,
        // Report drift for any (testId, test) pair so the guard fires.
        validateBaselineTestForRatchet: vi.fn(() => ["configHash is stale"]),
      };
    });
    const editCheck = await import("./edit-check.js");
    const collector = await import("../kernel/current-collector.js");
    const validation = await import("../kernel/baseline-validation.js");

    const target: EditCheckTarget = {
      path: MINIMAL_TS_FILE,
      testId: MINIMAL_TS_TEST_ID,
      ruleId: MINIMAL_TS_RULE_ID,
    };
    const result = await editCheck.runEditCheckRegressions(editCheckEngine, [target], 1);
    // A drifted baseline (validation returns failures) is soft-skipped rather
    // than linted against a stale floor: no regression, nothing checked.
    expect(result).toStrictEqual({ regressions: [], checked: [] });
    expect(validation.validateBaselineTestForRatchet).toHaveBeenCalled();
    expect(collector.collectCurrentForRatchet).not.toHaveBeenCalled();
  });

  it("lints a target when its baseline test reports no drift", async () => {
    vi.resetModules();
    vi.doMock("../kernel/baseline-validation.js", async (importOriginal) => {
      const actual = await importOriginal<typeof BaselineValidationModule>();
      return {
        ...actual,
        // No drift -> the guard's `.length > 0` is false, so the target is
        // linted. This is the control that pins the guard's direction.
        validateBaselineTestForRatchet: vi.fn(() => []),
      };
    });
    const editCheck = await import("./edit-check.js");
    const collector = await import("../kernel/current-collector.js");

    const target: EditCheckTarget = {
      path: MINIMAL_TS_FILE,
      testId: MINIMAL_TS_TEST_ID,
      ruleId: MINIMAL_TS_RULE_ID,
    };
    const result = await editCheck.runEditCheckRegressions(editCheckEngine, [target], 1);
    expect(result).toStrictEqual({ regressions: [], checked: [MINIMAL_TS_FILE] });
    expect(collector.collectCurrentForRatchet).toHaveBeenCalledTimes(1);
  });
});

describe("runEditCheckRegressions baseline-availability guards", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  // A live target that WOULD be linted if the baseline were present and valid,
  // so the soft-skip result is attributable to the baseline guard and not to a
  // mismatched/excluded target.
  const liveTarget: EditCheckTarget = {
    path: MINIMAL_TS_FILE,
    testId: MINIMAL_TS_TEST_ID,
    ruleId: MINIMAL_TS_RULE_ID,
  };

  it("soft-skips without reading or linting when the baseline file is absent", async () => {
    vi.resetModules();
    const readBaseline = vi.fn(() => "");
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof NodeFsModule>();
      return {
        ...actual,
        // Only the fixture baseline is intercepted: existsSync(baselinePath)
        // === false -> the missing-baseline early return fires before the
        // baseline is ever read. Every other path (e.g. toolchain package
        // versions read while the fresh module graph re-evaluates) must keep
        // hitting the real filesystem.
        existsSync: vi.fn((...args: Parameters<typeof actual.existsSync>) =>
          args[0] === baselinePath ? false : actual.existsSync(...args),
        ),
        readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) =>
          args[0] === baselinePath ? readBaseline() : actual.readFileSync(...args),
        ),
      };
    });
    const editCheck = await import("./edit-check.js");
    const collector = await import("../kernel/current-collector.js");

    const result = await editCheck.runEditCheckRegressions(editCheckEngine, [liveTarget], 1);
    // Absent baseline -> soft skip: empty regressions, nothing checked, and the
    // baseline is never even read (the guard short-circuits the file read).
    expect(result).toStrictEqual({ regressions: [], checked: [] });
    expect(readBaseline).not.toHaveBeenCalled();
    expect(collector.collectCurrentForRatchet).not.toHaveBeenCalled();
  });

  it("soft-skips a present-but-structurally-invalid baseline rather than linting against it", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof NodeFsModule>();
      return {
        ...actual,
        existsSync: vi.fn((...args: Parameters<typeof actual.existsSync>) =>
          args[0] === baselinePath ? true : actual.existsSync(...args),
        ),
        // A JSON object missing the `tests` map parses but yields
        // structural.baseline === undefined, driving the invalid-baseline
        // guard. Only the baseline path is intercepted, so unrelated
        // module-load reads stay real.
        readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) =>
          args[0] === baselinePath ? '{"version":1}\n' : actual.readFileSync(...args),
        ),
      };
    });
    const editCheck = await import("./edit-check.js");
    const collector = await import("../kernel/current-collector.js");

    const result = await editCheck.runEditCheckRegressions(editCheckEngine, [liveTarget], 1);
    // structural.baseline === undefined -> soft skip: no false regression and
    // the collector never runs against a baseline that failed to parse.
    expect(result).toStrictEqual({ regressions: [], checked: [] });
    expect(collector.collectCurrentForRatchet).not.toHaveBeenCalled();
  });
});
