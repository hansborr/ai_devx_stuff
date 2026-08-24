import type * as ChildProcess from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const writerSpies = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  return { ...actual, spawnSync: writerSpies.spawnSync };
});

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { CodemodError } from "./lib/codemod-errors.js";
import { writeOrPreviewFiles } from "./lib/codemod-writes.js";
import {
  copyDirectoryContents,
  enumerateFixtures,
  expectDirectoriesToMatch,
  expectedRoot,
  expectRunTwiceStdout,
  expectStdout,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  optionalStringArrayProperty,
  parseCaseJson,
  requiredStringArray,
  throwCapturedError,
  withCapturedStdout,
} from "./lib/fixture-runner.test-helper.js";
import type { TrpcSharedInputCodemodArgs } from "./trpc-shared-input.js";
import { runTrpcSharedInputCodemod } from "./trpc-shared-input.js";
import type { TrpcSharedOutputCodemodArgs } from "./trpc-shared-output.js";
import { runTrpcSharedOutputCodemod } from "./trpc-shared-output.js";

type CodemodKind = "trpc-shared-input" | "trpc-shared-output";

type FixtureMetadataBase = {
  args: string[];
  expectedStdout: string[];
  runTwice: boolean;
  expectedSecondStdout: string[] | undefined;
};

type FixtureMetadata =
  | (FixtureMetadataBase & {
      expectFailure: true;
      expectedError: string;
    })
  | (FixtureMetadataBase & {
      expectFailure: false;
      expectedError?: never;
    });

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixtures");
const tmpRepo = registerTempRootCleanup();

const UNSORTED_IMPORTS = `import { zeta, alpha } from "./z.js";
import { zebra, beta } from "pkg";
import path from "node:path";

export const value = alpha;
`;

const NORMALIZED_IMPORTS = `import path from "node:path";

import { beta, zebra } from "pkg";

import { alpha, zeta } from "./z.js";

export const value = alpha;
`;

beforeEach(() => {
  writerSpies.spawnSync.mockReset();
  writerSpies.spawnSync.mockReturnValue({ error: undefined, status: 0, stderr: "", stdout: "" });
});

function readMetadata(caseRoot: string): FixtureMetadata {
  const parsed = parseCaseJson(caseRoot);
  const args = requiredStringArray(parsed, "args");
  const expectFailure = optionalBoolean(parsed, "expectFailure");
  const expectedError = optionalString(parsed, "expectedError");
  const expectedStdout = optionalStringArray(parsed, "expectedStdout");
  const runTwice = optionalBoolean(parsed, "runTwice");
  const expectedSecondStdout = optionalStringArrayProperty(parsed, "expectedSecondStdout");
  if (expectFailure && runTwice) {
    throw new Error("runTwice is only valid when expectFailure is false.");
  }
  if (runTwice && expectedSecondStdout === undefined) {
    throw new Error("expectedSecondStdout must be set when runTwice is true.");
  }
  if (!runTwice && expectedSecondStdout !== undefined) {
    throw new Error("expectedSecondStdout is only valid when runTwice is true.");
  }
  if (expectFailure) {
    if (!expectedError) throw new Error("expectedError must be set when expectFailure is true.");
    return {
      args,
      expectFailure,
      expectedError,
      expectedStdout,
      runTwice,
      expectedSecondStdout,
    };
  }
  if (expectedError) throw new Error("expectedError is only valid when expectFailure is true.");
  return {
    args,
    expectFailure,
    expectedStdout,
    runTwice,
    expectedSecondStdout,
  };
}

function fixtureNames(kind: CodemodKind): string[] {
  return enumerateFixtures(path.join(fixtureRoot, kind));
}

function runInput(args: string[], root: string): void {
  const codemodArgs: TrpcSharedInputCodemodArgs = args;
  runTrpcSharedInputCodemod(codemodArgs, root);
}

function runOutput(args: string[], root: string): void {
  const codemodArgs: TrpcSharedOutputCodemodArgs = args;
  runTrpcSharedOutputCodemod(codemodArgs, root);
}

function runCodemod(kind: CodemodKind, args: string[], root: string): void {
  if (kind === "trpc-shared-input") {
    runInput(args, root);
    return;
  }
  runOutput(args, root);
}

function runFixture(kind: CodemodKind, name: string): void {
  const caseRoot = path.join(fixtureRoot, kind, name);
  const metadata = readMetadata(caseRoot);
  const workRoot = tmpRepo.makeTempRepo(`musi-${kind}-${name}-`);
  copyDirectoryContents(path.join(caseRoot, "before"), workRoot);

  const firstRun = withCapturedStdout(() => {
    runCodemod(kind, metadata.args, workRoot);
  });
  if (metadata.expectFailure) {
    expect(firstRun.error).toBeInstanceOf(CodemodError);
    if (!(firstRun.error instanceof Error)) throw new Error("Expected codemod error.");
    expect(firstRun.error.message).toContain(metadata.expectedError);
    expectDirectoriesToMatch(workRoot, expectedRoot(caseRoot));
    return;
  }

  if (firstRun.error) throwCapturedError(firstRun.error);

  if (metadata.runTwice) {
    const expectedSecondStdout = metadata.expectedSecondStdout;
    if (expectedSecondStdout === undefined) {
      throw new Error("expectedSecondStdout must be set when runTwice is true.");
    }
    const secondRun = withCapturedStdout(() => {
      runCodemod(kind, metadata.args, workRoot);
    });
    if (secondRun.error) throwCapturedError(secondRun.error);
    expectRunTwiceStdout(
      firstRun.output,
      secondRun.output,
      metadata.expectedStdout,
      expectedSecondStdout,
    );
  } else {
    expectStdout(firstRun.output, metadata.expectedStdout);
  }

  expectDirectoriesToMatch(workRoot, expectedRoot(caseRoot));
}

describe("trpc shared input codemod fixtures", () => {
  it.each(fixtureNames("trpc-shared-input"))("%s", (name) => {
    runFixture("trpc-shared-input", name);
  });
});

describe("trpc shared output codemod fixtures", () => {
  it.each(fixtureNames("trpc-shared-output"))("%s", (name) => {
    runFixture("trpc-shared-output", name);
  });
});

describe("shared codemod write orchestration", () => {
  it("reports and writes the same once-normalized bytes when ESLint is unavailable", () => {
    const root = tmpRepo.makeTempRepo("musi-codemod-write-parity-");
    const outputPath = path.join(root, "output.ts");

    const preview = withCapturedStdout(() => {
      writeOrPreviewFiles("parity", root, [{ path: outputPath, text: UNSORTED_IMPORTS }], true);
    });
    expect(preview.error).toBeUndefined();
    expect(preview.output).toBe(
      `parity codemod: dry-run would write output.ts (${String(NORMALIZED_IMPORTS.length)} bytes).`,
    );

    writeOrPreviewFiles("parity", root, [{ path: outputPath, text: UNSORTED_IMPORTS }], false);

    expect(readFileSync(outputPath, "utf8")).toBe(NORMALIZED_IMPORTS);
    expect(writerSpies.spawnSync).not.toHaveBeenCalled();
  });

  it("keeps the normalized file and warns when the ESLint post-pass fails", () => {
    const root = tmpRepo.writeRepo({ "eslint.config.js": "export default [];\n" });
    const outputPath = path.join(root, "output.ts");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    writerSpies.spawnSync.mockReturnValue({
      error: new Error("spawn bun ENOENT"),
      status: null,
      stderr: "",
      stdout: "",
    });

    writeOrPreviewFiles("parity", root, [{ path: outputPath, text: UNSORTED_IMPORTS }], false);

    expect(readFileSync(outputPath, "utf8")).toBe(NORMALIZED_IMPORTS);
    expect(warning).toHaveBeenCalledWith(
      "parity codemod: eslint import fix failed.\nspawn bun ENOENT",
    );
    warning.mockRestore();
  });

  it("restores the normalized file when ESLint edits it before failing", () => {
    const root = tmpRepo.writeRepo({ "eslint.config.js": "export default [];\n" });
    const outputPath = path.join(root, "output.ts");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    writerSpies.spawnSync.mockImplementation(() => {
      expect(readFileSync(outputPath, "utf8")).toBe(NORMALIZED_IMPORTS);
      writeFileSync(outputPath, `${NORMALIZED_IMPORTS}\n// partial eslint fix\n`);
      return { error: undefined, status: 1, stderr: "remaining lint error", stdout: "" };
    });

    writeOrPreviewFiles("parity", root, [{ path: outputPath, text: UNSORTED_IMPORTS }], false);

    expect(readFileSync(outputPath, "utf8")).toBe(NORMALIZED_IMPORTS);
    expect(warning).toHaveBeenCalledWith(
      "parity codemod: eslint import fix failed.\nremaining lint error",
    );
    warning.mockRestore();
  });

  it("allows only a successful ESLint post-pass to diverge from the normalized plan", () => {
    const root = tmpRepo.writeRepo({ "eslint.config.js": "export default [];\n" });
    const outputPath = path.join(root, "output.ts");
    const eslintFixedText = `${NORMALIZED_IMPORTS}\n// eslint post-pass\n`;
    writerSpies.spawnSync.mockImplementation(() => {
      expect(readFileSync(outputPath, "utf8")).toBe(NORMALIZED_IMPORTS);
      writeFileSync(outputPath, eslintFixedText);
      return { error: undefined, status: 0, stderr: "", stdout: "" };
    });

    writeOrPreviewFiles("parity", root, [{ path: outputPath, text: UNSORTED_IMPORTS }], false);

    expect(readFileSync(outputPath, "utf8")).toBe(eslintFixedText);
    expect(writerSpies.spawnSync).toHaveBeenCalledOnce();
  });
});
