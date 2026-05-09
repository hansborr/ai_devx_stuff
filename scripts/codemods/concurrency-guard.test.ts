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

import { runConcurrencyGuardCodemod } from "./concurrency-guard.js";
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
  if (expectFailure) {
    if (!expectedError) throw new Error("expectedError must be set when expectFailure is true.");
    return { args, expectFailure, expectedError, expectedStdout };
  }
  if (expectedError) throw new Error("expectedError is only valid when expectFailure is true.");
  return { args, expectFailure, expectedStdout };
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

function runFixture(name: string): void {
  const caseRoot = path.join(fixtureRoot, name);
  const metadata = readMetadata(caseRoot);
  const workRoot = mkdtempSync(path.join(tmpdir(), `musi-concurrency-guard-${name}-`));
  tempRoots.push(workRoot);
  copyDirectoryContents(path.join(caseRoot, "before"), workRoot);

  const firstRun = withCapturedStdout(() => runConcurrencyGuardCodemod(metadata.args, workRoot));
  if (metadata.expectFailure) {
    expect(firstRun.error).toBeInstanceOf(CodemodError);
    if (!(firstRun.error instanceof Error)) throw new Error("Expected codemod error.");
    expect(firstRun.error.message).toContain(metadata.expectedError);
    expectStdout(firstRun.output, metadata.expectedStdout);
    expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"));
    return;
  }
  if (firstRun.error) throw firstRun.error;
  expectStdout(firstRun.output, metadata.expectedStdout);
  expectDirectoriesToMatch(workRoot, path.join(caseRoot, "after"));
}

describe("concurrency guard codemod fixtures", () => {
  it.each(fixtureNames())("%s", (name) => {
    runFixture(name);
  });
});
