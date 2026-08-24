import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { renderMergeDriverBootstrap } from "./bootstrap.js";
import { renderLintRatchetConflictRecovery } from "./conflict-recovery.js";
import type { LintRatchetGitRailAdapter } from "./executable-config.js";
import { gitOutput, runCommand, tryGitOutput } from "./git-command.js";
import { renderBaselineMergeAttributes } from "./info-attributes.js";

const DRIVER_NAME = "lint-ratchet-baseline";
const INSTALLED_DRIVER_RELATIVE_PATH = "musi/lint-ratchet-merge-driver.sh";
const MANAGED_BEGIN = "# BEGIN musi lint-ratchet baseline driver attributes";
const MANAGED_END = "# END musi lint-ratchet baseline driver attributes";
const EXECUTABLE_MODE = 0o755;

function gitCommonDirectory(repoRoot: string): string {
  const common = gitOutput(repoRoot, ["rev-parse", "--git-common-dir"]);
  return isAbsolute(common) ? common : resolve(repoRoot, common);
}

function driverCommand(): string {
  return `bash -c 'set -e; driver="$(git rev-parse --git-common-dir)/${INSTALLED_DRIVER_RELATIVE_PATH}"; exec bash "$driver" "$@"' lint-ratchet-baseline-merge-driver %O %A %B %L %P`;
}

function readOptional(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function writeAtomically(path: string, contents: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, contents, mode === undefined ? undefined : { mode });
  renameSync(temporary, path);
}

function managedAttributes(adapter: LintRatchetGitRailAdapter): string {
  return `/${adapter.debtLogFile} merge=union\n/${adapter.baselineFile} merge=${DRIVER_NAME}`;
}

function desiredBootstrap(adapter: LintRatchetGitRailAdapter, adapterModule: string): string {
  return renderMergeDriverBootstrap(
    adapterModule,
    adapter.executableModuleSpecifier,
    renderLintRatchetConflictRecovery(adapter.baselineFile, adapter.workflowVocabulary),
  );
}

function executableResolves(adapter: LintRatchetGitRailAdapter): boolean {
  const expression = `await import(${JSON.stringify(adapter.executableModuleSpecifier)})`;
  return runCommand(process.execPath, ["-e", expression], adapter.binding.repoRoot).status === 0;
}

function renderedAttributes(
  adapter: LintRatchetGitRailAdapter,
  current: string | undefined,
): string {
  return renderBaselineMergeAttributes({
    currentAttributes: current,
    managedBegin: MANAGED_BEGIN,
    managedEnd: MANAGED_END,
    managedAttributes: managedAttributes(adapter),
  });
}

export function lintRatchetMergeDriverLockPath(repoRoot: string): string {
  const lockPath = join(
    gitCommonDirectory(repoRoot),
    "musi",
    "baseline-merge-driver-attributes.lock",
  );
  mkdirSync(dirname(lockPath), { recursive: true });
  return lockPath;
}

export function installLintRatchetMergeDriver(
  adapter: LintRatchetGitRailAdapter,
  adapterModule: string,
): boolean {
  const repoRoot = adapter.binding.repoRoot;
  const commonDirectory = gitCommonDirectory(repoRoot);
  const installedDriver = join(commonDirectory, INSTALLED_DRIVER_RELATIVE_PATH);
  const desiredDriver = desiredBootstrap(adapter, adapterModule);
  let changed = false;
  if (readOptional(installedDriver) !== desiredDriver) {
    writeAtomically(installedDriver, desiredDriver, EXECUTABLE_MODE);
    changed = true;
  }

  const desiredConfig = new Map([
    [`merge.${DRIVER_NAME}.name`, "lint ratchet baseline regeneration guidance"],
    [`merge.${DRIVER_NAME}.driver`, driverCommand()],
    [`merge.${DRIVER_NAME}.recursive`, "binary"],
  ]);
  for (const [key, desired] of desiredConfig) {
    if (tryGitOutput(repoRoot, ["config", "--local", "--get", key]) === desired) continue;
    const write = runCommand("git", ["config", "--local", key, desired], repoRoot);
    if (write.status !== 0) throw new Error(write.stderr.trim() || `could not write ${key}`);
    changed = true;
  }

  const attributesPath = gitOutput(repoRoot, ["rev-parse", "--git-path", "info/attributes"]);
  const absoluteAttributes = isAbsolute(attributesPath)
    ? attributesPath
    : resolve(repoRoot, attributesPath);
  const currentAttributes = readOptional(absoluteAttributes);
  const desiredAttributes = renderedAttributes(adapter, currentAttributes);
  if (currentAttributes !== desiredAttributes) {
    writeAtomically(absoluteAttributes, desiredAttributes);
    changed = true;
  }
  return changed;
}

export function checkLintRatchetMergeDriver(
  adapter: LintRatchetGitRailAdapter,
  adapterModule: string,
): boolean {
  try {
    const repoRoot = adapter.binding.repoRoot;
    if (!executableResolves(adapter)) return false;
    const commonDirectory = gitCommonDirectory(repoRoot);
    const installedDriver = join(commonDirectory, INSTALLED_DRIVER_RELATIVE_PATH);
    if (readOptional(installedDriver) !== desiredBootstrap(adapter, adapterModule)) return false;
    if (
      tryGitOutput(repoRoot, ["config", "--local", "--get", `merge.${DRIVER_NAME}.driver`]) !==
      driverCommand()
    ) {
      return false;
    }
    if (
      tryGitOutput(repoRoot, ["config", "--local", "--get", `merge.${DRIVER_NAME}.recursive`]) !==
      "binary"
    ) {
      return false;
    }
    const attributesPath = gitOutput(repoRoot, ["rev-parse", "--git-path", "info/attributes"]);
    const absoluteAttributes = isAbsolute(attributesPath)
      ? attributesPath
      : resolve(repoRoot, attributesPath);
    const current = readOptional(absoluteAttributes);
    return current !== undefined && current === renderedAttributes(adapter, current);
  } catch {
    return false;
  }
}
