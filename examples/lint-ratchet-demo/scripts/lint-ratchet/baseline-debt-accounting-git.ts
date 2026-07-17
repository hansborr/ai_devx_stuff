import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  checkBaselineDebtAccounting,
  formatBaselineDebtAccountingFailures,
} from "./baseline-debt-accounting.js";
import { WorseBaselineError } from "./cli-errors.js";
import { ConfigError } from "./metrics.js";
import {
  BASELINE_FILENAME,
  baselinePath,
  DEBT_LOG_FILENAME,
  debtLogPath,
  repoRoot,
} from "./paths.js";

const BASE_REF_CANDIDATES = ["origin/main", "origin/master"] as const;
const SHORT_SHA_LENGTH = 12;

export interface BaselineDebtAccountingGitOptions {
  readonly currentSource?: "index" | "worktree";
  readonly baseRefCandidates?: readonly string[];
}

interface ComparableBase {
  readonly ref?: string;
  readonly degraded: boolean;
  readonly candidates: readonly string[];
}

export interface BaselineDebtAccountingGitDeps {
  readonly execFileSync: typeof execFileSync;
  readonly existsSync: typeof existsSync;
  readonly readFileSync: typeof readFileSync;
}

const defaultBaselineDebtAccountingGitDeps: BaselineDebtAccountingGitDeps = {
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

function comparableBaseRef(
  candidates: readonly string[],
  deps: BaselineDebtAccountingGitDeps,
): ComparableBase {
  const head = gitSingleLine(["rev-parse", "HEAD"], deps);
  for (const candidate of candidates) {
    const mergeBase = gitSingleLine(["merge-base", "HEAD", candidate], deps);
    if (mergeBase === undefined) continue;
    return {
      ref: mergeBase === head ? firstParent(deps) : mergeBase,
      degraded: false,
      candidates,
    };
  }
  return { ref: firstParent(deps), degraded: true, candidates };
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

function runtimeOptions(
  options: BaselineDebtAccountingGitOptions,
): Required<BaselineDebtAccountingGitOptions> {
  return {
    currentSource: options.currentSource ?? "worktree",
    baseRefCandidates: options.baseRefCandidates ?? BASE_REF_CANDIDATES,
  };
}

function currentFileText(
  path: string,
  source: "index" | "worktree",
  deps: BaselineDebtAccountingGitDeps,
): string | undefined {
  return source === "index" ? gitFileText("", path, deps) : readCurrentFile(path, deps);
}

function warnOnDegradedBase(base: ComparableBase): void {
  if (!base.degraded) return;
  const fallback =
    base.ref === undefined ? "no HEAD^ fallback is available" : "falling back to HEAD^";
  console.error(
    `lint:ratchet:check-debt-accounting WARN - configured base refs are unavailable (${base.candidates.join(", ")}); ${fallback}. Fetch the intended ref or pass --base-ref <ref>.`,
  );
}

function requireCurrentBaseline(
  source: "index" | "worktree",
  deps: BaselineDebtAccountingGitDeps,
): string {
  const path = source === "index" ? BASELINE_FILENAME : baselinePath;
  const text = currentFileText(path, source, deps);
  if (text !== undefined) return text;
  throw new ConfigError(
    source === "index"
      ? `${BASELINE_FILENAME} is absent from the staged index`
      : `${BASELINE_FILENAME} does not exist; run bun run lint:ratchet:update`,
  );
}

export function runBaselineDebtAccountingCheck(
  deps: BaselineDebtAccountingGitDeps = defaultBaselineDebtAccountingGitDeps,
  options: BaselineDebtAccountingGitOptions = {},
): void {
  const resolvedOptions = runtimeOptions(options);
  const base = comparableBaseRef(resolvedOptions.baseRefCandidates, deps);
  warnOnDegradedBase(base);
  const baseRef = base.ref;
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
  const currentBaselineText = requireCurrentBaseline(resolvedOptions.currentSource, deps);
  const result = checkBaselineDebtAccounting({
    baseBaselineText,
    currentBaselineText,
    baseDebtLogText: gitFileText(baseRef, DEBT_LOG_FILENAME, deps) ?? "",
    currentDebtLogText:
      currentFileText(
        resolvedOptions.currentSource === "index" ? DEBT_LOG_FILENAME : debtLogPath,
        resolvedOptions.currentSource,
        deps,
      ) ?? "",
  });
  if (result.failures.length > 0) {
    throw new WorseBaselineError(formatBaselineDebtAccountingFailures(result.failures));
  }
  console.error(
    `lint:ratchet:check-debt-accounting OK - ${String(result.increases.length)} baseline increase(s) accounted against ${baseRef.slice(0, SHORT_SHA_LENGTH)}.`,
  );
}
