import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { runConcurrencyGuardCodemod } from "./concurrency-guard.js";
import {
  copyDirectoryContents,
  enumerateFixtures,
  expectDirectoriesToMatch,
  expectStdout,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  parseCaseJson,
  requiredStringArray,
  throwCapturedError,
  withCapturedStdout,
} from "./lib/fixture-runner.test-helper.js";
import { CodemodError } from "./lib/trpc-shared-schema.js";

type FixtureMetadataBase = {
  args: string[];
  expectedStdout: string[];
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
const fixtureRoot = path.join(here, "fixtures", "concurrency-guard");
const tmpRepo = registerTempRootCleanup();

function readMetadata(caseRoot: string): FixtureMetadata {
  const parsed = parseCaseJson(caseRoot);
  const args = requiredStringArray(parsed, "args");
  const expectFailure = optionalBoolean(parsed, "expectFailure");
  const expectedError = optionalString(parsed, "expectedError");
  const expectedStdout = optionalStringArray(parsed, "expectedStdout");
  if (expectFailure) {
    if (!expectedError) throw new Error("expectedError must be set when expectFailure is true.");
    return { args, expectFailure, expectedError, expectedStdout };
  }
  if (expectedError) throw new Error("expectedError is only valid when expectFailure is true.");
  return { args, expectFailure, expectedStdout };
}

function fixtureNames(): string[] {
  return enumerateFixtures(fixtureRoot);
}

function runFixture(name: string): void {
  const caseRoot = path.join(fixtureRoot, name);
  const metadata = readMetadata(caseRoot);
  const workRoot = tmpRepo.makeTempRepo(`musi-concurrency-guard-${name}-`);
  copyDirectoryContents(path.join(caseRoot, "before"), workRoot);

  const firstRun = withCapturedStdout(() => {
    runConcurrencyGuardCodemod(metadata.args, workRoot);
  });
  if (metadata.expectFailure) {
    expect(firstRun.error).toBeInstanceOf(CodemodError);
    if (!(firstRun.error instanceof Error)) throw new Error("Expected codemod error.");
    expect(firstRun.error.message).toContain(metadata.expectedError);
    expectStdout(firstRun.output, metadata.expectedStdout);
    expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"));
    return;
  }
  if (firstRun.error) throwCapturedError(firstRun.error);
  expectStdout(firstRun.output, metadata.expectedStdout);
  expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"));
}

describe("concurrency guard codemod fixtures", () => {
  it.each(fixtureNames())("%s", (name) => {
    runFixture(name);
  });
});
