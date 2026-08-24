import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  type LintRatchetGitRailAdapter,
  lintRatchetGitRailAdapterSchema,
  repoRelativeAdapterPath,
} from "./executable-config.js";
import {
  checkLintRatchetMergeDriver,
  installLintRatchetMergeDriver,
  lintRatchetMergeDriverLockPath,
} from "./executable-install.js";
import {
  mergeLintRatchetBaseline,
  postMergeLintRatchetBaseline,
  preflightLintRatchetBaseline,
  restoreGeneratedBaselineStage,
} from "./executable-operations.js";
import { gitOutput, runCommand } from "./git-command.js";

const ADAPTER_EXPORT = "lintRatchetGitRailAdapter";
const OPTION_WITH_VALUE_WIDTH = 2;
const USAGE_ERROR_EXIT_CODE = 2;
const USAGE = `usage: lint-ratchet-git-rail <install|check|merge|preflight|post-merge|restore-stage> [options]
  install|check|merge|preflight|post-merge --adapter <repo-relative-module> [--repair-command <command>]
  restore-stage --allow-baseline <path>... [--usage-command <command>] -- --ours|--theirs <path>`;

interface ParsedAdapterArgs {
  readonly adapterModule: string;
  readonly rest: readonly string[];
}

function parseAdapterArgs(argv: readonly string[]): ParsedAdapterArgs {
  const adapterIndex = argv.indexOf("--adapter");
  const adapterModule = argv[adapterIndex + 1];
  if (adapterIndex < 0 || adapterModule === undefined || adapterModule.startsWith("--")) {
    throw new Error(`--adapter requires a repository-relative module path\n${USAGE}`);
  }
  const repairIndex = argv.indexOf("--repair-command");
  const repairCommand = argv[repairIndex + 1];
  if (repairIndex >= 0 && (repairCommand === undefined || repairCommand.startsWith("--"))) {
    throw new Error(`--repair-command requires a command\n${USAGE}`);
  }
  return {
    adapterModule,
    rest: argv.filter(
      (_, index) =>
        index !== adapterIndex &&
        index !== adapterIndex + 1 &&
        (repairIndex < 0 || (index !== repairIndex && index !== repairIndex + 1)),
    ),
  };
}

function repositoryRoot(): string {
  return gitOutput(process.cwd(), ["rev-parse", "--show-toplevel"]);
}

async function loadAdapter(parsed: ParsedAdapterArgs): Promise<{
  readonly adapter: LintRatchetGitRailAdapter;
  readonly adapterModule: string;
}> {
  const repoRoot = repositoryRoot();
  const absolute = isAbsolute(parsed.adapterModule)
    ? parsed.adapterModule
    : resolve(repoRoot, parsed.adapterModule);
  if (!existsSync(absolute)) throw new Error(`git-rail adapter module not found: ${absolute}`);
  const loaded: unknown = await import(pathToFileURL(absolute).href);
  const candidate =
    typeof loaded === "object" && loaded !== null && ADAPTER_EXPORT in loaded
      ? loaded[ADAPTER_EXPORT]
      : undefined;
  const adapter = lintRatchetGitRailAdapterSchema.parse(candidate);
  if (resolve(adapter.binding.repoRoot) !== resolve(repoRoot)) {
    throw new Error(
      `git-rail adapter repoRoot does not match the active worktree: ${adapter.binding.repoRoot}`,
    );
  }
  return { adapter, adapterModule: repoRelativeAdapterPath(repoRoot, absolute) };
}

function repairWarning(
  installCommand: string = "lint-ratchet-git-rail install --adapter <module>",
): string {
  return `WARN: lint-ratchet merge driver is missing or stale - run ${installCommand}`;
}

function requestedRepairCommand(args: readonly string[]): string | undefined {
  const index = args.indexOf("--repair-command");
  const value = args[index + 1];
  return index >= 0 && value !== undefined && !value.startsWith("--") ? value : undefined;
}

async function install(parsed: ParsedAdapterArgs, locked: boolean): Promise<number> {
  const loaded = await loadAdapter(parsed);
  if (!locked) {
    const lockPath = lintRatchetMergeDriverLockPath(loaded.adapter.binding.repoRoot);
    const child = runCommand(
      "flock",
      [
        lockPath,
        process.execPath,
        "-e",
        `import(${JSON.stringify(loaded.adapter.executableModuleSpecifier)}).then(module => module.runLintRatchetGitRailCliMain(process.argv.slice(1)))`,
        "--",
        "_install",
        "--adapter",
        loaded.adapterModule,
      ],
      loaded.adapter.binding.repoRoot,
    );
    if (child.status !== 0) throw new Error(child.stderr.trim() || "could not install under flock");
    if (child.stdout !== "") process.stdout.write(child.stdout);
    return 0;
  }
  if (installLintRatchetMergeDriver(loaded.adapter, loaded.adapterModule)) {
    console.log("lint-ratchet merge driver installed.");
  }
  return 0;
}

async function check(parsed: ParsedAdapterArgs): Promise<number> {
  const loaded = await loadAdapter(parsed);
  if (checkLintRatchetMergeDriver(loaded.adapter, loaded.adapterModule)) {
    console.log("PASS: lint-ratchet merge driver is installed and current");
  } else {
    console.log(repairWarning(loaded.adapter.workflowVocabulary.installMergeDriverCommand));
  }
  return 0;
}

function withoutSeparator(argv: readonly string[]): readonly string[] {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

function parseTruthUpContext(rest: readonly string[]): "post-merge" | "post-commit" {
  const contextArguments = rest.filter((argument) => argument !== "--full");
  const [candidate, unexpected] = contextArguments;
  if (
    unexpected !== undefined ||
    (candidate !== undefined && candidate !== "post-merge" && candidate !== "post-commit")
  ) {
    throw new Error(
      `post-merge context must be exactly post-merge or post-commit: ${contextArguments.join(" ")}`,
    );
  }
  return candidate ?? "post-merge";
}

async function adapterCommand(command: string, argv: readonly string[]): Promise<number> {
  const parsed = parseAdapterArgs(argv);
  const rest = withoutSeparator(parsed.rest);
  const context = command === "post-merge" ? parseTruthUpContext(rest) : "post-merge";
  const loaded = await loadAdapter(parsed);
  switch (command) {
    case "merge":
      return mergeLintRatchetBaseline(loaded.adapter, rest);
    case "_merge":
      return mergeLintRatchetBaseline(loaded.adapter, rest, false);
    case "preflight":
      return preflightLintRatchetBaseline(loaded.adapter) ? 0 : 1;
    case "post-merge": {
      postMergeLintRatchetBaseline(loaded.adapter, context, rest.includes("--full"));
      return 0;
    }
    default:
      throw new Error(`unknown adapter command: ${command}`);
  }
}

function parseRestoreOptions(argv: readonly string[]): {
  readonly allowed: readonly string[];
  readonly usageCommand: string;
  readonly rest: readonly string[];
} {
  const allowed: string[] = [];
  let usageCommand = "lint-ratchet-git-rail restore-stage --";
  let index = 0;
  while (argv[index] === "--allow-baseline" || argv[index] === "--usage-command") {
    const option = argv[index];
    if (option === undefined) break;
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${option} requires a value`);
    if (option === "--allow-baseline") allowed.push(value);
    else usageCommand = value;
    index += OPTION_WITH_VALUE_WIDTH;
  }
  return { allowed, usageCommand, rest: withoutSeparator(argv.slice(index)) };
}

function restore(argv: readonly string[]): number {
  const { allowed, usageCommand, rest } = parseRestoreOptions(argv);
  const [side, baseline, unexpected] = rest;
  if (
    (side !== "--ours" && side !== "--theirs") ||
    baseline === undefined ||
    unexpected !== undefined
  ) {
    console.error(restoreUsage(allowed, usageCommand));
    return USAGE_ERROR_EXIT_CODE;
  }
  if (!allowed.includes(baseline)) {
    console.error(`baseline:restore-stage: unsupported path: ${baseline}`);
    console.error(restoreUsage(allowed, usageCommand));
    return USAGE_ERROR_EXIT_CODE;
  }
  restoreGeneratedBaselineStage({
    repoRoot: repositoryRoot(),
    side,
    baseline,
  });
  return 0;
}

function restoreUsage(allowed: readonly string[], usageCommand: string): string {
  return `usage: ${usageCommand} --ours|--theirs <baseline>
  configured generated baselines: ${allowed.join(", ")}`;
}

async function runLintRatchetGitRailCli(args: readonly string[]): Promise<number> {
  const [command, ...argv] = args;
  if (command === "install") return install(parseAdapterArgs(argv), false);
  if (command === "_install") return install(parseAdapterArgs(argv), true);
  if (command === "check") return check(parseAdapterArgs(argv));
  if (command === "restore-stage") return restore(argv);
  if (
    command === "merge" ||
    command === "_merge" ||
    command === "preflight" ||
    command === "post-merge"
  ) {
    return adapterCommand(command, argv);
  }
  throw new Error(USAGE);
}

export async function runLintRatchetGitRailCliMain(args: readonly string[]): Promise<void> {
  try {
    process.exitCode = await runLintRatchetGitRailCli(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const repairCommand = requestedRepairCommand(args.slice(1));
    if (args[0] === "install") {
      console.error(
        `lint-ratchet merge driver install: WARN: ${message}; ${repairWarning(repairCommand)}`,
      );
      process.exitCode = 0;
    } else if (args[0] === "check") {
      console.log(repairWarning(repairCommand));
      console.error(message);
      process.exitCode = 0;
    } else {
      console.error(message);
      process.exitCode = 1;
    }
  }
}
