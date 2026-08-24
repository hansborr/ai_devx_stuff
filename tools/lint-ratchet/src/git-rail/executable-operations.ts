import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { parseLintRatchetBaseline } from "../kernel/baseline.js";
import { mergeLintRatchetBaselines } from "../kernel/baseline-merge.js";
import { buildRuleSourceHashesById } from "../kernel/rule-source.js";
import { renderLintRatchetConflictRecovery } from "./conflict-recovery.js";
import type { LintRatchetGitRailAdapter } from "./executable-config.js";
import { gitOutput, runCommand, tryGitOutput } from "./git-command.js";
import { runMergeDriverCli } from "./merge-cli.js";

const MARKER_RELATIVE_PATH = "musi/lint-ratchet-baseline-postmerge-truth-up-required";

function baselinePath(adapter: LintRatchetGitRailAdapter): string {
  return join(adapter.binding.repoRoot, adapter.baselineFile);
}

export function preflightLintRatchetBaseline(adapter: LintRatchetGitRailAdapter): boolean {
  const parsed = parseLintRatchetBaseline(
    readFileSync(baselinePath(adapter), "utf8"),
    adapter.ratchets,
    buildRuleSourceHashesById(adapter.ratchets, adapter.binding),
    { workflowVocabulary: adapter.workflowVocabulary, baselineFile: adapter.baselineFile },
  );
  if (parsed.baseline !== undefined) return true;
  console.error(parsed.failures.join("\n"));
  return false;
}

export async function mergeLintRatchetBaseline(
  adapter: LintRatchetGitRailAdapter,
  argv: readonly string[],
  renderRecovery: boolean = true,
): Promise<number> {
  const status = await runMergeDriverCli(argv, {
    usage:
      "usage: lint-ratchet-git-rail merge --adapter <module> -- <base> <current> <other> [path] [truth-up-marker] [pre-merge-head]",
    unresolvedFailureLabel: "lint-ratchet baseline semantic merge could not resolve",
    fatalFailureLabel: "lint-ratchet baseline semantic merge failed",
    markerMessage: "lint-ratchet baseline semantic merge requires post-merge truth-up",
    merge: (options) =>
      mergeLintRatchetBaselines({
        ...options,
        workflowVocabulary: adapter.workflowVocabulary,
        baselineFile: adapter.baselineFile,
      }),
  });
  if (status !== 0 && renderRecovery)
    console.error(
      renderLintRatchetConflictRecovery(
        argv[3] ?? adapter.baselineFile,
        adapter.workflowVocabulary,
      ),
    );
  return status;
}

function gitDirectory(repoRoot: string): string {
  const path = gitOutput(repoRoot, ["rev-parse", "--git-dir"]);
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function gitStatePath(repoRoot: string, name: string): string {
  const path = gitOutput(repoRoot, ["rev-parse", "--git-path", name]);
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function markerPath(adapter: LintRatchetGitRailAdapter): string {
  return join(gitDirectory(adapter.binding.repoRoot), MARKER_RELATIVE_PATH);
}

function markerStamp(marker: string): string | undefined {
  return readFileSync(marker, "utf8").match(/^pre-merge-head=(.+)$/mu)?.[1];
}

function markerMatchesFirstParent(adapter: LintRatchetGitRailAdapter, marker: string): boolean {
  const firstParent = tryGitOutput(adapter.binding.repoRoot, ["rev-parse", "--verify", "HEAD^1"]);
  return markerStamp(marker) === firstParent;
}

function isPendingSquashMarker(adapter: LintRatchetGitRailAdapter, marker: string): boolean {
  const head = tryGitOutput(adapter.binding.repoRoot, ["rev-parse", "--verify", "HEAD"]);
  return markerStamp(marker) === head;
}

function shouldDeferSquashTruthUp(
  adapter: LintRatchetGitRailAdapter,
  context: TruthUpContext,
  marker: string,
): boolean {
  return context === "post-merge" && existsSync(marker) && isPendingSquashMarker(adapter, marker);
}

function baselineTouched(adapter: LintRatchetGitRailAdapter, base: string): boolean {
  const result = runCommand(
    "git",
    ["diff", "--name-only", base, "HEAD", "--", adapter.baselineFile],
    adapter.binding.repoRoot,
  );
  return result.status === 0 && result.stdout.split("\n").includes(adapter.baselineFile);
}

function currentMarkerState(
  adapter: LintRatchetGitRailAdapter,
  context: TruthUpContext,
  marker: string,
): boolean {
  if (!existsSync(marker)) return false;
  if (markerMatchesFirstParent(adapter, marker)) return true;
  rmSync(marker, { force: true });
  console.error(`${context}: ignoring stale lint-ratchet truth-up marker`);
  return false;
}

type TruthUpContext = "post-merge" | "post-commit";

function truthUpDiffBase(
  adapter: LintRatchetGitRailAdapter,
  context: TruthUpContext,
  marker: string,
): string | undefined {
  const repoRoot = adapter.binding.repoRoot;
  if (context === "post-merge") {
    return tryGitOutput(repoRoot, ["rev-parse", "--verify", "ORIG_HEAD^{commit}"]);
  }
  if (
    !existsSync(marker) &&
    tryGitOutput(repoRoot, ["rev-parse", "--verify", "HEAD^2"]) === undefined
  ) {
    return undefined;
  }
  return tryGitOutput(repoRoot, ["rev-parse", "--verify", "HEAD^1"]);
}

function reportTruthUpResult(
  adapter: LintRatchetGitRailAdapter,
  context: TruthUpContext,
  marker: string,
  markerPresent: boolean,
): void {
  const OUTPUT_TAIL_LINES = 20;
  console.error(`${context}: lint-ratchet truth-up running (full check-baseline, typically ~20s)…`);
  const [command, ...args] = adapter.checkBaselineCommand;
  const result = runCommand(command, args, adapter.binding.repoRoot);
  if (result.status === 0) {
    if (markerPresent) rmSync(marker, { force: true });
    console.error(`${context}: merged lint-ratchet baseline verified truthful.`);
  } else if (result.status === adapter.worseBaselineExitCode) {
    console.error(
      `${context}: merge produced a stale ratchet baseline - run: ${adapter.workflowVocabulary.updateCommand}, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)`,
    );
  } else {
    console.error(
      `${context}: lint-ratchet truth-up check failed without a staleness verdict; inspect its output (below) and run ${adapter.checkBaselineCommand.join(" ")} manually once the cause is fixed.`,
    );
    console.error(
      result.stderr
        .split("\n")
        .slice(-(OUTPUT_TAIL_LINES + 1))
        .join("\n"),
    );
  }
}

export function postMergeLintRatchetBaseline(
  adapter: LintRatchetGitRailAdapter,
  context: TruthUpContext,
  forceFull: boolean,
): void {
  const marker = markerPath(adapter);
  // `git merge --squash` runs post-merge before creating the squash commit.
  // The driver therefore stamps the still-current HEAD, not a first parent.
  // Leave that marker for post-commit, where the squash commit's HEAD^1 makes
  // it actionable and the authoritative check can consume it.
  if (shouldDeferSquashTruthUp(adapter, context, marker)) return;
  const diffBase = truthUpDiffBase(adapter, context, marker);
  if (diffBase === undefined) return;
  const markerPresent = currentMarkerState(adapter, context, marker);
  if (!markerPresent && !baselineTouched(adapter, diffBase)) return;

  if (!forceFull && !markerPresent) {
    try {
      if (preflightLintRatchetBaseline(adapter)) return;
    } catch (error) {
      // A missing or malformed baseline needs the authoritative full check. The
      // post-merge hook is advisory, so a fast-path parse failure must not stop it.
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `${context}: lint-ratchet preflight unavailable (${message}); running full check.`,
      );
    }
  }
  reportTruthUpResult(adapter, context, marker, markerPresent);
}

function validateRestorePath(repoRoot: string, candidate: string): string {
  const canonicalRoot = realpathSync(repoRoot);
  const lexicalTarget = resolve(repoRoot, candidate);
  const target = join(realpathSync(dirname(lexicalTarget)), basename(lexicalTarget));
  const rel = relative(canonicalRoot, target);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(`baseline:restore-stage: refusing path outside the repository: ${candidate}`);
  }
  if (target !== join(canonicalRoot, candidate)) {
    throw new Error(`baseline:restore-stage: refusing non-canonical path: ${candidate}`);
  }
  return target;
}

export function restoreGeneratedBaselineStage(options: {
  readonly repoRoot: string;
  readonly side: "--ours" | "--theirs";
  readonly baseline: string;
}): void {
  const stage = options.side === "--ours" ? "2" : "3";
  const target = validateRestorePath(options.repoRoot, options.baseline);
  const inProgress = ["MERGE_HEAD", "CHERRY_PICK_HEAD"].some((name) =>
    existsSync(gitStatePath(options.repoRoot, name)),
  );
  const rebaseInProgress = ["rebase-merge", "rebase-apply"].some((name) =>
    existsSync(gitStatePath(options.repoRoot, name)),
  );
  if (!inProgress && !rebaseInProgress) {
    throw new Error(
      `baseline:restore-stage: no merge, cherry-pick, or rebase conflict is in progress
If conflict markers were already committed, restore a parseable parent version first, for example:
  git show HEAD^:${options.baseline} > ${options.baseline}`,
    );
  }
  const blob = runCommand("git", ["show", `:${stage}:${options.baseline}`], options.repoRoot);
  if (blob.status !== 0) {
    throw new Error(
      `baseline:restore-stage: stage ${stage} (${options.side}) is unavailable for ${options.baseline}; confirm the file is still unmerged`,
    );
  }
  // Keep the temporary file beside the destination so rename remains an atomic
  // same-filesystem replacement even when the system temp directory is separate.
  const tempDirectory = mkdtempSync(join(dirname(target), ".lint-ratchet-restore-"));
  const temporary = join(tempDirectory, basename(options.baseline));
  try {
    writeFileSync(temporary, blob.stdout);
    renameSync(temporary, target);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
  console.log(
    `baseline:restore-stage: restored stage ${stage} (${options.side}) to ${options.baseline}`,
  );
}
