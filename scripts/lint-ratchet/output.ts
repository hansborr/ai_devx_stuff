import { ConfigError } from "@musi/lint-ratchet/kernel/metrics-types.js";

import type { HarnessDiagnostics } from "../../packages/shared/src/schemas/harness-diagnostics.js";
import {
  emitHarnessDiagnostics,
  HarnessDiagnosticsValidationError,
} from "../harness/harness-diagnostics-output.js";

/**
 * `lint:ratchet`'s envelope is both its stdout report and, when the harness
 * asks for one, a sidecar file — the `stdout-and-sidecar` route of the shared
 * emission kernel, which validates the envelope before either write.
 *
 * A malformed envelope is re-raised as `ConfigError` so it keeps exiting 2
 * through the CLI's config-error path instead of crashing as an unhandled
 * error; write failures pass through untouched.
 */
export function emitHarnessDiagnosticsEnvelope(envelope: HarnessDiagnostics): void {
  try {
    emitHarnessDiagnostics(envelope, { mode: "stdout-and-sidecar" }, { source: "lint:ratchet" });
  } catch (error) {
    if (error instanceof HarnessDiagnosticsValidationError) throw new ConfigError(error.message);
    throw error;
  }
}
