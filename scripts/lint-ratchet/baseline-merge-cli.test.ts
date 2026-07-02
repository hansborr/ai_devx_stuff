import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LINT_RATCHET_BASELINE_VERSION } from "./baseline-constants.js";
import { formatLintRatchetBaseline } from "./baseline-format.js";
import { runBaselineMergeCli } from "./baseline-merge-cli.js";
import type { LintRatchetBaseline } from "./lint-ratchet-baseline.js";

const CONFIG_HASH = `sha256:${"a".repeat(64)}`;
const RULE_SOURCE_HASH = `sha256:${"b".repeat(64)}`;

function baseline(count: number, configHash = CONFIG_HASH): LintRatchetBaseline {
  return {
    version: LINT_RATCHET_BASELINE_VERSION,
    tests: {
      "ratchet/fixture-one": {
        ruleId: "local/example-rule",
        mode: "no-new",
        target: 0,
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
      "usage: bun scripts/lint-ratchet/baseline-merge-cli.ts <base> <current> <other> [path]",
    );
  });

  it("writes a successful semantic merge to the current file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baseline-merge-cli-"));
    try {
      const basePath = join(dir, "base.json");
      const currentPath = join(dir, "current.json");
      const otherPath = join(dir, "other.json");
      await writeBaseline(basePath, baseline(5));
      await writeBaseline(currentPath, baseline(3));
      await writeBaseline(otherPath, baseline(4));

      await expect(
        runBaselineMergeCli([basePath, currentPath, otherPath, "lint-ratchet.baseline.json"]),
      ).resolves.toBe(0);

      await expect(readFile(currentPath, "utf8")).resolves.toBe(
        formatLintRatchetBaseline(baseline(3)),
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
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
