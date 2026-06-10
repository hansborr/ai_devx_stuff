// Coverage artifact orchestration: turn configured artifact descriptors into
// per-artifact evidence. This is the consume-don't-run boundary: drift never
// runs coverage commands; it reads whatever artifacts the config points at.
// `buildCoverageArtifactEvidence` is pure (content in, evidence out) and carries
// the parser-dispatch + empty/unsupported handling; `readCoverageArtifacts` is
// the thin IO wrapper that resolves paths, stats for a timestamp, reads, and
// records read failures as evidence rather than throwing. Artifact sources are
// never merged: one descriptor in, one evidence row out, in configured order.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { DriftAiCoverageArtifactConfig } from "./config.js";
import { parseLcov } from "./coverage-lcov.js";
import type { CoverageArtifactEvidence, CoverageFormat } from "./coverage-types.js";

export type ReadCoverageArtifactsOptions = {
  readonly repoRoot: string;
  readonly artifacts: readonly DriftAiCoverageArtifactConfig[];
};

export type BuildCoverageArtifactEvidenceInput = {
  readonly path: string;
  readonly label: string;
  readonly content: string;
  readonly format: CoverageFormat | null;
  readonly timestamp: string | null;
};

// Detect the artifact format from its filename. lcov reports use the `.info`
// extension by convention (`lcov.info`); everything else is unsupported for now.
export function detectCoverageFormat(artifactPath: string): CoverageFormat | null {
  return artifactPath.toLowerCase().endsWith(".info") ? "lcov" : null;
}

export function buildCoverageArtifactEvidence(
  input: BuildCoverageArtifactEvidenceInput,
): CoverageArtifactEvidence {
  const base = { path: input.path, label: input.label, timestamp: input.timestamp };
  if (input.format === null) {
    return {
      ...base,
      format: null,
      files: [],
      notes: [
        {
          kind: "unsupported-format",
          detail: `no parser for artifact '${input.path}'; only lcov (.info) is supported`,
        },
      ],
    };
  }
  if (input.content.trim().length === 0) {
    return {
      ...base,
      format: input.format,
      files: [],
      notes: [{ kind: "empty-artifact", detail: `artifact '${input.path}' is empty` }],
    };
  }
  const parsed = parseLcov(input.content);
  return { ...base, format: input.format, files: parsed.files, notes: parsed.notes };
}

export function readCoverageArtifacts(
  options: ReadCoverageArtifactsOptions,
): CoverageArtifactEvidence[] {
  return options.artifacts.map((artifact) => readArtifact(options.repoRoot, artifact));
}

function readArtifact(
  repoRoot: string,
  artifact: DriftAiCoverageArtifactConfig,
): CoverageArtifactEvidence {
  const resolved = path.resolve(repoRoot, artifact.path);
  const timestamp = readMtime(resolved);
  let content: string;
  try {
    content = readFileSync(resolved, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      path: artifact.path,
      label: artifact.label,
      format: null,
      timestamp,
      files: [],
      notes: [
        { kind: "read-failure", detail: `could not read artifact '${artifact.path}': ${message}` },
      ],
    };
  }
  return buildCoverageArtifactEvidence({
    path: artifact.path,
    label: artifact.label,
    content,
    format: detectCoverageFormat(artifact.path),
    timestamp,
  });
}

function readMtime(resolved: string): string | null {
  try {
    return new Date(statSync(resolved).mtimeMs).toISOString();
  } catch {
    return null;
  }
}
