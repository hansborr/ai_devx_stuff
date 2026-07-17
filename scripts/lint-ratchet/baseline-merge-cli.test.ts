import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { LintRatchetBaseline } from "./baseline.js";
import { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import { formatLintRatchetBaseline } from "./baseline-format.js";
import { runBaselineMergeCli } from "./baseline-merge-cli.js";

const CONFIG_HASH = `sha256:${"a".repeat(64)}`;
const RULE_SOURCE_HASH = `sha256:${"b".repeat(64)}`;

function baseline(count: number, configHash = CONFIG_HASH): LintRatchetBaseline {
  return {
    version: LINT_RATCHET_BASELINE_VERSION,
    tests: {
      "ratchet/fixture-one": {
        ruleId: "local/example-rule",
        mode: "no-new",
        metric: "message-count",
        files: ["packages/**/*.ts"],
        ignores: [],
        ruleOptions: [],
        configHash,
        ruleSourceHash: RULE_SOURCE_HASH,
        items: { "packages/server/src/shared.ts": { count } },
      },
    },
  };
}

async function writeBaseline(path: string, value: LintRatchetBaseline): Promise<void> {
  await writeFile(path, formatLintRatchetBaseline(value));
}

describe("lint ratchet baseline merge CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns usage exit code for invalid arguments", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runBaselineMergeCli([])).resolves.toBe(2);

    expect(error).toHaveBeenCalledWith(
      "usage: bun scripts/lint-ratchet/baseline-merge-cli.ts <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]",
    );
  });

  it("writes a successful semantic merge to the current file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baseline-merge-cli-"));
    try {
      const basePath = join(dir, "base.json");
      const currentPath = join(dir, "current.json");
      const otherPath = join(dir, "other.json");
      const markerPath = join(dir, "truth-up-required");
      await writeBaseline(basePath, baseline(5));
      await writeBaseline(currentPath, baseline(3));
      await writeBaseline(otherPath, baseline(4));

      await expect(
        runBaselineMergeCli([
          basePath,
          currentPath,
          otherPath,
          "lint-ratchet.baseline.json",
          markerPath,
        ]),
      ).resolves.toBe(0);

      await expect(readFile(currentPath, "utf8")).resolves.toBe(
        formatLintRatchetBaseline(baseline(3)),
      );
      await expect(readFile(markerPath, "utf8")).resolves.toBe(
        "lint-ratchet baseline semantic merge requires post-merge truth-up\n",
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("stamps the truth-up marker with the pre-merge head so leaked markers cannot fire on unrelated merges", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baseline-merge-cli-"));
    try {
      const basePath = join(dir, "base.json");
      const currentPath = join(dir, "current.json");
      const otherPath = join(dir, "other.json");
      const markerPath = join(dir, "truth-up-required");
      const preMergeHeadSha = "d".repeat(40);
      await writeBaseline(basePath, baseline(5));
      await writeBaseline(currentPath, baseline(3));
      await writeBaseline(otherPath, baseline(4));

      await expect(
        runBaselineMergeCli([
          basePath,
          currentPath,
          otherPath,
          "lint-ratchet.baseline.json",
          markerPath,
          preMergeHeadSha,
        ]),
      ).resolves.toBe(0);

      await expect(readFile(markerPath, "utf8")).resolves.toBe(
        "lint-ratchet baseline semantic merge requires post-merge truth-up\n" +
          `pre-merge-head=${preMergeHeadSha}\n`,
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("rejects a seventh positional argument as a usage error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      runBaselineMergeCli(["base", "current", "other", "path", "marker", "sha", "extra"]),
    ).resolves.toBe(2);

    expect(error).toHaveBeenCalledWith(
      "usage: bun scripts/lint-ratchet/baseline-merge-cli.ts <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]",
    );
  });

  it("returns 1 without rewriting the current file when semantic merge refuses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baseline-merge-cli-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const basePath = join(dir, "base.json");
      const currentPath = join(dir, "current.json");
      const otherPath = join(dir, "other.json");
      const currentText = formatLintRatchetBaseline(baseline(3));
      await writeBaseline(basePath, baseline(5));
      await writeFile(currentPath, currentText);
      await writeBaseline(otherPath, baseline(4, `sha256:${"c".repeat(64)}`));

      await expect(
        runBaselineMergeCli([basePath, currentPath, otherPath, "lint-ratchet.baseline.json"]),
      ).resolves.toBe(1);

      await expect(readFile(currentPath, "utf8")).resolves.toBe(currentText);
      expect(error).toHaveBeenCalledWith(
        "lint-ratchet baseline semantic merge could not resolve lint-ratchet.baseline.json:",
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
