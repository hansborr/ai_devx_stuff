import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { HarnessDiagnostics } from "../../packages/shared/src/schemas/harness-diagnostics.js";
import {
  harnessDiagnosticsOutputPath,
  renderHarnessDiagnosticsEnvelope,
} from "../harness/harness-diagnostics-output.js";

function writeHarnessDiagnosticsOutputFile(renderedEnvelope: string): void {
  const outputPath = harnessDiagnosticsOutputPath();
  if (outputPath === undefined) return;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderedEnvelope);
}

export function emitHarnessDiagnosticsEnvelope(envelope: HarnessDiagnostics): void {
  const renderedEnvelope = renderHarnessDiagnosticsEnvelope(envelope);
  process.stdout.write(renderedEnvelope);
  writeHarnessDiagnosticsOutputFile(renderedEnvelope);
}
