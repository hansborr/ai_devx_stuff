import type { DriftAiCommandResult } from "./command-result.js";
import { readCoverageArtifacts } from "./coverage-artifacts.js";
import type { CoverageArtifactEvidence } from "./coverage-types.js";
import {
  correlateCoverageUnusedExports,
  type CoverageUnusedCorrelationResult,
} from "./coverage-unused-correlation.js";
import {
  buildCoverageUnusedCorrelationAdvisory,
  formatCoverageUnusedCorrelationJson,
  formatCoverageUnusedCorrelationText,
} from "./coverage-unused-correlation-advisory.js";
import {
  parseCoverageUnusedArgs,
  type ParsedCoverageUnusedArgs,
} from "./coverage-unused-correlation-args.js";
import type { GitRunner } from "./git-changed-scope.js";
import { loadKnipUnusedExportsReport } from "./knip-unused-exports-report.js";
import {
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  resolvePrototypeConfig,
  runPrototypeCommand,
} from "./prototype-command.js";
import type { ReportWriter } from "./report-output.js";

export type CoverageUnusedCorrelationRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly writer?: ReportWriter;
};

export type CoverageUnusedCorrelationRunResult = DriftAiCommandResult;

export function runCoverageUnusedCorrelation(
  options: CoverageUnusedCorrelationRunOptions,
): CoverageUnusedCorrelationRunResult {
  return runPrototypeCommand(options, {
    parse: parseCoverageUnusedArgs,
    run: runParsed,
  });
}

function runParsed(
  options: CoverageUnusedCorrelationRunOptions,
  parsed: ParsedCoverageUnusedArgs,
): CoverageUnusedCorrelationRunResult {
  const resolved = resolvePrototypeConfig(options, parsed.base.configPath);
  const artifacts = readCoverageArtifacts({
    repoRoot: resolved.repoRoot,
    artifacts: resolved.config.coverage.artifacts,
  });
  const report = loadKnipUnusedExportsReport(resolved.repoRoot, parsed.reportPath);
  const result = correlate(report, artifacts);
  const advisory = buildCoverageUnusedCorrelationAdvisory({
    report: report.status,
    artifactCount: artifacts.length,
    coverageDegradations: coverageDegradations(artifacts),
    result,
    top: parsed.top,
  });
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatCoverageUnusedCorrelationJson,
      text: formatCoverageUnusedCorrelationText,
    }),
    options.writer,
  );
}

function correlate(
  report: ReturnType<typeof loadKnipUnusedExportsReport>,
  artifacts: readonly CoverageArtifactEvidence[],
): CoverageUnusedCorrelationResult {
  return correlateCoverageUnusedExports(report.symbols, artifacts);
}

function coverageDegradations(artifacts: readonly CoverageArtifactEvidence[]): string[] {
  return artifacts.flatMap((artifact) =>
    artifact.notes.map((note) => {
      const where = note.line === undefined ? "" : ` line ${note.line}`;
      return `${artifact.label} ${artifact.path}: ${note.kind}${where} - ${note.detail}`;
    }),
  );
}
