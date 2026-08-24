import { cpSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { expect } from "vitest";

// Shared scaffolding for the codemod fixture-runner tests
// (concurrency-guard, expand-barrel, structured-logging-fix, and
// trpc-shared-schema-codemod). These four files previously inlined a
// byte-identical case.json metadata validator block and an fs/stdout block;
// the scaffolding lives here so a change to fixture-metadata shape,
// directory-compare, or stdout-capture semantics is a single edit. Each test
// keeps its own readMetadata/runFixture driver and it.each enumeration because
// those genuinely diverge (failure-assertion variant, runTwice policy, and the
// trpc file's two-kind parameterization).

function unknownProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Fixture metadata must be a JSON object.");
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export function optionalBoolean(value: unknown, key: string): boolean {
  const property = unknownProperty(value, key);
  if (property === undefined) return false;
  if (typeof property !== "boolean") throw new Error(`${key} must be a boolean.`);
  return property;
}

function stringArrayProperty(property: unknown, key: string): string[] {
  if (!Array.isArray(property)) throw new Error(`${key} must be a string array.`);
  const strings: string[] = [];
  for (const item of property) {
    if (typeof item !== "string") throw new Error(`${key} must contain only strings.`);
    strings.push(item);
  }
  return strings;
}

export function requiredStringArray(value: unknown, key: string): string[] {
  const property = unknownProperty(value, key);
  return stringArrayProperty(property, key);
}

export function optionalStringArray(value: unknown, key: string): string[] {
  const property = unknownProperty(value, key);
  if (property === undefined) return [];
  return stringArrayProperty(property, key);
}

export function optionalStringArrayProperty(value: unknown, key: string): string[] | undefined {
  const property = unknownProperty(value, key);
  if (property === undefined) return undefined;
  return stringArrayProperty(property, key);
}

export function optionalString(value: unknown, key: string): string | undefined {
  const property = unknownProperty(value, key);
  if (property === undefined) return undefined;
  if (typeof property !== "string") throw new Error(`${key} must be a string.`);
  return property;
}

export function parseCaseJson(caseRoot: string): unknown {
  return JSON.parse(readFileSync(path.join(caseRoot, "case.json"), "utf8"));
}

// Non-vacuity precondition for the four codemod suites (and, for the trpc
// file, for each fixture kind independently). Every caller feeds this result
// straight into `it.each`, so an emptied fixture root would register zero
// cases and the suite would report success having exercised nothing. Throwing
// here converts that silent hole into a local failure that names the root it
// scanned. A mistyped root needs no precondition: `readdirSync` already fails
// loudly with ENOENT before this check is reached.
export function enumerateFixtures(root: string): string[] {
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (names.length === 0) {
    throw new Error(
      `No codemod fixture directories found under ${root}. ` +
        "it.each would register zero cases, so the suite would pass without running any fixture. " +
        "Restore the fixture case directories under that root.",
    );
  }
  return names;
}

// A missing `after/` asserts the full output directory against `before/`; it
// never skips the output check.
export function expectedRoot(caseRoot: string): string {
  const afterRoot = path.join(caseRoot, "after");
  return existsSync(afterRoot) ? afterRoot : path.join(caseRoot, "before");
}

export function copyDirectoryContents(source: string, target: string): void {
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

export function expectDirectoriesToMatch(actualRoot: string, expectedFilesRoot: string): void {
  const actualFiles = relativeFiles(actualRoot);
  const expectedFiles = relativeFiles(expectedFilesRoot);
  expect(actualFiles).toEqual(expectedFiles);
  for (const file of expectedFiles) {
    expect(readFileSync(path.join(actualRoot, file), "utf8")).toBe(
      readFileSync(path.join(expectedFilesRoot, file), "utf8"),
    );
  }
}

export function withCapturedStdout(run: () => void): { output: string; error: unknown } {
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

export function expectStdout(output: string, expectedSnippets: string[]): void {
  for (const snippet of expectedSnippets) expect(output).toContain(snippet);
}

function stdoutLines(output: string): string[] {
  if (output.length === 0) return [];
  return output.split("\n");
}

export function expectRunTwiceStdout(
  firstOutput: string,
  secondOutput: string,
  expectedFirstSnippets: string[],
  expectedSecondSnippets: string[],
): void {
  expectStdout(firstOutput, expectedFirstSnippets);
  expectStdout(secondOutput, expectedSecondSnippets);
  const secondLines = stdoutLines(secondOutput);
  const expectedSecondLines = new Set(expectedSecondSnippets);
  for (const snippet of expectedFirstSnippets) {
    if (!expectedSecondLines.has(snippet)) expect(secondLines).not.toContain(snippet);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const structured: unknown = JSON.stringify(error, null, 2);
    if (typeof structured === "string") return structured;
    return String(error);
  } catch {
    return String(error);
  }
}

export function throwCapturedError(error: unknown): never {
  if (error instanceof Error) throw error;
  throw new Error(errorMessage(error));
}
