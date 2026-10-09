import { describe, expect, it } from "vitest";

import {
  isScriptSmokeTestPath,
  isSmokeTestBasename,
  matchesSmokeSubject,
  normalizePath,
  parseSmokeSubjectsHeaderLine,
} from "./smoke-test-files.js";

describe("smoke test file vocabulary", () => {
  it("recognizes bare smoke-test basenames", () => {
    expect(isSmokeTestBasename("test-harness-check.sh")).toBe(true);
    expect(isSmokeTestBasename("harness-check.sh")).toBe(false);
    expect(isSmokeTestBasename("scripts/tests/test-harness-check.sh")).toBe(false);
  });

  it("recognizes only directory-qualified smoke-test paths", () => {
    expect(isScriptSmokeTestPath("scripts/tests/test-harness-check.sh")).toBe(true);
    expect(isScriptSmokeTestPath("scripts\\tests\\test-harness-check.sh")).toBe(true);
    expect(isScriptSmokeTestPath("test-harness-check.sh")).toBe(false);
    expect(isScriptSmokeTestPath("scripts/tests/nested/test-harness-check.sh")).toBe(false);
  });

  it("normalizes path separators for path-policy consumers", () => {
    expect(normalizePath(String.raw`scripts\tests\test-harness-check.sh`)).toBe(
      "scripts/tests/test-harness-check.sh",
    );
  });
});

describe("smoke-subject header parsing", () => {
  it("returns undefined for lines that are not smoke-subjects headers", () => {
    expect(parseSmokeSubjectsHeaderLine("cp a b")).toBeUndefined();
    expect(parseSmokeSubjectsHeaderLine("# smoke-order: 3")).toBeUndefined();
    expect(parseSmokeSubjectsHeaderLine("  # smoke-subjects: scripts/a.sh")).toBeUndefined();
  });

  it("tokenizes a header on arbitrary whitespace and tolerates the hash spacing", () => {
    expect(parseSmokeSubjectsHeaderLine("# smoke-subjects: scripts/a.sh  scripts/b/")).toEqual([
      "scripts/a.sh",
      "scripts/b/",
    ]);
    expect(parseSmokeSubjectsHeaderLine("#smoke-subjects:scripts/a.sh")).toEqual(["scripts/a.sh"]);
    expect(parseSmokeSubjectsHeaderLine("#   smoke-subjects:\tscripts/a.sh\t")).toEqual([
      "scripts/a.sh",
    ]);
  });

  it("returns an empty token list for a subject-less header rather than a blank token", () => {
    expect(parseSmokeSubjectsHeaderLine("# smoke-subjects:")).toEqual([]);
    expect(parseSmokeSubjectsHeaderLine("# smoke-subjects:   ")).toEqual([]);
  });
});

describe("smoke-subject matching", () => {
  it("matches an exact subject path", () => {
    expect(matchesSmokeSubject("scripts/lint-changed.sh", "scripts/lint-changed.sh")).toBe(true);
    expect(matchesSmokeSubject("scripts/lint-shell.sh", "scripts/lint-changed.sh")).toBe(false);
  });

  it("normalizes the comparable path before matching", () => {
    expect(
      matchesSmokeSubject(String.raw`scripts\lint-changed.sh`, "scripts/lint-changed.sh"),
    ).toBe(true);
    expect(
      matchesSmokeSubject(String.raw`scripts\code-intel\daemon.ts`, "scripts/code-intel/"),
    ).toBe(true);
  });

  it("treats a trailing-slash subject as a directory prefix", () => {
    expect(matchesSmokeSubject("scripts/code-intel/daemon-client.ts", "scripts/code-intel/")).toBe(
      true,
    );
    expect(matchesSmokeSubject("scripts/code-intel/", "scripts/code-intel/")).toBe(true);
  });

  it("rejects a sibling directory that merely shares a name prefix", () => {
    expect(matchesSmokeSubject("scripts/code-intel-extra/daemon.ts", "scripts/code-intel/")).toBe(
      false,
    );
    expect(matchesSmokeSubject("scripts/code-intel", "scripts/code-intel/")).toBe(false);
  });

  it("never treats a non-directory subject as a prefix", () => {
    expect(matchesSmokeSubject("scripts/lint-changed.sh.bak", "scripts/lint-changed.sh")).toBe(
      false,
    );
  });
});
