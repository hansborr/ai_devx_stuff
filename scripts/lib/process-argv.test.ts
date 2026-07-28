import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isCliEntrypoint, PROCESS_ARGV_USER_ARGS_START } from "./process-argv.js";

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
});

function withEntry(entry: string | undefined): void {
  process.argv = entry === undefined ? ["bun"] : ["bun", entry];
}

describe("isCliEntrypoint", () => {
  it("is true when argv[1] is the calling module", () => {
    withEntry("/repo/scripts/example.ts");
    expect(isCliEntrypoint(pathToFileURL("/repo/scripts/example.ts").href)).toBe(true);
  });

  it("is false when argv[1] is a different module", () => {
    withEntry("/repo/scripts/other.ts");
    expect(isCliEntrypoint(pathToFileURL("/repo/scripts/example.ts").href)).toBe(false);
  });

  it("is false when argv[1] is absent, so importing a module never runs its CLI", () => {
    withEntry(undefined);
    expect(isCliEntrypoint(pathToFileURL("/repo/scripts/example.ts").href)).toBe(false);
  });

  it("is false for an empty argv[1] rather than comparing against the cwd URL", () => {
    process.argv = ["bun", ""];
    expect(isCliEntrypoint(pathToFileURL("/repo/scripts/example.ts").href)).toBe(false);
  });
});

describe("PROCESS_ARGV_USER_ARGS_START", () => {
  it("skips the runtime and the entry script", () => {
    expect(PROCESS_ARGV_USER_ARGS_START).toBe(2);
    expect(["bun", "script.ts", "--flag"].slice(PROCESS_ARGV_USER_ARGS_START)).toEqual(["--flag"]);
  });
});
