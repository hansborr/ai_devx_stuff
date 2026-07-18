import { afterEach, describe, expect, it, vi } from "vitest";

// Stub the expensive ESLint sweep so the edit-time check can be exercised
// against the real committed baseline + ratchet registry without running
// ESLint. An empty item map means "linted, no findings" — distinct from a
// soft-skip, which never reaches the collector at all.
vi.mock("@musi/lint-ratchet/kernel/current-collector.js", () => ({
  collectCurrentForRatchet: vi.fn(() => Promise.resolve(new Map())),
}));

import type * as NodeFsModule from "node:fs";

import {
  discoverEditCheckTargets,
  type EditCheckTarget,
  type LintRatchetEditCheckEngine,
  runEditCheckRegressions,
} from "@musi/lint-ratchet/governance/edit-check.js";
import type * as BaselineValidationModule from "@musi/lint-ratchet/kernel/baseline-validation.js";
import { collectCurrentForRatchet } from "@musi/lint-ratchet/kernel/current-collector.js";

import { musiLintRatchetBinding, musiLintRatchetContext } from "./engine-binding.js";
import { lintRatchets } from "./lint-ratchet-config.js";
import { baselinePath } from "./paths.js";

// The Musi edit-check engine: these suites exercise the operation against the
// real committed baseline + ratchet registry, so the engine binds the adapter's
// resolved context, the live registry, and the plugin allowlist.
const editCheckEngine: LintRatchetEditCheckEngine = {
  repoRoot: musiLintRatchetContext.repoRoot,
  baselinePath: musiLintRatchetContext.baselinePath,
  registry: lintRatchets,
  binding: musiLintRatchetBinding,
};

// A minimal-TS (cache-using) ratchet that is present in the committed baseline,
// so a hand-built target with the matching ruleId passes the drift guard.
const MINIMAL_TS_TEST_ID = "ratchet/vitest-expect-expect-script-tests";
const MINIMAL_TS_RULE_ID = "vitest/expect-expect";
const MINIMAL_TS_FILE = "scripts/code-intel/cli-options.test.ts";

// A type-aware ratchet, intentionally excluded from the edit-time hot path.
const TYPE_AWARE_TEST_ID = "ratchet/strict-boolean-expressions-shared";
const TYPE_AWARE_RULE_ID = "@typescript-eslint/strict-boolean-expressions";
const SHARED_SOURCE_FILE = "packages/shared/src/foo.ts";
const SERVER_TEST_HELPER_FILE = "packages/server/src/services/level-up/level-up-test-helper.ts";
const SHARED_MINIMAL_TS_TEST_IDS = [
  "ratchet/local-no-commented-out-code",
  "ratchet/local-no-swallowed-errors-broader-semantics",
  "ratchet/local-type-assertion-boundary",
  "ratchet/max-depth-production",
  "ratchet/max-lines-per-function-production",
] as const;

describe("discoverEditCheckTargets", () => {
  it("includes the minimal-TS ratchets for a shared source file and excludes the type-aware floor", () => {
    // packages/shared/src matches the code-wide local rules, local
    // type-assertion and structural function ratchets (minimal-ts), plus the
    // type-aware strict-boolean floor. Only the cache-using ratchets survive
    // the usesEslintCache gate.
    const targets = discoverEditCheckTargets(editCheckEngine, [SHARED_SOURCE_FILE]);
    expect(targets.map((target) => target.testId)).toStrictEqual(SHARED_MINIMAL_TS_TEST_IDS);
    expect(targets.some((target) => target.testId === TYPE_AWARE_TEST_ID)).toBe(false);
  });

  it("maps a script test file to its minimal-TS ratchets sorted by ratchet id with cache identities", () => {
    const targets = discoverEditCheckTargets(editCheckEngine, [MINIMAL_TS_FILE]);
    expect(
      targets.map((target) => ({
        path: target.path,
        testId: target.testId,
        ruleId: target.ruleId,
      })),
    ).toStrictEqual([
      {
        path: MINIMAL_TS_FILE,
        testId: "ratchet/local-no-commented-out-code",
        ruleId: "local/no-commented-out-code",
      },
      {
        path: MINIMAL_TS_FILE,
        testId: "ratchet/local-no-swallowed-errors-broader-semantics",
        ruleId: "local/no-swallowed-errors",
      },
      {
        path: MINIMAL_TS_FILE,
        testId: "ratchet/local-type-assertion-boundary",
        ruleId: "local/type-assertion-boundary",
      },
      {
        path: MINIMAL_TS_FILE,
        testId: "ratchet/vitest-expect-expect-script-tests",
        ruleId: "vitest/expect-expect",
      },
      {
        path: MINIMAL_TS_FILE,
        testId: "ratchet/vitest-valid-expect-script-tests",
        ruleId: "vitest/valid-expect",
      },
    ]);
    // Every discovered target carries a sha256-prefixed cache identity derived
    // from the live config + baseline + rule-source hash.
    for (const target of targets) {
      expect(target.cacheIdentity).toMatch(/^sha256:[0-9a-f]+$/u);
    }
  });

  it("orders targets by path first regardless of input order", () => {
    const targets = discoverEditCheckTargets(editCheckEngine, [
      "packages/shared/src/zzz.ts",
      "packages/shared/src/aaa.ts",
    ]);
    // byPathThenTestId sorts ascending on path: aaa before zzz even though the
    // input listed zzz first.
    expect(targets.map((target) => [target.path, target.testId])).toStrictEqual(
      ["packages/shared/src/aaa.ts", "packages/shared/src/zzz.ts"].flatMap((path) =>
        SHARED_MINIMAL_TS_TEST_IDS.map((testId) => [path, testId]),
      ),
    );
  });

  it("deduplicates a repeated path so each (path, ratchet) pair appears once", () => {
    const once = discoverEditCheckTargets(editCheckEngine, ["packages/shared/src/aaa.ts"]);
    const twice = discoverEditCheckTargets(editCheckEngine, [
      "packages/shared/src/aaa.ts",
      "packages/shared/src/aaa.ts",
    ]);
    expect(once).toStrictEqual(twice);
  });

  it("returns no targets for a path no ratchet glob matches", () => {
    expect(discoverEditCheckTargets(editCheckEngine, ["README.md"])).toStrictEqual([]);
  });

  it("keeps examples and script fixtures outside the code-wide ratchets", () => {
    expect(
      discoverEditCheckTargets(editCheckEngine, [
        "examples/lint-ratchet-demo/scripts/lint-ratchet.ts",
        "scripts/fixtures/example.ts",
      ]),
    ).toStrictEqual([]);
  });

  it("keeps hyphenated package test helpers out of production structural ratchets", () => {
    const targets = discoverEditCheckTargets(editCheckEngine, [SERVER_TEST_HELPER_FILE]);
    expect(targets.map((target) => target.testId)).toStrictEqual([
      "ratchet/local-no-commented-out-code",
      "ratchet/local-no-swallowed-errors-broader-semantics",
      "ratchet/local-type-assertion-boundary",
    ]);
  });

  it("returns no targets for an empty path list", () => {
    expect(discoverEditCheckTargets(editCheckEngine, [])).toStrictEqual([]);
  });
});

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
      path: SHARED_SOURCE_FILE,
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
    vi.doUnmock("./baseline-validation.js");
    vi.resetModules();
  });

  it("soft-skips a target whose baseline test has drifted from the live registry", async () => {
    vi.resetModules();
    vi.doMock("@musi/lint-ratchet/kernel/baseline-validation.js", async (importOriginal) => {
      const actual = await importOriginal<typeof BaselineValidationModule>();
      return {
        ...actual,
        // Report drift for any (testId, test) pair so the guard fires.
        validateBaselineTestForRatchet: vi.fn(() => ["configHash is stale"]),
      };
    });
    const editCheck = await import("@musi/lint-ratchet/governance/edit-check.js");
    const collector = await import("@musi/lint-ratchet/kernel/current-collector.js");
    const validation = await import("@musi/lint-ratchet/kernel/baseline-validation.js");

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
    vi.doMock("@musi/lint-ratchet/kernel/baseline-validation.js", async (importOriginal) => {
      const actual = await importOriginal<typeof BaselineValidationModule>();
      return {
        ...actual,
        // No drift -> the guard's `.length > 0` is false, so the target is
        // linted. This is the control that pins the guard's direction.
        validateBaselineTestForRatchet: vi.fn(() => []),
      };
    });
    const editCheck = await import("@musi/lint-ratchet/governance/edit-check.js");
    const collector = await import("@musi/lint-ratchet/kernel/current-collector.js");

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
        // Only the ratchet baseline is intercepted: existsSync(baselinePath)
        // === false -> the missing-baseline early return fires before the
        // baseline is ever read. Every other path (e.g. the config-surface
        // manifest loaded while the fresh module graph re-evaluates
        // shared-policy) must keep hitting the real filesystem.
        existsSync: vi.fn((...args: Parameters<typeof actual.existsSync>) =>
          args[0] === baselinePath ? false : actual.existsSync(...args),
        ),
        readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) =>
          args[0] === baselinePath ? readBaseline() : actual.readFileSync(...args),
        ),
      };
    });
    const editCheck = await import("@musi/lint-ratchet/governance/edit-check.js");
    const collector = await import("@musi/lint-ratchet/kernel/current-collector.js");

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
        // module-load reads (e.g. the config-surface manifest) stay real.
        readFileSync: vi.fn((...args: Parameters<typeof actual.readFileSync>) =>
          args[0] === baselinePath ? '{"version":1}\n' : actual.readFileSync(...args),
        ),
      };
    });
    const editCheck = await import("@musi/lint-ratchet/governance/edit-check.js");
    const collector = await import("@musi/lint-ratchet/kernel/current-collector.js");

    const result = await editCheck.runEditCheckRegressions(editCheckEngine, [liveTarget], 1);
    // structural.baseline === undefined -> soft skip: no false regression and
    // the collector never runs against a baseline that failed to parse.
    expect(result).toStrictEqual({ regressions: [], checked: [] });
    expect(collector.collectCurrentForRatchet).not.toHaveBeenCalled();
  });
});
