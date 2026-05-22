import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { CodemodError } from "./lib/trpc-shared-schema.js";
import { runStructuredLoggingFixCodemod } from "./structured-logging-fix.js";

type FixtureMetadataBase = {
  args: string[];
  expectedStdout: string[];
  runTwice: boolean;
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
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function unknownProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Fixture metadata must be a JSON object.");
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function optionalBoolean(value: unknown, key: string): boolean {
  const property = unknownProperty(value, key);
  if (property === undefined) return false;
  if (typeof property !== "boolean") throw new Error(`${key} must be a boolean.`);
  return property;
}

function requiredStringArray(value: unknown, key: string): string[] {
  const property = unknownProperty(value, key);
  if (!Array.isArray(property)) throw new Error(`${key} must be a string array.`);
  const strings: string[] = [];
  for (const item of property) {
    if (typeof item !== "string") throw new Error(`${key} must contain only strings.`);
    strings.push(item);
  }
  return strings;
}

function optionalStringArray(value: unknown, key: string): string[] {
  const property = unknownProperty(value, key);
  if (property === undefined) return [];
  if (!Array.isArray(property)) throw new Error(`${key} must be a string array.`);
  const strings: string[] = [];
  for (const item of property) {
    if (typeof item !== "string") throw new Error(`${key} must contain only strings.`);
    strings.push(item);
  }
  return strings;
}

function optionalString(value: unknown, key: string): string | undefined {
  const property = unknownProperty(value, key);
  if (property === undefined) return undefined;
  if (typeof property !== "string") throw new Error(`${key} must be a string.`);
  return property;
}

function readMetadata(caseRoot: string): FixtureMetadata {
  const parsed: unknown = JSON.parse(readFileSync(path.join(caseRoot, "case.json"), "utf8"));
  const args = requiredStringArray(parsed, "args");
  const expectFailure = optionalBoolean(parsed, "expectFailure");
  const expectedError = optionalString(parsed, "expectedError");
  const expectedStdout = optionalStringArray(parsed, "expectedStdout");
  const runTwice = optionalBoolean(parsed, "runTwice");
  if (expectFailure) {
    if (!expectedError) throw new Error("expectedError must be set when expectFailure is true.");
    return { args, expectFailure, expectedError, expectedStdout, runTwice };
  }
  if (expectedError) throw new Error("expectedError is only valid when expectFailure is true.");
  return { args, expectFailure, expectedStdout, runTwice };
}

function fixtureNames(): string[] {
  return readdirSync(fixtureRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function copyDirectoryContents(source: string, target: string): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    cpSync(path.join(source, entry.name), path.join(target, entry.name), { recursive: true });
  }
}

function relativeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const currentPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(currentPath);
        continue;
      }
      if (!statSync(currentPath).isFile()) continue;
      files.push(path.relative(root, currentPath));
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function expectDirectoriesToMatch(actualRoot: string, expectedRoot: string): void {
  const actualFiles = relativeFiles(actualRoot);
  const expectedFiles = relativeFiles(expectedRoot);
  expect(actualFiles).toEqual(expectedFiles);
  for (const file of expectedFiles) {
    expect(readFileSync(path.join(actualRoot, file), "utf8")).toBe(
      readFileSync(path.join(expectedRoot, file), "utf8"),
    );
  }
}

function withCapturedStdout(run: () => void): { output: string; error: unknown } {
  const originalLog = console.log;
  const lines: string[] = [];
  let error: unknown;
  console.log = (...values: unknown[]): void => {
    lines.push(values.map(String).join(" "));
  };
  try {
    run();
  } catch (caught) {
    error = caught;
  } finally {
    console.log = originalLog;
  }
  return { output: lines.join("\n"), error };
}

function expectStdout(output: string, expectedSnippets: string[]): void {
  for (const snippet of expectedSnippets) expect(output).toContain(snippet);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const structured = JSON.stringify(error, null, 2);
    return structured ?? String(error);
  } catch {
    return String(error);
  }
}

function throwCapturedError(error: unknown): never {
  if (error instanceof Error) throw error;
  throw new Error(errorMessage(error));
}

function runFixture(name: string): void {
  const caseRoot = path.join(fixtureRoot, name);
  const metadata = readMetadata(caseRoot);
  const workRoot = mkdtempSync(path.join(tmpdir(), `musi-structured-logging-fix-${name}-`));
  tempRoots.push(workRoot);
  copyDirectoryContents(path.join(caseRoot, "before"), workRoot);

  const firstRun = withCapturedStdout(() =>
    runStructuredLoggingFixCodemod(metadata.args, workRoot),
  );
  if (metadata.expectFailure) {
    expect(firstRun.error).toBeInstanceOf(CodemodError);
    if (!(firstRun.error instanceof Error)) throw new Error("Expected codemod error.");
    expect(firstRun.error.message).toContain(metadata.expectedError);
    expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"));
    return;
  }
  if (firstRun.error) throwCapturedError(firstRun.error);

  let output = firstRun.output;
  if (metadata.runTwice) {
    const secondRun = withCapturedStdout(() =>
      runStructuredLoggingFixCodemod(metadata.args, workRoot),
    );
    if (secondRun.error) throwCapturedError(secondRun.error);
    output = `${output}\n${secondRun.output}`;
  }
  expectStdout(output, metadata.expectedStdout);
  expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"));
}

describe("structured logging fix codemod fixtures", () => {
  it.each(fixtureNames())("%s", (name) => {
    runFixture(name);
  });
});
