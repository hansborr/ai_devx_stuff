import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runBlobSizeCli } from "./sensor-blob-size.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

function makeRepo(): string {
  return tmpRepo.makeTmpGitRepo("sensor-blob-size-");
}

function git(root: string, args: readonly string[]): void {
  execFileSync("git", [...args], { cwd: root });
}

function writeSizedFile(root: string, relativePath: string, size: number): void {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, Buffer.alloc(size, "x"));
}

function stage(root: string, relativePath: string): void {
  git(root, ["add", "--", relativePath]);
}

describe("runBlobSizeCli", () => {
  it("returns OK when staged files stay under the warning threshold", () => {
    const root = makeRepo();
    writeSizedFile(root, "src/small.txt", 9);
    stage(root, "src/small.txt");

    const result = runBlobSizeCli({
      argv: ["--threshold-warn=10", "--threshold-block=20"],
      cwd: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.stdout).toContain("OK: no staged blob-size findings");
  });

  it("reports staged files over the warning threshold without failing in check mode", () => {
    const root = makeRepo();
    writeSizedFile(root, "assets/large.bin", 11);
    stage(root, "assets/large.bin");

    const result = runBlobSizeCli({
      argv: ["--threshold-warn=10", "--threshold-block=20"],
      cwd: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([
      {
        severity: "warn",
        file: "assets/large.bin",
        sizeBytes: 11,
        thresholdBytes: 10,
      },
    ]);
    expect(result.stdout).toContain(
      "WARN: assets/large.bin: staged blob is 11 bytes; exceeds warn threshold 10 bytes",
    );
  });

  it("returns zero in block mode when staged size findings are warning-only", () => {
    const root = makeRepo();
    writeSizedFile(root, "assets/large.bin", 11);
    stage(root, "assets/large.bin");

    const result = runBlobSizeCli({
      argv: ["--block", "--threshold-warn=10", "--threshold-block=20"],
      cwd: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([
      {
        severity: "warn",
        file: "assets/large.bin",
        sizeBytes: 11,
        thresholdBytes: 10,
      },
    ]);
  });

  it("returns non-zero in block mode when a staged size finding is block severity", () => {
    const root = makeRepo();
    writeSizedFile(root, "assets/huge.bin", 21);
    stage(root, "assets/huge.bin");

    const result = runBlobSizeCli({
      argv: ["--block", "--threshold-warn=10", "--threshold-block=20"],
      cwd: root,
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      {
        severity: "block",
        file: "assets/huge.bin",
        sizeBytes: 21,
        thresholdBytes: 20,
      },
    ]);
  });

  it("uses the staged blob size instead of the working-tree size", () => {
    const root = makeRepo();
    writeSizedFile(root, "assets/changed-after-stage.bin", 9);
    stage(root, "assets/changed-after-stage.bin");
    writeSizedFile(root, "assets/changed-after-stage.bin", 30);

    const result = runBlobSizeCli({
      argv: ["--threshold-warn=10", "--threshold-block=20"],
      cwd: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("suppresses allowlisted staged blobs with a reason", () => {
    const root = makeRepo();
    writeSizedFile(root, "docs/reference.pdf", 30);
    writeFileSync(
      path.join(root, ".blob-size-allowlist"),
      "docs/reference.pdf # fixture reference intentionally committed\n",
    );
    stage(root, "docs/reference.pdf");

    const result = runBlobSizeCli({
      argv: ["--threshold-warn=10", "--threshold-block=20"],
      cwd: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("reports block-threshold files distinctly", () => {
    const root = makeRepo();
    writeSizedFile(root, "assets/huge.bin", 21);
    stage(root, "assets/huge.bin");

    const result = runBlobSizeCli({
      argv: ["--threshold-warn=10", "--threshold-block=20"],
      cwd: root,
    });

    expect(result.findings).toEqual([
      {
        severity: "block",
        file: "assets/huge.bin",
        sizeBytes: 21,
        thresholdBytes: 20,
      },
    ]);
    expect(result.stdout).toContain(
      "BLOCK: assets/huge.bin: staged blob is 21 bytes; exceeds block threshold 20 bytes",
    );
  });

  it("reports allowlist lines that lack a reason", () => {
    const root = makeRepo();
    writeFileSync(path.join(root, ".blob-size-allowlist"), "docs/reference.pdf\n");

    const result = runBlobSizeCli({ argv: [], cwd: root });

    expect(result.findings).toEqual([
      {
        severity: "warn",
        file: ".blob-size-allowlist:1",
        message: "allowlist entry must be '<relative-path> # reason'",
      },
    ]);
    expect(result.stdout).toContain(
      "WARN: .blob-size-allowlist:1: allowlist entry must be '<relative-path> # reason'",
    );
  });
});
