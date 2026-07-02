import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  checkBaselineDebtAccounting,
  formatBaselineDebtAccountingFailures,
} from "./baseline-debt-accounting.js";
import { WorseBaselineError } from "./errors.js";
import { ConfigError } from "./lint-ratchet-metrics.js";
import {
  BASELINE_FILENAME,
  baselinePath,
  DEBT_LOG_FILENAME,
  debtLogPath,
  repoRoot,
} from "./paths.js";

const BASE_REF_CANDIDATES = ["origin/main", "origin/master"] as const;
const SHORT_SHA_LENGTH = 12;

export interface BaselineDebtAccountingGitDeps {
  readonly execFileSync: typeof execFileSync;
  readonly existsSync: typeof existsSync;
  readonly readFileSync: typeof readFileSync;
}

export const defaultBaselineDebtAccountingGitDeps: BaselineDebtAccountingGitDeps = {
  execFileSync,
  existsSync,
  readFileSync,
};

function gitOutput(
  args: readonly string[],
  deps: BaselineDebtAccountingGitDeps,
): string | undefined {
  try {
    return deps.execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function gitSingleLine(
  args: readonly string[],
  deps: BaselineDebtAccountingGitDeps,
): string | undefined {
  const output = gitOutput(args, deps)?.trim();
  return output === undefined || output.length === 0 ? undefined : output;
}

function firstParent(deps: BaselineDebtAccountingGitDeps): string | undefined {
  return gitSingleLine(["rev-parse", "HEAD^"], deps);
}

function comparableBaseRef(deps: BaselineDebtAccountingGitDeps): string | undefined {
  const head = gitSingleLine(["rev-parse", "HEAD"], deps);
  for (const candidate of BASE_REF_CANDIDATES) {
    const mergeBase = gitSingleLine(["merge-base", "HEAD", candidate], deps);
    if (mergeBase === undefined) continue;
    return mergeBase === head ? firstParent(deps) : mergeBase;
  }
  return firstParent(deps);
}

function gitFileText(
  ref: string,
  path: string,
  deps: BaselineDebtAccountingGitDeps,
): string | undefined {
  return gitOutput(["show", `${ref}:${path}`], deps);
}

function readCurrentFile(path: string, deps: BaselineDebtAccountingGitDeps): string | undefined {
  return deps.existsSync(path) ? deps.readFileSync(path, "utf8") : undefined;
}

export function runBaselineDebtAccountingCheck(
  deps: BaselineDebtAccountingGitDeps = defaultBaselineDebtAccountingGitDeps,
): void {
  const baseRef = comparableBaseRef(deps);
  if (baseRef === undefined) {
    console.error("lint:ratchet:check-debt-accounting SKIP - no comparable git base found.");
    return;
  }
  const baseBaselineText = gitFileText(baseRef, BASELINE_FILENAME, deps);
  if (baseBaselineText === undefined) {
    console.error(
      `lint:ratchet:check-debt-accounting SKIP - ${BASELINE_FILENAME} is absent at ${baseRef.slice(0, SHORT_SHA_LENGTH)}.`,
    );
    return;
  }
  const currentBaselineText = readCurrentFile(baselinePath, deps);
  if (currentBaselineText === undefined) {
    throw new ConfigError(`${BASELINE_FILENAME} does not exist; run bun run lint:ratchet:update`);
  }
  const result = checkBaselineDebtAccounting({
    baseBaselineText,
    currentBaselineText,
    baseDebtLogText: gitFileText(baseRef, DEBT_LOG_FILENAME, deps) ?? "",
    currentDebtLogText: readCurrentFile(debtLogPath, deps) ?? "",
  });
  if (result.failures.length > 0) {
    throw new WorseBaselineError(formatBaselineDebtAccountingFailures(result.failures));
  }
  console.error(
    `lint:ratchet:check-debt-accounting OK - ${String(result.increases.length)} baseline increase(s) accounted against ${baseRef.slice(0, SHORT_SHA_LENGTH)}.`,
  );
}
