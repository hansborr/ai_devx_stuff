import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ExecutableOperations from "./executable-operations.js";

const postMergeLintRatchetBaseline = vi.hoisted(() => vi.fn());

vi.mock("./executable-operations.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutableOperations>();
  return { ...actual, postMergeLintRatchetBaseline };
});

import { runLintRatchetGitRailCliMain } from "./executable-cli.js";

describe("lint-ratchet git-rail CLI", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = undefined;
    postMergeLintRatchetBaseline.mockReset();
    vi.restoreAllMocks();
  });

  it("rejects a mistyped post-merge context instead of treating it as post-merge", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runLintRatchetGitRailCliMain([
      "post-merge",
      "--adapter",
      "scripts/lint-ratchet/missing-adapter.ts",
      "--",
      "post-comimt",
    ]);

    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "post-merge context must be exactly post-merge or post-commit: post-comimt",
    );
  });

  it("keeps the literal repository repair command when check cannot load its adapter", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await runLintRatchetGitRailCliMain([
      "check",
      "--adapter",
      "scripts/lint-ratchet/missing-adapter.ts",
      "--repair-command",
      "bun run lint:ratchet:install-merge-driver",
    ]);

    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(
      "WARN: lint-ratchet merge driver is missing or stale - run bun run lint:ratchet:install-merge-driver",
    );
  });

  it("keeps a post-commit context placed before --adapter when no repair command is present", async () => {
    await runLintRatchetGitRailCliMain([
      "post-merge",
      "post-commit",
      "--adapter",
      "scripts/lint-ratchet/engine-binding.ts",
    ]);

    expect(process.exitCode).toBe(0);
    expect(postMergeLintRatchetBaseline).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ baselineFile: "lint-ratchet.baseline.json" }),
      "post-commit",
      false,
    );
  });
});
