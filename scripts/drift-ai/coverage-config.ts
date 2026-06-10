// Parser for the top-level `coverage` config block (tasks 42a-42c). It validates
// the artifact list: each entry a `{ path, label }` pair, and normalizes paths
// to a repo-relative posix form. Coverage paths are NOT containment-checked the
// way source roots are: a coverage artifact may legitimately live outside the
// repo (a CI output dir), and the artifact is read, never written. Labels are
// free text (unit/e2e/smoke/prod) so different runs stay distinguishable.

import type { DriftAiCoverageArtifactConfig, DriftAiCoverageConfig } from "./config.js";
import { collapseRepoPath } from "./config-paths.js";
import { assertConfigObject, assertKnownKeys } from "./config-readers.js";
import { DriftAiError } from "./errors.js";

export function parseCoverageConfig(raw: unknown, keyPath: string): DriftAiCoverageConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["artifacts"], keyPath);
  if (record["artifacts"] === undefined) return { artifacts: [] };
  return { artifacts: parseArtifacts(record["artifacts"], `${keyPath}.artifacts`) };
}

function parseArtifacts(raw: unknown, keyPath: string): DriftAiCoverageArtifactConfig[] {
  if (!Array.isArray(raw)) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be an array.`);
  }
  return raw.map((item, index) => parseArtifact(item, `${keyPath}[${index}]`));
}

function parseArtifact(raw: unknown, keyPath: string): DriftAiCoverageArtifactConfig {
  const record = assertConfigObject(raw, keyPath);
  assertKnownKeys(record, ["path", "label"], keyPath);
  const artifactPath = readNonEmptyString(record["path"], `${keyPath}.path`);
  const label = readNonEmptyString(record["label"], `${keyPath}.label`);
  return { path: collapseRepoPath(artifactPath), label: label.trim() };
}

function readNonEmptyString(raw: unknown, keyPath: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must be a non-empty string.`);
  }
  return raw;
}
