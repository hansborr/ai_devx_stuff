import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  copyDirectoryContents,
  enumerateFixtures,
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
import { CodemodError } from "./lib/trpc-shared-schema.js";
import { runStructuredLoggingFixCodemod } from "./structured-logging-fix.js";

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
const fixtureRoot = path.join(here, "fixtures", "structured-logging-fix");
const tmpRepo = registerTempRootCleanup();

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
    return { args, expectFailure, expectedError, expectedStdout, runTwice, expectedSecondStdout };
  }
  if (expectedError) throw new Error("expectedError is only valid when expectFailure is true.");
  return { args, expectFailure, expectedStdout, runTwice, expectedSecondStdout };
}

function fixtureNames(): string[] {
  return enumerateFixtures(fixtureRoot);
}

function runFixture(name: string): void {
  const caseRoot = path.join(fixtureRoot, name);
  const metadata = readMetadata(caseRoot);
  const workRoot = tmpRepo.makeTempRepo(`musi-structured-logging-fix-${name}-`);
  copyDirectoryContents(path.join(caseRoot, "before"), workRoot);

  const firstRun = withCapturedStdout(() => {
    runStructuredLoggingFixCodemod(metadata.args, workRoot);
  });
  if (metadata.expectFailure) {
    expect(firstRun.error).toBeInstanceOf(CodemodError);
    if (!(firstRun.error instanceof Error)) throw new Error("Expected codemod error.");
    expect(firstRun.error.message).toContain(metadata.expectedError);
    expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"));
    return;
  }
  if (firstRun.error) throwCapturedError(firstRun.error);

  if (metadata.runTwice) {
    const expectedSecondStdout = metadata.expectedSecondStdout;
    if (expectedSecondStdout === undefined) {
      throw new Error("expectedSecondStdout must be set when runTwice is true.");
    }
    const secondRun = withCapturedStdout(() => {
      runStructuredLoggingFixCodemod(metadata.args, workRoot);
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
  expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"));
}

describe("structured logging fix codemod fixtures", () => {
  it.each(fixtureNames())("%s", (name) => {
    runFixture(name);
  });
});
