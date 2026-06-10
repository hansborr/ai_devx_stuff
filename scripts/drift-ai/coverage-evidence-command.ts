import { readCoverageArtifacts } from "./coverage-artifacts.js";
import {
  buildCoverageEvidenceAdvisory,
  formatCoverageEvidenceAdvisoryJson,
  formatCoverageEvidenceAdvisoryText,
} from "./coverage-evidence-advisory.js";
import {
  parseCoverageEvidenceArgs,
  type ParsedCoverageEvidenceArgs,
} from "./coverage-evidence-args.js";
import type { GitRunner } from "./git-changed-scope.js";
import {
  finishPrototypeCommand,
  renderPrototypeAdvisory,
  resolvePrototypeConfig,
  runPrototypeCommand,
} from "./prototype-command.js";
import type { ReportWriter } from "./report-output.js";

export type CoverageEvidenceRunOptions = {
  readonly argv: readonly string[];
  readonly git?: GitRunner;
  readonly writer?: ReportWriter;
};

export type CoverageEvidenceRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function runCoverageEvidence(
  options: CoverageEvidenceRunOptions,
): CoverageEvidenceRunResult {
  return runPrototypeCommand(options, {
    parse: parseCoverageEvidenceArgs,
    run: runParsedCoverageEvidence,
  });
}

function runParsedCoverageEvidence(
  options: CoverageEvidenceRunOptions,
  parsed: ParsedCoverageEvidenceArgs,
): CoverageEvidenceRunResult {
  const resolved = resolvePrototypeConfig(options, parsed.base.configPath);
  const evidence = readCoverageArtifacts({
    repoRoot: resolved.repoRoot,
    artifacts: resolved.config.coverage.artifacts,
  });
  const advisory = buildCoverageEvidenceAdvisory(evidence, { top: parsed.top });
  return finishPrototypeCommand(
    parsed,
    renderPrototypeAdvisory(parsed.base.format, advisory, {
      json: formatCoverageEvidenceAdvisoryJson,
      text: formatCoverageEvidenceAdvisoryText,
    }),
    options.writer,
  );
}
