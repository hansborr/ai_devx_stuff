import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { HarnessDiagnostics } from "../../packages/shared/src/schemas/harness-diagnostics.js";

export const HARNESS_DIAGNOSTICS_OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT";
const JSON_INDENT_SPACES = 2;

function formatHarnessDiagnosticsEnvelope(envelope: HarnessDiagnostics): string {
  return `${JSON.stringify(envelope, null, JSON_INDENT_SPACES)}\n`;
}

function harnessDiagnosticsOutputPath(): string | undefined {
  const outputPath = process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV];
  return outputPath === undefined || outputPath.length === 0 ? undefined : outputPath;
}

function writeHarnessDiagnosticsOutputFile(renderedEnvelope: string): void {
  const outputPath = harnessDiagnosticsOutputPath();
  if (outputPath === undefined) return;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderedEnvelope);
}

export function emitHarnessDiagnosticsEnvelope(envelope: HarnessDiagnostics): void {
  const renderedEnvelope = formatHarnessDiagnosticsEnvelope(envelope);
  process.stdout.write(renderedEnvelope);
  writeHarnessDiagnosticsOutputFile(renderedEnvelope);
}
