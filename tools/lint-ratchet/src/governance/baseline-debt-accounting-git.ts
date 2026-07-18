import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  type LintRatchetEngineContext,
  relativeToRepoRoot,
} from "@musi/lint-ratchet/kernel/engine-context.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics.js";

import {
  checkBaselineDebtAccounting,
  formatBaselineDebtAccountingFailures,
} from "./baseline-debt-accounting.js";
import { WorseBaselineError } from "./errors.js";

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

// Resolved file locations for one accounting run: the repo-relative paths the
// git object reads (`git show <ref>:<path>`, `git show :<path>`) and the
// absolute worktree paths the filesystem reads, both derived from the engine
// context so the operation carries no repo-bound `paths` import.
interface AccountingPaths {
  readonly repoRoot: string;
  readonly baselineRelPath: string;
  readonly debtLogRelPath: string;
  readonly baselinePath: string;
  readonly debtLogPath: string;
}

function gitOutput(
  repoRoot: string,
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
  repoRoot: string,
  args: readonly string[],
  deps: BaselineDebtAccountingGitDeps,
): string | undefined {
  const output = gitOutput(repoRoot, args, deps)?.trim();
  return output === undefined || output.length === 0 ? undefined : output;
}

function firstParent(repoRoot: string, deps: BaselineDebtAccountingGitDeps): string | undefined {
  return gitSingleLine(repoRoot, ["rev-parse", "HEAD^"], deps);
}

function comparableBaseRef(
  repoRoot: string,
  candidates: readonly string[],
  deps: BaselineDebtAccountingGitDeps,
): ComparableBase {
  const head = gitSingleLine(repoRoot, ["rev-parse", "HEAD"], deps);
  for (const candidate of candidates) {
    const mergeBase = gitSingleLine(repoRoot, ["merge-base", "HEAD", candidate], deps);
    if (mergeBase === undefined) continue;
    return {
      ref: mergeBase === head ? firstParent(repoRoot, deps) : mergeBase,
      degraded: false,
      candidates,
    };
  }
  return { ref: firstParent(repoRoot, deps), degraded: true, candidates };
}

function gitFileText(
  repoRoot: string,
  ref: string,
  path: string,
  deps: BaselineDebtAccountingGitDeps,
): string | undefined {
  return gitOutput(repoRoot, ["show", `${ref}:${path}`], deps);
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

// One file's repo-relative (index-read) and absolute (worktree-read) locations.
interface FileTarget {
  readonly repoRoot: string;
  readonly relPath: string;
  readonly absPath: string;
}

// Read a file's current content for the requested source: the staged index blob
// (`git show :<repo-relative path>`) or the absolute worktree file.
function currentFileText(
  target: FileTarget,
  source: "index" | "worktree",
  deps: BaselineDebtAccountingGitDeps,
): string | undefined {
  return source === "index"
    ? gitFileText(target.repoRoot, "", target.relPath, deps)
    : readCurrentFile(target.absPath, deps);
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
  paths: AccountingPaths,
  source: "index" | "worktree",
  deps: BaselineDebtAccountingGitDeps,
): string {
  const text = currentFileText(
    { repoRoot: paths.repoRoot, relPath: paths.baselineRelPath, absPath: paths.baselinePath },
    source,
    deps,
  );
  if (text !== undefined) return text;
  throw new ConfigError(
    source === "index"
      ? `${paths.baselineRelPath} is absent from the staged index`
      : `${paths.baselineRelPath} does not exist; run bun run lint:ratchet:update`,
  );
}

export function runBaselineDebtAccountingCheck(
  context: LintRatchetEngineContext,
  deps: BaselineDebtAccountingGitDeps = defaultBaselineDebtAccountingGitDeps,
  options: BaselineDebtAccountingGitOptions = {},
): void {
  const paths: AccountingPaths = {
    repoRoot: context.repoRoot,
    baselineRelPath: relativeToRepoRoot(context.repoRoot, context.baselinePath),
    debtLogRelPath: relativeToRepoRoot(context.repoRoot, context.debtLogPath),
    baselinePath: context.baselinePath,
    debtLogPath: context.debtLogPath,
  };
  const resolvedOptions = runtimeOptions(options);
  const base = comparableBaseRef(paths.repoRoot, resolvedOptions.baseRefCandidates, deps);
  warnOnDegradedBase(base);
  const baseRef = base.ref;
  if (baseRef === undefined) {
    console.error("lint:ratchet:check-debt-accounting SKIP - no comparable git base found.");
    return;
  }
  const baseBaselineText = gitFileText(paths.repoRoot, baseRef, paths.baselineRelPath, deps);
  if (baseBaselineText === undefined) {
    console.error(
      `lint:ratchet:check-debt-accounting SKIP - ${paths.baselineRelPath} is absent at ${baseRef.slice(0, SHORT_SHA_LENGTH)}.`,
    );
    return;
  }
  const currentBaselineText = requireCurrentBaseline(paths, resolvedOptions.currentSource, deps);
  const result = checkBaselineDebtAccounting({
    baseBaselineText,
    currentBaselineText,
    baseDebtLogText: gitFileText(paths.repoRoot, baseRef, paths.debtLogRelPath, deps) ?? "",
    currentDebtLogText:
      currentFileText(
        { repoRoot: paths.repoRoot, relPath: paths.debtLogRelPath, absPath: paths.debtLogPath },
        resolvedOptions.currentSource,
        deps,
      ) ?? "",
    baselineDisplayName: paths.baselineRelPath,
    debtLogDisplayName: paths.debtLogRelPath,
  });
  if (result.failures.length > 0) {
    throw new WorseBaselineError(
      formatBaselineDebtAccountingFailures(
        result.failures,
        paths.baselineRelPath,
        paths.debtLogRelPath,
      ),
    );
  }
  console.error(
    `lint:ratchet:check-debt-accounting OK - ${String(result.increases.length)} baseline increase(s) accounted against ${baseRef.slice(0, SHORT_SHA_LENGTH)}.`,
  );
}
