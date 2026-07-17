#!/usr/bin/env bun
// Report-only AI drift sensors. The executable surface stays here; detector
// and report internals live in focused modules under `scripts/drift-ai/`.

import { pathToFileURL } from "node:url";

import { runDriftAi } from "./drift-ai/runner.js";

export { ALL_CHECKS, DEFAULT_CHECKS } from "./drift-ai/check-metadata.js";
export { CHECK_PLUGINS } from "./drift-ai/check-registry.js";
export { buildChunkManifest, groupFindingsForChunks } from "./drift-ai/chunks.js";
export { parseArgs } from "./drift-ai/cli-args.js";
export {
  type ColdspotsRunOptions,
  type ColdspotsRunResult,
  runColdspots,
} from "./drift-ai/coldspots.js";
export {
  COLDSPOT_LENS_SELECTIONS,
  type ConcreteColdspotLens,
  parseColdspotsArgs,
  type ParsedColdspotsArgs,
} from "./drift-ai/coldspots-args.js";
export { blameLineIntroductions, type LineIntroduction } from "./drift-ai/coldspots-blame.js";
export { reduceColdspot, type ReduceColdspotOptions } from "./drift-ai/coldspots-coldspot.js";
export {
  type ColdspotAmplifier,
  type ColdspotAmplifierKind,
  type ColdspotLens,
  type ColdspotRow,
  type ColdspotsAdvisory,
  type ColdspotSection,
  type ColdspotsSection,
  type ColdspotThresholds,
  formatColdspotsJson,
  formatColdspotsText,
  type StaleMarkerOrigin,
  type StaleMarkerRow,
  type StaleMarkerSection,
} from "./drift-ai/coldspots-format.js";
export {
  scanStaleMarkers,
  STALE_MARKER_KINDS,
  type StaleMarker,
  type StaleMarkerKind,
} from "./drift-ai/coldspots-markers.js";
export {
  DEFAULT_STALE_MARKER_AGE_THRESHOLD_DAYS,
  reduceStaleMarkers,
  type ReduceStaleMarkersOptions,
} from "./drift-ai/coldspots-stale-markers.js";
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
export {
  type HotspotsRunOptions,
  type HotspotsRunResult,
  runHotspots,
} from "./drift-ai/hotspots.js";
export {
  type ChurnHotspot,
  type ChurnSection,
  type CouplingHotspot,
  type CouplingSection,
  formatHotspotsJson,
  formatHotspotsText,
  type FragmentationHotspot,
  type FragmentationSection,
  type HotspotAuthor,
  type HotspotBaselineDelta,
  type HotspotLens,
  type HotspotsAdvisory,
  type HotspotSection,
  type SuppressionChurnHotspot,
  type SuppressionChurnSection,
  type ThrashHotspot,
  type ThrashSection,
} from "./drift-ai/hotspots-format.js";
export {
  type CollectedHistory,
  collectHistory,
  type CommitFileChange,
  type CommitRecord,
  defaultHistoryGitRunner,
  GIT_LOG_FORMAT,
  parseGitLog,
} from "./drift-ai/hotspots-history.js";
export { buildInventoryByDir } from "./drift-ai/inventory-by-dir.js";
export { buildReport, type Clock } from "./drift-ai/report-builder.js";
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
export {
  parseSubcommandArgs,
  type SubcommandBaseOptions,
  type SubcommandFormat,
  writeSubcommandOutput,
} from "./drift-ai/subcommand-args.js";
export type {
  ChangedFile,
  ChangedFileStatus,
  CheckTiming,
  CliOptions,
  ConfigSource,
  DriftCheckId,
  DriftChunkManifest,
  DriftFinding,
  DriftFindingChunk,
  DriftReport,
  DriftReportSummary,
  FindingProvenance,
  SkippedDriftCheck,
  SkipReasonCode,
} from "./drift-ai/types.js";
export {
  DEFAULT_BASE,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_IGNORE_EXTENSIONS,
  DEFAULT_IGNORE_FILES,
  DEFAULT_SCOPE_MODE,
  DRIFT_SCHEMA_VERSION,
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
