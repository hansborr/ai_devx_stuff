import { existsSync } from "node:fs";

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

// Binding smoke for the real Musi context (engine semantics live in the package
// suite: tools/lint-ratchet/src/governance/baseline-debt-accounting-git.test.ts).
// The expected repo-relative paths below are hardcoded literals on purpose: they
// must NOT be derived from paths.ts, or the test would move together with the
// binding it is meant to pin and assert nothing.
const EXPECTED_BASELINE_REL_PATH = "lint-ratchet.baseline.json";
const EXPECTED_DEBT_LOG_REL_PATH = "lint-ratchet.debt-log.jsonl";

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

describe("musiLintRatchetContext debt-accounting binding", () => {
  it("resolves the committed baseline and debt-log at the real repo root", () => {
    // Pins paths.ts repoRoot resolution against the actual worktree: if the
    // "../.." hop in paths.ts drifts, the binding points at files that do not
    // exist and this fails before any git behavior is exercised.
    expect(existsSync(musiLintRatchetContext.baselinePath)).toBe(true);
    expect(musiLintRatchetContext.baselinePath).toBe(
      `${musiLintRatchetContext.repoRoot}/${EXPECTED_BASELINE_REL_PATH}`,
    );
    expect(musiLintRatchetContext.debtLogPath).toBe(
      `${musiLintRatchetContext.repoRoot}/${EXPECTED_DEBT_LOG_REL_PATH}`,
    );
  });

  it("feeds the Musi repo-relative baseline and debt-log paths into git reads", () => {
    const base = "basesha000000000";
    const calls: string[][] = [];
    const cwds: unknown[] = [];
    const responses = new Map<string, string>([
      ["rev-parse HEAD", "headsha000000000\n"],
      ["merge-base HEAD origin/main", `${base}\n`],
      [`show ${base}:${EXPECTED_BASELINE_REL_PATH}`, EMPTY_BASELINE],
      [`show ${base}:${EXPECTED_DEBT_LOG_REL_PATH}`, ""],
    ]);
    const deps: BaselineDebtAccountingGitDeps = {
      execFileSync: ((
        command: string,
        args?: readonly string[],
        options?: { readonly cwd?: unknown },
      ) => {
        expect(command).toBe("git");
        const normalizedArgs = [...(args ?? [])];
        calls.push(normalizedArgs);
        cwds.push(options?.cwd);
        const response = responses.get(normalizedArgs.join(" "));
        if (response === undefined) {
          throw new Error(`unexpected git call: ${normalizedArgs.join(" ")}`);
        }
        return response;
      }) as BaselineDebtAccountingGitDeps["execFileSync"],
      existsSync: ((path: string) =>
        path ===
        musiLintRatchetContext.baselinePath) as BaselineDebtAccountingGitDeps["existsSync"],
      readFileSync: ((path: string) => {
        if (path === musiLintRatchetContext.baselinePath) return EMPTY_BASELINE;
        throw new Error(`unexpected file read: ${path}`);
      }) as BaselineDebtAccountingGitDeps["readFileSync"],
    };

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      runBaselineDebtAccountingCheck(musiLintRatchetContext, deps);
      const stderr = spy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(stderr).toContain("OK - 0 baseline increase(s) accounted");
    } finally {
      spy.mockRestore();
    }

    // Hardcoded literals: the real binding must read exactly these committed
    // repo-relative paths from git, whatever paths.ts happens to export.
    expect(calls).toContainEqual(["show", `${base}:${EXPECTED_BASELINE_REL_PATH}`]);
    expect(calls).toContainEqual(["show", `${base}:${EXPECTED_DEBT_LOG_REL_PATH}`]);
    // Every git call runs from the binding's repo root.
    for (const cwd of cwds) expect(cwd).toBe(musiLintRatchetContext.repoRoot);
  });
});
