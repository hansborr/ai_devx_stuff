import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseCheckModeArgs,
  readCurrentOutput,
  runDocGenerator,
  runDocGeneratorAsync,
} from "./doc-generator.js";

describe("parseCheckModeArgs", () => {
  it("detects --check", () => {
    expect(parseCheckModeArgs(["--check"])).toEqual({ checkMode: true });
  });

  it("ignores the bare -- separator and treats absence of --check as write mode", () => {
    expect(parseCheckModeArgs(["--"])).toEqual({ checkMode: false });
    expect(parseCheckModeArgs([])).toEqual({ checkMode: false });
  });

  it("throws on any unknown argument", () => {
    expect(() => parseCheckModeArgs(["--check", "--force"])).toThrow(
      "Unknown argument(s): --force",
    );
  });
});

describe("readCurrentOutput", () => {
  it("returns the file contents when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "doc-generator-"));
    const file = join(dir, "out.md");
    writeFileSync(file, "hello\n");
    try {
      expect(readCurrentOutput(file)).toBe("hello\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty string for a missing file", () => {
    expect(readCurrentOutput(join(tmpdir(), "doc-generator-does-not-exist.md"))).toBe("");
  });
});

describe("runDocGenerator / runDocGeneratorAsync", () => {
  let dir: string;
  let outputPath: string;
  let originalArgv: string[];
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "doc-generator-"));
    outputPath = join(dir, "out.md");
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function setArgv(args: readonly string[]): void {
    process.argv = ["bun", "generator.ts", ...args];
  }

  it("writes the rendered output and logs Wrote with the suffix in write mode", () => {
    setArgv([]);
    runDocGenerator({
      outputPath,
      refreshCommand: "docs:thing",
      render: () => ({ rendered: "rendered\n", wroteSuffix: " (1 item)" }),
    });

    expect(readFileSync(outputPath, "utf8")).toBe("rendered\n");
    expect(console.log).toHaveBeenCalledWith(`Wrote ${outputPath} (1 item).`);
    expect(process.exitCode).toBeUndefined();
  });

  it("logs Wrote with no suffix when wroteSuffix is omitted", () => {
    setArgv([]);
    runDocGenerator({
      outputPath,
      refreshCommand: "docs:thing",
      render: () => ({ rendered: "x\n" }),
    });

    expect(console.log).toHaveBeenCalledWith(`Wrote ${outputPath}.`);
  });

  it("sets exitCode 1 and emits the refresh message on a check-mode mismatch", () => {
    writeFileSync(outputPath, "stale\n");
    setArgv(["--check"]);
    runDocGenerator({
      outputPath,
      refreshCommand: "verify:steps",
      render: () => ({ rendered: "fresh\n" }),
    });

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      `${outputPath} is out of date. Run \`bun run verify:steps\` and commit the result.`,
    );
    // Check mode must never write.
    expect(readFileSync(outputPath, "utf8")).toBe("stale\n");
  });

  it("reports up to date and leaves exitCode unset when check-mode matches", () => {
    writeFileSync(outputPath, "match\n");
    setArgv(["--check"]);
    runDocGenerator({
      outputPath,
      refreshCommand: "docs:thing",
      render: () => ({ rendered: "match\n" }),
    });

    expect(process.exitCode).toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(`${outputPath} is up to date.`);
  });

  it("short-circuits without writing or erroring when render returns undefined", () => {
    setArgv([]);
    runDocGenerator({
      outputPath,
      refreshCommand: "docs:thing",
      render: () => undefined,
    });

    expect(() => readFileSync(outputPath, "utf8")).toThrow();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("supports an awaited render via runDocGeneratorAsync", async () => {
    setArgv([]);
    await runDocGeneratorAsync({
      outputPath,
      refreshCommand: "docs:thing",
      render: () => Promise.resolve({ rendered: "async\n", wroteSuffix: " (2 things)" }),
    });

    expect(readFileSync(outputPath, "utf8")).toBe("async\n");
    expect(console.log).toHaveBeenCalledWith(`Wrote ${outputPath} (2 things).`);
  });
});
