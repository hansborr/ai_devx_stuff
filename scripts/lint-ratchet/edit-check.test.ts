import {
  discoverEditCheckTargets,
  type LintRatchetEditCheckEngine,
} from "@musi/lint-ratchet/governance/edit-check.js";
import { describe, expect, it } from "vitest";

import { musiLintRatchetBinding, musiLintRatchetContext } from "./engine-binding.js";
import { lintRatchets } from "./lint-ratchet-config.js";

// The Musi edit-check engine: this suite exercises target discovery against the
// real committed baseline + ratchet registry, so the engine binds the adapter's
// resolved context, the live registry, and the plugin allowlist. The
// runEditCheckRegressions guard behavior (soft skips, drift, baseline
// availability) is covered in-package by
// tools/lint-ratchet/src/governance/edit-check.test.ts over a synthetic
// registry and a generated fixture baseline.
const editCheckEngine: LintRatchetEditCheckEngine = {
  repoRoot: musiLintRatchetContext.repoRoot,
  baselinePath: musiLintRatchetContext.baselinePath,
  registry: lintRatchets,
  binding: musiLintRatchetBinding,
};

// A minimal-TS (cache-using) ratchet that is present in the committed baseline,
// so a hand-built target with the matching ruleId passes the drift guard.
const MINIMAL_TS_FILE = "scripts/code-intel/cli-args.test.ts";

// A type-aware ratchet, intentionally excluded from the edit-time hot path.
const TYPE_AWARE_TEST_ID = "ratchet/strict-boolean-expressions-shared";
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
