import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import { collectCurrentById } from "@musi/lint-ratchet/kernel/current-collector.js";
import type { LintRatchetEngineBinding } from "@musi/lint-ratchet/kernel/engine-context.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lintRatchets } from "./lint-ratchet-config.js";
import { repoRoot } from "./paths.js";

// Scheduler semantics (bounded concurrency, the type-aware single-flight cap,
// fail-fast rejection) are covered in-package by
// tools/lint-ratchet/src/kernel/current-collector.test.ts over a synthetic
// registry. This adapter test keeps the real-Musi binding assertion: the live
// registry's ratchet ids and globs actually route tracked files to the runner.

const eslintRunnerMock = vi.hoisted(() => ({
  runEslintForFiles: vi.fn(),
  sweepStaleCacheSiblings: vi.fn(),
}));

vi.mock("@musi/lint-ratchet/kernel/eslint-runner.js", () => eslintRunnerMock);

const FIXTURE_RULE_SOURCE_HASH = `sha256:${"b".repeat(64)}`;

const binding: LintRatchetEngineBinding = { repoRoot, thirdPartyPluginAllowlist: [] };

function fixtureRuleSourceHashes(): Map<string, string> {
  return new Map(lintRatchets.map((ratchet) => [ratchet.id, FIXTURE_RULE_SOURCE_HASH]));
}

describe("collectCurrentById over the Musi registry", () => {
  afterEach(() => {
    eslintRunnerMock.runEslintForFiles.mockReset();
    eslintRunnerMock.sweepStaleCacheSiblings.mockReset();
  });

  it("collects each ratchet from matched tracked files instead of raw globs", async () => {
    eslintRunnerMock.runEslintForFiles.mockResolvedValue([]);

    await collectCurrentById({
      ruleSourceHashesById: fixtureRuleSourceHashes(),
      ratchets: lintRatchets,
      binding,
      concurrency: 1,
      trackedFiles: [
        "packages/server/src/services/upload-service.ts",
        "packages/server/src/services/upload-service.test.ts",
      ],
    });

    const strictBooleanCall = eslintRunnerMock.runEslintForFiles.mock.calls.find((call) => {
      const ratchet = call[0] as LintRatchetConfig;
      return ratchet.id === "ratchet/strict-boolean-expressions-server-services";
    });
    expect(strictBooleanCall?.[2]).toStrictEqual([
      "packages/server/src/services/upload-service.ts",
    ]);
    expect(eslintRunnerMock.sweepStaleCacheSiblings).toHaveBeenCalled();
  });
});
