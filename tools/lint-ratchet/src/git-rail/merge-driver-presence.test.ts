import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { forwardMissingMergeDriverWarning } from "./merge-driver-presence.js";

describe("forwardMissingMergeDriverWarning", () => {
  let dir: string;
  let warnings: string[];
  const warn = (message: string): void => {
    warnings.push(message);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "merge-driver-presence-"));
    warnings = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function scriptWith(body: string): string {
    const path = join(dir, "check.sh");
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    return path;
  }

  it("emits a legible timeout warning when the checker wedges", () => {
    forwardMissingMergeDriverWarning({
      checkScriptPath: scriptWith("sleep 30"),
      cwd: dir,
      env: {},
      warn,
      timeoutMs: 50,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe(
      "WARN: merge-driver presence check timed out after 50ms; skipping merge-driver advisory",
    );
  });

  it("forwards a WARN line the checker prints", () => {
    forwardMissingMergeDriverWarning({
      checkScriptPath: scriptWith('echo "WARN: merge drivers are not installed"'),
      cwd: dir,
      env: {},
      warn,
    });

    expect(warnings).toEqual(["WARN: merge drivers are not installed"]);
  });

  it("can invoke a packaged checker command without a repository script", () => {
    const checker = scriptWith('echo "WARN: packaged checker"');
    forwardMissingMergeDriverWarning({
      checkCommand: ["bash", checker],
      cwd: dir,
      env: {},
      warn,
    });

    expect(warnings).toEqual(["WARN: packaged checker"]);
  });

  it("stays silent when the checker reports no warning", () => {
    forwardMissingMergeDriverWarning({
      checkScriptPath: scriptWith('echo "OK: merge drivers present"'),
      cwd: dir,
      env: {},
      warn,
    });

    expect(warnings).toEqual([]);
  });

  it("names a missing checker script instead of no-opping silently", () => {
    const missing = join(dir, "does-not-exist.sh");
    forwardMissingMergeDriverWarning({
      checkScriptPath: missing,
      cwd: dir,
      env: {},
      warn,
    });

    expect(warnings).toEqual([
      `WARN: merge-driver presence check skipped: checker script not found at ${missing}`,
    ]);
  });

  it("skips the checker entirely under CI or the suppress env", () => {
    const neverRuns = scriptWith('echo "WARN: should not run"');

    forwardMissingMergeDriverWarning({
      checkScriptPath: neverRuns,
      cwd: dir,
      env: { CI: "1" },
      warn,
    });
    forwardMissingMergeDriverWarning({
      checkScriptPath: neverRuns,
      cwd: dir,
      env: { MUSI_SUPPRESS_MERGE_DRIVER_WARN: "1" },
      warn,
    });

    expect(warnings).toEqual([]);
  });
});
