import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { runExpandBarrelCodemod } from "./expand-barrel.js";
import {
  copyDirectoryContents,
  enumerateFixtures,
  errorMessage,
  expectDirectoriesToMatch,
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

type FixtureMetadata = {
  args: string[];
  expectedError?: string;
  expectedStdout: string[];
  runTwice: boolean;
  expectedSecondStdout: string[] | undefined;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixtures", "expand-barrel");
const tmpRepo = registerTempRootCleanup();

function readMetadata(caseRoot: string): FixtureMetadata {
  const parsed = parseCaseJson(caseRoot);
  const runTwice = optionalBoolean(parsed, "runTwice");
  const expectedSecondStdout = optionalStringArrayProperty(parsed, "expectedSecondStdout");
  if (runTwice && expectedSecondStdout === undefined) {
    throw new Error("expectedSecondStdout must be set when runTwice is true.");
  }
  if (!runTwice && expectedSecondStdout !== undefined) {
    throw new Error("expectedSecondStdout is only valid when runTwice is true.");
  }
  return {
    args: requiredStringArray(parsed, "args"),
    expectedError: optionalString(parsed, "expectedError"),
    expectedStdout: optionalStringArray(parsed, "expectedStdout"),
    runTwice,
    expectedSecondStdout,
  };
}

function fixtureNames(): string[] {
  return enumerateFixtures(fixtureRoot);
}

function expectedRoot(caseRoot: string): string {
  const afterRoot = path.join(caseRoot, "after");
  return existsSync(afterRoot) ? afterRoot : path.join(caseRoot, "before");
}

function runFixture(name: string): void {
  const caseRoot = path.join(fixtureRoot, name);
  const metadata = readMetadata(caseRoot);
  const workRoot = tmpRepo.makeTempRepo(`musi-expand-barrel-${name}-`);
  copyDirectoryContents(path.join(caseRoot, "before"), workRoot);

  const firstRun = withCapturedStdout(() => {
    runExpandBarrelCodemod(metadata.args, workRoot);
  });
  if (metadata.expectedError) {
    expect(firstRun.error).toBeDefined();
    expect(errorMessage(firstRun.error)).toContain(metadata.expectedError);
    expectStdout(firstRun.output, metadata.expectedStdout);
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
      runExpandBarrelCodemod(metadata.args, workRoot);
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

describe("expand barrel codemod fixtures", () => {
  it.each(fixtureNames())("%s", (name) => {
    runFixture(name);
  });
});
