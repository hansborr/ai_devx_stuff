import type { HarnessDiagnostics } from "../../packages/shared/src/schemas/harness-diagnostics.js";
import {
  harnessDiagnosticsOutputPath,
  renderHarnessDiagnosticsEnvelope,
} from "../harness/harness-diagnostics-output.js";
import { ensureDirWriteFileAtomicallySync } from "../lib/atomic-write.js";

function writeHarnessDiagnosticsOutputFile(renderedEnvelope: string): void {
  const outputPath = harnessDiagnosticsOutputPath();
  if (outputPath === undefined) return;
  ensureDirWriteFileAtomicallySync(outputPath, renderedEnvelope);
}

export function emitHarnessDiagnosticsEnvelope(envelope: HarnessDiagnostics): void {
  const renderedEnvelope = renderHarnessDiagnosticsEnvelope(envelope);
  process.stdout.write(renderedEnvelope);
  writeHarnessDiagnosticsOutputFile(renderedEnvelope);
}
