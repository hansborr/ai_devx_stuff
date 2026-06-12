import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { loadLintRuleDocs } from "../lib/lint-rule-docs.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  type LintRatchetCurrentById,
  type LintRatchetRuleSourceHashesById,
} from "./lint-ratchet-baseline.js";
import {
  checkLintRatchetRegistry,
  type RegistryCheckFailure,
  type RegistryCheckFailureKind,
} from "./lint-ratchet-check-registry.js";
import {
  type LintRatchetConfig,
  lintRatchets,
  lintRatchetThirdPartyPluginAllowlist,
} from "./lint-ratchet-config.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_HASH = `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"a".repeat(64)}`;
const tempRoots: string[] = [];

const matchingRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-message",
  ruleId: "no-alert",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/app/src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
};

const emptyRatchet: LintRatchetConfig = {
  ...matchingRatchet,
  id: "ratchet/fixture-empty",
  files: ["packages/app/src/missing/**/*.ts"],
};

const absolutePathRatchet: LintRatchetConfig = {
  ...matchingRatchet,
  id: "ratchet/fixture-absolute",
  files: ["/abs/path"],
};

const orphanRatchet: LintRatchetConfig = {
  ...matchingRatchet,
  id: "ratchet/fixture-orphan",
};

const ruleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [orphanRatchet.id, FIXTURE_HASH],
]);

function trackedFilesFromGit(): readonly string[] {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

async function localRuleIds(): Promise<ReadonlySet<string>> {
  const { entries, failures } = await loadLintRuleDocs(repoRoot);
  expect(failures).toEqual([]);
  return new Set(entries.map((entry) => entry.id));
}

function currentById(): LintRatchetCurrentById {
  return new Map([[orphanRatchet.id, new Map()]]);
}

function orphanBaselineText(): string {
  return formatLintRatchetBaseline(
    buildLintRatchetBaseline([orphanRatchet], currentById(), ruleSourceHashes),
  );
}

function writeBaselineFixture(text: string): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-check-registry-"));
  tempRoots.push(tempRoot);
  const baselinePath = join(tempRoot, "lint-ratchet.baseline.json");
  writeFileSync(baselinePath, text);
  return baselinePath;
}

function failureOfKind(
  failures: readonly RegistryCheckFailure[],
  kind: RegistryCheckFailureKind,
): RegistryCheckFailure {
  const failure = failures.find((entry) => entry.kind === kind);
  expect(failure).toBeDefined();
  if (failure === undefined) throw new Error(`missing ${kind} failure`);
  return failure;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot !== undefined) rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("lint ratchet check-registry", () => {
  it("accepts the Musi registry fixture", { timeout: 15_000 }, async () => {
    const result = checkLintRatchetRegistry({
      ratchets: structuredClone(lintRatchets),
      localRuleIds: await localRuleIds(),
      thirdPartyPlugins: lintRatchetThirdPartyPluginAllowlist,
      trackedFiles: trackedFilesFromGit(),
    });

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("detects ratchet globs that match no tracked files", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [emptyRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    const failure = failureOfKind(result.failures, "empty-glob");
    expect(failure.message).toContain(emptyRatchet.id);
  });

  it("detects absolute file and ignore paths", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [absolutePathRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    const failure = failureOfKind(result.failures, "absolute-path");
    expect(failure.message).toContain("/abs/path");
  });

  it("detects Windows-style absolute paths with forward slashes", () => {
    const windowsAbsolutePath = "C:/Users/dev/project/**/*.ts";
    const result = checkLintRatchetRegistry({
      ratchets: [
        {
          ...matchingRatchet,
          id: "ratchet/fixture-windows-absolute",
          files: [windowsAbsolutePath],
        },
      ],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    const failure = failureOfKind(result.failures, "absolute-path");
    expect(failure.message).toContain(windowsAbsolutePath);
  });

  it("detects baseline ids with no matching registry entry", () => {
    const baselinePath = writeBaselineFixture(orphanBaselineText());
    const result = checkLintRatchetRegistry({
      ratchets: [matchingRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
      baselineText: readFileSync(baselinePath, "utf8"),
      baselineLabel: baselinePath,
    });

    const failure = failureOfKind(result.failures, "orphan-baseline");
    expect(failure.message).toContain(orphanRatchet.id);
  });

  it("validates zero-baseline lifecycle metadata shape", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [
        {
          ...matchingRatchet,
          zeroBaselineDisposition: {
            kind: "temporary-ratchet-only",
            reason: "",
          },
        },
      ],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    const failureMessages = result.failures
      .filter((failure) => failure.kind === "registry-shape")
      .map((failure) => failure.message);
    expect(failureMessages.some((message) => message.includes("reason must be non-empty"))).toBe(
      true,
    );
    expect(failureMessages.some((message) => message.includes("exitPath is required"))).toBe(true);
  });

  it("returns byte-identical failure ordering for identical input", () => {
    const baselineText = orphanBaselineText();
    const options = {
      ratchets: [absolutePathRatchet],
      trackedFiles: [],
      baselineText,
    };

    expect(JSON.stringify(checkLintRatchetRegistry(options).failures)).toBe(
      JSON.stringify(checkLintRatchetRegistry(options).failures),
    );
  });

  it("skips orphan-baseline checks when no baseline is present", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [matchingRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    expect(result.failures.some((failure) => failure.kind === "orphan-baseline")).toBe(false);
  });

  it("detects ratchets missing from the harness manifest", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [matchingRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
      harnessManifestRatchetIds: new Set(),
    });

    const failure = failureOfKind(result.failures, "missing-harness-ratchet");
    expect(failure.message).toContain(matchingRatchet.id);
    expect(failure.message).toContain("Next steps:");
    expect(failure.message).toContain("harness.controls.json");
    expect(failure.message).toContain("docs:harness-controls");
    expect(failure.message).toContain("scripts/tests/test-harness-check.sh");
  });
});
