import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_DUPLICATES_IGNORE_GLOBS,
  DEFAULT_DUPLICATES_MIN_LINES,
  DEFAULT_DUPLICATES_MIN_TOKENS,
  DEFAULT_DUPLICATES_MODE,
  DUPLICATE_REPAIR_HINT,
} from "./duplicates.js";
import { currentDetectorScope } from "./duplicates.test-helper.js";
import {
  DEFAULT_JSCPD_TIMEOUT_MS,
  defaultJscpdRunner,
  type JscpdRunner,
  type JscpdRunnerInput,
  type JscpdSpawn,
  LARGE_INVENTORY_WARNING_THRESHOLD,
  runDuplicatesCheck,
} from "./duplicates-runner.js";
import { stringContaining } from "./matcher.test-helper.js";
import type { DetectorScope } from "./scope.js";
import { toChangedScopeFile } from "./scope.js";
import type { ChangedFile } from "./types.js";

function changedDetectorScope(files: readonly ChangedFile[]): DetectorScope {
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

describe("runDuplicatesCheck", () => {
  const characterAuthChange: ChangedFile = {
    path: "packages/server/src/utils/character-auth.ts",
    status: "modified",
  };

  it("returns no findings and skips jscpd when no in-scope files changed", () => {
    let calls = 0;
    const runner: JscpdRunner = () => {
      calls += 1;
      return { ok: true, reportJson: '{"duplicates":[]}' };
    };
    const findings = runDuplicatesCheck({
      detectorScope: changedDetectorScope([
        { path: "docs/agent_notes/STATUS.md", status: "modified" },
        { path: "packages/server/src/types.d.ts", status: "modified" },
      ]),
      runner,
    });
    expect(findings).toEqual([]);
    expect(calls).toBe(0);
  });

  it("invokes the runner once per scope with the configured min-lines and ignore globs", () => {
    const inputs: JscpdRunnerInput[] = [];
    const runner: JscpdRunner = (input) => {
      inputs.push(input);
      return { ok: true, reportJson: '{"duplicates":[]}' };
    };
    runDuplicatesCheck({
      detectorScope: changedDetectorScope([
        characterAuthChange,
        { path: "scripts/drift-ai.ts", status: "modified" },
      ]),
      runner,
    });
    expect(inputs).toEqual([
      {
        scopePath: "packages/server/src",
        minLines: DEFAULT_DUPLICATES_MIN_LINES,
        minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
        mode: DEFAULT_DUPLICATES_MODE,
        ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
      },
      {
        scopePath: "scripts",
        minLines: DEFAULT_DUPLICATES_MIN_LINES,
        minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
        mode: DEFAULT_DUPLICATES_MODE,
        ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
      },
    ]);
  });

  it("converts changed-side clones into duplicate findings", () => {
    const runner: JscpdRunner = () => ({
      ok: true,
      reportJson: JSON.stringify({
        duplicates: [
          {
            format: "typescript",
            lines: 29,
            firstFile: {
              name: "packages/server/src/utils/character-auth.ts",
              start: 40,
              end: 68,
            },
            secondFile: {
              name: "packages/server/src/utils/campaign-auth.ts",
              start: 22,
              end: 50,
            },
          },
          {
            format: "typescript",
            lines: 12,
            firstFile: {
              name: "packages/server/src/services/example.ts",
              start: 1,
              end: 12,
            },
            secondFile: {
              name: "packages/server/src/services/other.ts",
              start: 1,
              end: 12,
            },
          },
        ],
      }),
    });
    const findings = runDuplicatesCheck({
      detectorScope: changedDetectorScope([characterAuthChange]),
      runner,
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src/utils/character-auth.ts:40-68",
        message: "duplicates packages/server/src/utils/campaign-auth.ts:22-50 (29 lines)",
        hint: DUPLICATE_REPAIR_HINT,
        relatedFiles: ["packages/server/src/utils/campaign-auth.ts:22-50"],
      },
    ]);
  });

  it("emits a failure finding when the runner returns ok:false and continues other scopes", () => {
    const runner: JscpdRunner = ({ scopePath }) =>
      scopePath === "packages/server/src"
        ? { ok: false, error: "boom" }
        : { ok: true, reportJson: '{"duplicates":[]}' };
    const findings = runDuplicatesCheck({
      detectorScope: changedDetectorScope([
        characterAuthChange,
        { path: "scripts/foo.ts", status: "modified" },
      ]),
      runner,
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: "jscpd subprocess failed (boom)",
        hint: stringContaining("Re-run drift:ai locally"),
      },
    ]);
  });

  it("respects caller overrides for minLines and ignoreGlobs", () => {
    const inputs: JscpdRunnerInput[] = [];
    const runner: JscpdRunner = (input) => {
      inputs.push(input);
      return { ok: true, reportJson: '{"duplicates":[]}' };
    };
    runDuplicatesCheck({
      detectorScope: changedDetectorScope([characterAuthChange]),
      runner,
      minLines: 10,
      minTokens: 50,
      mode: "weak",
      ignoreGlobs: ["**/*.snap"],
    });
    expect(inputs[0]).toEqual({
      scopePath: "packages/server/src",
      minLines: 10,
      minTokens: 50,
      mode: "weak",
      ignoreGlobs: ["**/*.snap"],
    });
  });

  it("surfaces malformed jscpd JSON as a warning finding in changed mode", () => {
    const findings = runDuplicatesCheck({
      detectorScope: changedDetectorScope([characterAuthChange]),
      runner: () => ({ ok: true, reportJson: "}{ not json" }),
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: stringContaining("jscpd produced unreadable JSON"),
        hint: "report-only: re-run drift:ai locally and capture the jscpd output for inspection.",
      },
    ]);
  });

  it.each(["", "  \n", "{}", '{"duplicates":"oops"}'])(
    "surfaces blank or malformed-shape jscpd output as advisory evidence: %j",
    (reportJson) => {
      const findings = runDuplicatesCheck({
        detectorScope: changedDetectorScope([characterAuthChange]),
        runner: () => ({ ok: true, reportJson }),
      });
      expect(findings).toEqual([
        {
          check: "duplicates",
          file: "packages/server/src",
          message: stringContaining("jscpd produced unreadable JSON"),
          hint: "report-only: re-run drift:ai locally and capture the jscpd output for inspection.",
        },
      ]);
    },
  );

  it("runs current-mode duplicates and uses the lexically smaller current path as primary", () => {
    const inputs: JscpdRunnerInput[] = [];
    const runner: JscpdRunner = (input) => {
      inputs.push(input);
      return {
        ok: true,
        reportJson: JSON.stringify({
          duplicates: [
            {
              lines: 18,
              firstFile: { name: "packages/server/src/b.ts", start: 5, end: 22 },
              secondFile: { name: "packages/server/src/a.ts", start: 9, end: 26 },
            },
          ],
        }),
      };
    };
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope([
        "packages/server/src/a.ts",
        "packages/server/src/b.ts",
        "packages/server/src/c.ts",
      ]),
      runner,
      roots: ["packages/server/src"],
    });
    expect(inputs).toEqual([
      {
        scopePath: "packages/server/src",
        minLines: DEFAULT_DUPLICATES_MIN_LINES,
        minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
        mode: DEFAULT_DUPLICATES_MODE,
        ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
      },
    ]);
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src/a.ts:9-26",
        message: "duplicates packages/server/src/b.ts:5-22 (18 lines)",
        hint: DUPLICATE_REPAIR_HINT,
        relatedFiles: ["packages/server/src/b.ts:5-22"],
      },
    ]);
  });

  it("keeps current files that only a shared ignore glob would have matched", () => {
    const inputs: JscpdRunnerInput[] = [];
    const runner: JscpdRunner = (input) => {
      inputs.push(input);
      return {
        ok: true,
        reportJson: JSON.stringify({
          duplicates: [
            {
              lines: 21,
              firstFile: { name: "src/legacy/b.ts", start: 5, end: 25 },
              secondFile: { name: "src/legacy/a.ts", start: 9, end: 29 },
            },
          ],
        }),
      };
    };
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope(["src/legacy/a.ts", "src/legacy/b.ts"]),
      runner,
      roots: ["src"],
      ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
    });
    expect(inputs).toEqual([
      {
        scopePath: "src",
        minLines: DEFAULT_DUPLICATES_MIN_LINES,
        minTokens: DEFAULT_DUPLICATES_MIN_TOKENS,
        mode: DEFAULT_DUPLICATES_MODE,
        ignoreGlobs: DEFAULT_DUPLICATES_IGNORE_GLOBS,
      },
    ]);
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "src/legacy/a.ts:9-29",
        message: "duplicates src/legacy/b.ts:5-25 (21 lines)",
        hint: DUPLICATE_REPAIR_HINT,
        relatedFiles: ["src/legacy/b.ts:5-25"],
      },
    ]);
  });

  it("emits one current-mode failure finding per failed scope", () => {
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts", "scripts/b.ts"]),
      runner: () => ({ ok: false, error: "boom" }),
      roots: ["packages/server/src", "scripts"],
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: "jscpd subprocess failed (boom)",
        hint: stringContaining("Re-run drift:ai locally"),
      },
      {
        check: "duplicates",
        file: "scripts",
        message: "jscpd subprocess failed (boom)",
        hint: stringContaining("Re-run drift:ai locally"),
      },
    ]);
  });

  it("surfaces malformed jscpd JSON as a warning finding in current mode", () => {
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: "}{ not json" }),
      roots: ["packages/server/src"],
    });
    expect(findings).toEqual([
      {
        check: "duplicates",
        file: "packages/server/src",
        message: stringContaining("jscpd produced unreadable JSON"),
        hint: "report-only: re-run drift:ai locally and capture the jscpd output for inspection.",
      },
    ]);
  });

  it("prints the current-mode large-inventory nudge for whole-repo roots", () => {
    const messages: string[] = [];
    const findings = runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: [],
      regularFileInventoryCount: 25_000,
      warnStderr: (message) => messages.push(message),
    });
    expect(findings).toEqual([]);
    expect(messages).toEqual([
      "drift:ai: large repository (25000 files); duplicates over the whole repo can be slow. Try --check ghost-files first or pass --root <path>.",
    ]);
  });

  it("prints the current-mode large-inventory nudge for an explicit repo root", () => {
    const messages: string[] = [];
    runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: ["."],
      regularFileInventoryCount: 25_000,
      warnStderr: (message) => messages.push(message),
    });
    expect(messages).toEqual([
      "drift:ai: large repository (25000 files); duplicates over the whole repo can be slow. Try --check ghost-files first or pass --root <path>.",
    ]);
  });

  it("does not print the large-inventory nudge when current roots are narrowed", () => {
    const messages: string[] = [];
    runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: ["packages/server/src"],
      regularFileInventoryCount: 25_000,
      warnStderr: (message) => messages.push(message),
    });
    expect(messages).toEqual([]);
  });

  it("does not print the large-inventory nudge when repo root is mixed with narrowed roots", () => {
    const messages: string[] = [];
    runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: [".", "packages/server/src"],
      regularFileInventoryCount: 25_000,
      warnStderr: (message) => messages.push(message),
    });
    expect(messages).toEqual([]);
  });

  it("does not print the large-inventory nudge below the threshold", () => {
    const messages: string[] = [];
    runDuplicatesCheck({
      detectorScope: currentDetectorScope(["packages/server/src/a.ts"]),
      runner: () => ({ ok: true, reportJson: '{"duplicates":[]}' }),
      roots: [],
      regularFileInventoryCount: LARGE_INVENTORY_WARNING_THRESHOLD - 1,
      warnStderr: (message) => messages.push(message),
    });
    expect(messages).toEqual([]);
  });
});

describe("defaultJscpdRunner", () => {
  it("passes the default timeout to the jscpd subprocess", () => {
    let observedTimeout: number | undefined;
    let observedKillSignal: number | NodeJS.Signals | undefined;
    let observedArgs: readonly string[] = [];
    const spawn: JscpdSpawn = (_command, args, options) => {
      observedArgs = args;
      observedTimeout = options.timeout;
      observedKillSignal = options.killSignal;
      writeFileSync(path.join(outputDirFromArgs(args), "jscpd-report.json"), '{"duplicates":[]}');
      return {
        error: undefined,
        status: 0,
        stdout: "",
        stderr: "",
        signal: null,
      };
    };

    const runner = defaultJscpdRunner({
      analyzedRepoRoot: "/repo/target",
      jscpdBin: "/bin/jscpd",
      spawn,
    });

    expect(
      runner({
        scopePath: "src",
        minLines: 8,
        minTokens: 60,
        mode: "mild",
        ignoreGlobs: [],
      }),
    ).toEqual({
      ok: true,
      reportJson: '{"duplicates":[]}',
    });
    expect(observedTimeout).toBe(DEFAULT_JSCPD_TIMEOUT_MS);
    expect(observedKillSignal).toBe("SIGKILL");
    expect(flagValue(observedArgs, "--min-lines")).toBe("8");
    expect(flagValue(observedArgs, "--min-tokens")).toBe("60");
    expect(flagValue(observedArgs, "--mode")).toBe("mild");
    expect(observedArgs).not.toContain("--threshold");
  });

  it("returns a stable failure when spawnSync times out", () => {
    const timeoutError = Object.assign(new Error("spawnSync timed out"), {
      code: "ETIMEDOUT",
    });
    const spawn: JscpdSpawn = () => ({
      error: timeoutError,
      status: null,
      stdout: "",
      stderr: "",
      signal: "SIGTERM",
    });

    const runner = defaultJscpdRunner({
      analyzedRepoRoot: "/repo/target",
      jscpdBin: "/bin/jscpd",
      spawn,
      timeoutMs: 1234,
    });

    expect(
      runner({
        scopePath: "src",
        minLines: 10,
        minTokens: 60,
        mode: "mild",
        ignoreGlobs: [],
      }),
    ).toEqual({
      ok: false,
      error: "timeout of 1234ms",
    });
  });
});

function outputDirFromArgs(args: readonly string[]): string {
  const outputFlagIndex = args.indexOf("--output");
  const outputDir = args[outputFlagIndex + 1];
  if (outputFlagIndex < 0 || outputDir === undefined) {
    throw new Error("expected jscpd --output argument");
  }
  return outputDir;
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}
