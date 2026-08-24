import { errorMessage } from "../lib/error-message.js";
import { readGitBlobAtRef } from "../lib/git.js";
import { type BirthBlobReader, buildBirthSizeDeltaAdvisory } from "./birth-size-delta-advisory.js";
import { parseBirthSizeDeltaArgs, type ParsedBirthSizeDeltaArgs } from "./birth-size-delta-args.js";
import {
  formatBirthSizeDeltaAdvisoryJson,
  formatBirthSizeDeltaAdvisoryText,
} from "./birth-size-delta-format.js";
import {
  type BoundedHistoryGitRunner,
  defaultBoundedHistoryGitRunner,
} from "./bounded-full-history.js";
import { collectConfiguredBoundedFullHistory } from "./bounded-history-options.js";
import type { DriftAiCommandResult } from "./command-result.js";
import type { DriftAiIgnoreConfig } from "./config.js";
import {
  type BufferGitRunner,
  defaultBufferGitRunner,
  discoverCurrentFiles,
  type StatRunner,
} from "./current-inventory.js";
import type { GitRunner } from "./git-changed-scope.js";
import {
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  resolvePrototypeConfig,
  runPrototypeCommand,
} from "./prototype-command.js";
import { defaultFileReader, type RepoFileReader } from "./repo-io.js";
import type { ReportWriter } from "./report-output.js";
import { buildSourceExtensions } from "./scope.js";

export type BirthSizeDeltaRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly gitBuffer?: BufferGitRunner;
  readonly stat?: StatRunner;
  readonly boundedGit?: BoundedHistoryGitRunner;
  readonly readFile?: RepoFileReader;
  readonly writer?: ReportWriter;
};

export type BirthSizeDeltaRunResult = DriftAiCommandResult;

export function runBirthSizeDelta(options: BirthSizeDeltaRunOptions): BirthSizeDeltaRunResult {
  return runPrototypeCommand(options, {
    parse: parseBirthSizeDeltaArgs,
    run: runParsedBirthSizeDelta,
  });
}

function runParsedBirthSizeDelta(
  options: BirthSizeDeltaRunOptions,
  parsed: ParsedBirthSizeDeltaArgs,
): BirthSizeDeltaRunResult {
  const context = resolveRunContext(options, parsed);
  const history = collectBirthSizeDeltaHistory(parsed, context);
  const advisory = buildBirthSizeDeltaAdvisory({
    history,
    currentFiles: context.currentFiles,
    readCurrentBlob: context.readFile,
    readBirthBlob: birthBlobReader(context.boundedGit, {
      maxOutputBytes: parsed.maxBlobBytes,
      timeoutMs: parsed.blobTimeoutMs,
    }),
    top: parsed.top,
    maxBlobReads: parsed.maxBlobReads,
    blobReadCaps: {
      maxOutputBytes: parsed.maxBlobBytes,
      timeoutMs: parsed.blobTimeoutMs,
    },
  });
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatBirthSizeDeltaAdvisoryJson,
      text: formatBirthSizeDeltaAdvisoryText,
    }),
    options.writer,
  );
}

type BirthSizeDeltaRunContext = {
  readonly boundedGit: BoundedHistoryGitRunner;
  readonly ignore: DriftAiIgnoreConfig;
  readonly currentFiles: readonly string[];
  readonly readFile: RepoFileReader;
};

function resolveRunContext(
  options: BirthSizeDeltaRunOptions,
  parsed: ParsedBirthSizeDeltaArgs,
): BirthSizeDeltaRunContext {
  const resolved = resolvePrototypeConfig(options, parsed.base.configPath);
  const gitBuffer = options.gitBuffer ?? defaultBufferGitRunner({ repoRoot: resolved.repoRoot });
  const currentFiles = discoverCurrentFiles({
    repoRoot: resolved.repoRoot,
    gitBuffer,
    ...(options.stat === undefined ? {} : { stat: options.stat }),
    ignore: resolved.config.ignore,
    sourceExtensions: buildSourceExtensions(resolved.config.additionalSourceExtensions),
    roots: resolved.config.roots,
  }).map((file) => file.path);
  return {
    boundedGit: options.boundedGit ?? defaultBoundedHistoryGitRunner(resolved.repoRoot),
    ignore: resolved.config.ignore,
    currentFiles,
    readFile: options.readFile ?? defaultFileReader(resolved.repoRoot),
  };
}

function collectBirthSizeDeltaHistory(
  parsed: ParsedBirthSizeDeltaArgs,
  context: BirthSizeDeltaRunContext,
): ReturnType<typeof collectConfiguredBoundedFullHistory> {
  return collectConfiguredBoundedFullHistory(parsed, context);
}

function birthBlobReader(
  git: BoundedHistoryGitRunner,
  caps: { readonly maxOutputBytes: number; readonly timeoutMs: number },
): BirthBlobReader {
  return ({ commit, path }) => {
    try {
      return { ok: true, source: readGitBlobAtRef(git, commit, path, caps) };
    } catch (err) {
      return { ok: false, reason: errorMessage(err) };
    }
  };
}
