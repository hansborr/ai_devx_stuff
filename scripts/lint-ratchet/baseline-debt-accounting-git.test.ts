import {
  type BaselineDebtAccountingGitDeps,
  runBaselineDebtAccountingCheck,
} from "@musi/lint-ratchet/governance/baseline-debt-accounting-git.js";
import {
  LINT_RATCHET_BASELINE_WRITE_VERSION,
  lintRatchetBaselineRegenerateForVersion,
} from "@musi/lint-ratchet/kernel/baseline-constants.js";
import { describe, expect, it, vi } from "vitest";

import { musiLintRatchetContext } from "./engine-binding.js";
import { BASELINE_FILENAME, baselinePath, DEBT_LOG_FILENAME, debtLogPath } from "./paths.js";

const emptyBaselineRegenerate = lintRatchetBaselineRegenerateForVersion(
  LINT_RATCHET_BASELINE_WRITE_VERSION,
);
const EMPTY_BASELINE = `${JSON.stringify(
  {
    version: LINT_RATCHET_BASELINE_WRITE_VERSION,
    ...(emptyBaselineRegenerate === undefined ? {} : { regenerate: emptyBaselineRegenerate }),
    tests: {},
  },
  null,
  2,
)}\n`;

type GitResponse = Error | string;

function gitKey(args: readonly string[]): string {
  return args.join("\0");
}

function makeDeps(
  gitResponses: readonly (readonly [readonly string[], GitResponse])[],
  files: Readonly<Record<string, string>> = { [baselinePath]: EMPTY_BASELINE },
): { readonly calls: readonly string[][]; readonly deps: BaselineDebtAccountingGitDeps } {
  const responses = new Map(gitResponses.map(([args, response]) => [gitKey(args), response]));
  const calls: string[][] = [];
  const deps: BaselineDebtAccountingGitDeps = {
    execFileSync: ((command: string, args?: readonly string[]) => {
      expect(command).toBe("git");
      const normalizedArgs = [...(args ?? [])];
      calls.push(normalizedArgs);
      const response = responses.get(gitKey(normalizedArgs));
      if (response instanceof Error) throw response;
      if (response === undefined) {
        throw new Error(`unexpected git call: ${normalizedArgs.join(" ")}`);
      }
      return response;
    }) as BaselineDebtAccountingGitDeps["execFileSync"],
    existsSync: ((path: string) =>
      Object.hasOwn(files, path)) as BaselineDebtAccountingGitDeps["existsSync"],
    readFileSync: ((path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`unexpected file read: ${path}`);
      return text;
    }) as BaselineDebtAccountingGitDeps["readFileSync"],
  };
  return { calls, deps };
}

function collectConsoleError(callback: () => void): string {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    callback();
    return spy.mock.calls.map((call) => call.join(" ")).join("\n");
  } finally {
    spy.mockRestore();
  }
}

describe("runBaselineDebtAccountingCheck", () => {
  it("uses first parent when the merge base is HEAD", () => {
    const head = "headsha000000000";
    const parent = "parentsha000000";
    const { calls, deps } = makeDeps([
      [["rev-parse", "HEAD"], `${head}\n`],
      [["merge-base", "HEAD", "origin/main"], `${head}\n`],
      [["rev-parse", "HEAD^"], `${parent}\n`],
      [["show", `${parent}:${BASELINE_FILENAME}`], EMPTY_BASELINE],
      [["show", `${parent}:${DEBT_LOG_FILENAME}`], ""],
    ]);

    const stderr = collectConsoleError(() => {
      runBaselineDebtAccountingCheck(musiLintRatchetContext, deps);
    });

    expect(stderr).toContain("OK - 0 baseline increase(s) accounted against parentsha000");
    expect(calls).toEqual([
      ["rev-parse", "HEAD"],
      ["merge-base", "HEAD", "origin/main"],
      ["rev-parse", "HEAD^"],
      ["show", `${parent}:${BASELINE_FILENAME}`],
      ["show", `${parent}:${DEBT_LOG_FILENAME}`],
    ]);
  });

  it("falls back from origin/main to origin/master before using the first parent", () => {
    const head = "headsha111111111";
    const base = "basesha111111111";
    const { calls, deps } = makeDeps([
      [["rev-parse", "HEAD"], `${head}\n`],
      [["merge-base", "HEAD", "origin/main"], new Error("missing origin/main")],
      [["merge-base", "HEAD", "origin/master"], `${base}\n`],
      [["show", `${base}:${BASELINE_FILENAME}`], EMPTY_BASELINE],
      [["show", `${base}:${DEBT_LOG_FILENAME}`], ""],
    ]);

    const stderr = collectConsoleError(() => {
      runBaselineDebtAccountingCheck(musiLintRatchetContext, deps);
    });

    expect(stderr).toContain("OK - 0 baseline increase(s) accounted against basesha11111");
    expect(calls.map((call) => call.join(" "))).not.toContain("rev-parse HEAD^");
  });

  it("reports a skip when no comparable git base exists", () => {
    const { calls, deps } = makeDeps([
      [["rev-parse", "HEAD"], "headsha222222222\n"],
      [["merge-base", "HEAD", "origin/main"], new Error("missing origin/main")],
      [["merge-base", "HEAD", "origin/master"], new Error("missing origin/master")],
      [["rev-parse", "HEAD^"], new Error("missing parent")],
    ]);

    const stderr = collectConsoleError(() => {
      runBaselineDebtAccountingCheck(musiLintRatchetContext, deps);
    });

    expect(stderr).toContain("WARN - configured base refs are unavailable");
    expect(stderr).toContain("SKIP - no comparable git base found");
    expect(calls.some((call) => call[0] === "show")).toBe(false);
  });

  it("reads stage-0 baseline and debt-log blobs in pre-commit context", () => {
    const base = "basesha444444444";
    const stagedDebtLog = "";
    const { calls, deps } = makeDeps([
      [["rev-parse", "HEAD"], "headsha444444444\n"],
      [["merge-base", "HEAD", "origin/main"], `${base}\n`],
      [["show", `${base}:${BASELINE_FILENAME}`], EMPTY_BASELINE],
      [["show", `:${BASELINE_FILENAME}`], EMPTY_BASELINE],
      [["show", `${base}:${DEBT_LOG_FILENAME}`], ""],
      [["show", `:${DEBT_LOG_FILENAME}`], stagedDebtLog],
    ]);

    runBaselineDebtAccountingCheck(musiLintRatchetContext, deps, { currentSource: "index" });

    expect(calls).toContainEqual(["show", `:${BASELINE_FILENAME}`]);
    expect(calls).toContainEqual(["show", `:${DEBT_LOG_FILENAME}`]);
  });

  it("uses an explicitly configured base ref instead of default candidates", () => {
    const base = "basesha555555555";
    const { calls, deps } = makeDeps([
      [["rev-parse", "HEAD"], "headsha555555555\n"],
      [["merge-base", "HEAD", "upstream/trunk"], `${base}\n`],
      [["show", `${base}:${BASELINE_FILENAME}`], EMPTY_BASELINE],
      [["show", `${base}:${DEBT_LOG_FILENAME}`], ""],
    ]);

    runBaselineDebtAccountingCheck(musiLintRatchetContext, deps, {
      baseRefCandidates: ["upstream/trunk"],
    });

    expect(calls).toContainEqual(["merge-base", "HEAD", "upstream/trunk"]);
    expect(calls.map((call) => call.join(" "))).not.toContain("merge-base HEAD origin/main");
  });

  it("warns when unavailable configured refs degrade accounting to the first parent", () => {
    const parent = "parentsha666666";
    const { deps } = makeDeps([
      [["rev-parse", "HEAD"], "headsha666666666\n"],
      [["merge-base", "HEAD", "upstream/trunk"], new Error("not fetched")],
      [["rev-parse", "HEAD^"], `${parent}\n`],
      [["show", `${parent}:${BASELINE_FILENAME}`], EMPTY_BASELINE],
      [["show", `${parent}:${DEBT_LOG_FILENAME}`], ""],
    ]);

    const stderr = collectConsoleError(() => {
      runBaselineDebtAccountingCheck(musiLintRatchetContext, deps, {
        baseRefCandidates: ["upstream/trunk"],
      });
    });

    expect(stderr).toContain("WARN - configured base refs are unavailable");
    expect(stderr).toContain("falling back to HEAD^");
    expect(stderr).toContain("--base-ref <ref>");
  });

  it("treats a missing current debt log as empty", () => {
    const base = "basesha333333333";
    const { deps } = makeDeps(
      [
        [["rev-parse", "HEAD"], "headsha333333333\n"],
        [["merge-base", "HEAD", "origin/main"], `${base}\n`],
        [["show", `${base}:${BASELINE_FILENAME}`], EMPTY_BASELINE],
        [["show", `${base}:${DEBT_LOG_FILENAME}`], ""],
      ],
      { [baselinePath]: EMPTY_BASELINE, [debtLogPath]: "" },
    );

    expect(() => {
      runBaselineDebtAccountingCheck(musiLintRatchetContext, deps);
    }).not.toThrow();
  });
});
