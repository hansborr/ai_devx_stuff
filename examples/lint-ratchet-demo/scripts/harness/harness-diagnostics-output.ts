import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";

const JSON_INDENT_SPACES = 2;

/**
 * Env var naming the file a harness-diagnostics envelope should be written to.
 * A harness orchestrator sets this once so every diagnostics-capable tool
 * writes its envelope to a known sidecar path. `lint:ratchet` reads the same
 * variable through its own stdout-plus-sidecar writer in
 * `output.ts`; this helper is the sidecar-only variant for tools
 * whose native stdout is already their report surface.
 */
export const HARNESS_DIAGNOSTICS_OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT";

/** Render an envelope the way every harness-diagnostics writer renders it. */
export function renderHarnessDiagnosticsEnvelope(envelope: HarnessDiagnostics): string {
  return `${JSON.stringify(envelope, null, JSON_INDENT_SPACES)}\n`;
}

/**
 * The sidecar path from `HARNESS_DIAGNOSTICS_OUTPUT`, or `undefined` when the
 * env var is unset or empty — both mean "do not write a sidecar".
 */
export function harnessDiagnosticsOutputPath(): string | undefined {
  const outputPath = process.env[HARNESS_DIAGNOSTICS_OUTPUT_ENV];
  return outputPath === undefined || outputPath.length === 0 ? undefined : outputPath;
}

/**
 * Sidecar-only diagnostics writer for tools whose native stdout is their own
 * report surface (`drift:ai`, `logs:audit`). When `HARNESS_DIAGNOSTICS_OUTPUT`
 * is unset or empty this is a no-op. Otherwise it validates the envelope
 * against the shared schema, creates the parent directory, and writes only the
 * sidecar file — it never touches stdout. Validation and write failures throw
 * so the caller can route them through its usage/tool-failure path rather than
 * reporting them as findings.
 */
export function writeHarnessDiagnosticsSidecar(envelope: HarnessDiagnostics): void {
  const outputPath = harnessDiagnosticsOutputPath();
  if (outputPath === undefined) return;

  const validated = harnessDiagnosticsSchema.safeParse(envelope);
  if (!validated.success) {
    const issues = JSON.stringify(validated.error.issues, null, JSON_INDENT_SPACES);
    throw new Error(`harness diagnostics sidecar received an invalid envelope:\n${issues}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderHarnessDiagnosticsEnvelope(validated.data));
}
