#!/usr/bin/env bun
// Report-only AI drift sensors. The executable surface stays here; detector
// and report internals live in focused modules under `scripts/drift-ai/`.

import { pathToFileURL } from "node:url";

import { runDriftAi } from "./drift-ai/runner.js";

export { buildChunkManifest, groupFindingsForChunks } from "./drift-ai/chunks.js";
export { parseArgs } from "./drift-ai/cli-args.js";
export { DriftAiError } from "./drift-ai/errors.js";
export type { GitRunner } from "./drift-ai/git-changed-scope.js";
export {
  defaultGitRunner,
  discoverChangedFiles,
  filterScope,
  isIgnoredPath,
  parseNameStatus,
  resolveBaseRef,
  resolveMergeBase,
  resolveRepoRoot,
} from "./drift-ai/git-changed-scope.js";
export { buildInventoryByDir } from "./drift-ai/inventory-by-dir.js";
export { buildReport, type CheckContext } from "./drift-ai/report-builder.js";
export { formatJson, formatText } from "./drift-ai/report-format.js";
export type { RunOptions, RunResult } from "./drift-ai/runner.js";
export { runDriftAi } from "./drift-ai/runner.js";
export type {
  ChangedScopeFile,
  CurrentScopeFile,
  DetectorScope,
  ScopeFile,
  ScopeMode,
} from "./drift-ai/scope.js";
export {
  buildSourceExtensions,
  BUILT_IN_SOURCE_EXTENSIONS,
  toChangedScopeFile,
  toCurrentScopeFile,
} from "./drift-ai/scope.js";
export type {
  ChangedFile,
  ChangedFileStatus,
  CliOptions,
  DriftCheckId,
  DriftChunkManifest,
  DriftChunkManifestEntry,
  DriftFinding,
  DriftFindingChunk,
  DriftReport,
} from "./drift-ai/types.js";
export {
  ALL_CHECKS,
  DEFAULT_BASE,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_IGNORE_DIR_PREFIXES,
  DEFAULT_IGNORE_EXTENSIONS,
  DEFAULT_IGNORE_FILES,
  DEFAULT_SCOPE_MODE,
} from "./drift-ai/types.js";

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runDriftAi({ argv: process.argv.slice(2) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
