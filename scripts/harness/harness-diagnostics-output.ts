// The one harness-diagnostics emission kernel: validate -> route -> atomic
// write. Every producer of a `harness-diagnostics` envelope (`lint:agent`,
// `lint:ratchet`, `harness-emit-envelope`, `drift:ai`, `logs:audit`) routes its
// finished envelope through `emitHarnessDiagnostics` and states one of four
// explicit routing modes, so the contract is validated in exactly one place and
// no producer can invent a fifth routing behavior. The union states the four
// modes and the dispatch in `writeRenderedEnvelope` handles them one arm each
// with a `never` default, so a fifth mode cannot be added without also stating
// where its bytes go.
import { isAbsolute, resolve } from "node:path";

import {
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
} from "@musi/harness-diagnostics/schema.js";

import { ensureDirWriteFileAtomicallySync } from "../lib/atomic-write.js";

const JSON_INDENT_SPACES = 2;

/** Producer label used when a sidecar-only writer hands over a bad envelope. */
const SIDECAR_SOURCE = "harness diagnostics sidecar";

/**
 * Env var naming the file a harness-diagnostics envelope should be written to.
 * A harness orchestrator sets this once so every diagnostics-capable tool
 * writes its envelope to a known sidecar path. `lint:ratchet` reads the same
 * variable through its own stdout-plus-sidecar writer in
 * `output.ts`; this helper is the sidecar-only variant for tools
 * whose native stdout is already their report surface.
 */
export const HARNESS_DIAGNOSTICS_OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT";

/**
 * Render an envelope the way every harness-diagnostics writer renders it.
 *
 * Deliberately module-private: exporting it would re-open a hand-roll path in
 * which a producer renders its own bytes and writes them itself, bypassing the
 * validation gate that is the reason this module exists. Every producer reaches
 * these bytes through {@link emitHarnessDiagnostics}, and the tests pin the
 * rendered bytes as literals rather than by calling this function.
 */
function renderHarnessDiagnosticsEnvelope(envelope: HarnessDiagnostics): string {
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
 * The four routing behaviors a diagnostics producer may ask for. They are
 * stated explicitly rather than inferred so a reader of a call site knows
 * where the envelope lands without tracing env vars:
 *
 * - `stdout-only` — the envelope IS the tool's stdout report.
 * - `sidecar-only` — the tool's native stdout is its own report surface, so the
 *   envelope goes only to the `HARNESS_DIAGNOSTICS_OUTPUT` sidecar (a no-op
 *   when that env var is unset or empty).
 * - `stdout-and-sidecar` — stdout report plus the same bytes in the sidecar.
 * - `output-path` — an operator-named destination (a `--output` flag); relative
 *   paths resolve against the process working directory. Nothing goes to stdout
 *   and the sidecar env var is not consulted.
 */
export type HarnessDiagnosticsRoute =
  | { readonly mode: "stdout-only" }
  | { readonly mode: "sidecar-only" }
  | { readonly mode: "stdout-and-sidecar" }
  | { readonly mode: "output-path"; readonly path: string };

/**
 * How a producer identifies itself in a validation failure message.
 *
 * `source` is a human-facing label and nothing else: it appears only in the
 * `HarnessDiagnosticsValidationError` text and is never written into the
 * envelope or read by a consumer. The convention is to name the thing an
 * operator would go edit, in whichever of these forms is most specific:
 *
 * - the package script or CLI an operator invokes — `lint:agent:local-rules`,
 *   `lint:ratchet`;
 * - the script basename when there is no distinct command name —
 *   `harness-emit-envelope`;
 * - the shared entry point itself when it fronts several producers, because no
 *   single producer name would be true — `harness diagnostics sidecar`, which
 *   {@link writeHarnessDiagnosticsSidecar} passes on behalf of both `drift:ai`
 *   and `logs:audit`.
 *
 * It is deliberately not defaulted to `envelope.tool`. `tool` is the
 * machine-readable schema field consumers key on and is fixed per producer,
 * while `source` may be narrower than the tool (`lint:agent:local-rules` for
 * tool `lint:agent`) or broader than any one tool (the sidecar writer). Reading
 * a `source` in an error message should point at a command, not at a schema
 * enum value.
 */
export interface HarnessDiagnosticsEmitOptions {
  readonly source: string;
}

/**
 * Thrown when an envelope fails `harnessDiagnosticsSchema`. Distinct from a
 * write failure so a producer can map "I built a malformed envelope" onto its
 * own configuration/usage error type without also swallowing IO errors.
 */
export class HarnessDiagnosticsValidationError extends Error {}

function assertValidEnvelope(envelope: HarnessDiagnostics, source: string): void {
  const validated = harnessDiagnosticsSchema.safeParse(envelope);
  if (validated.success) return;
  const issues = JSON.stringify(validated.error.issues, null, JSON_INDENT_SPACES);
  throw new HarnessDiagnosticsValidationError(`${source} produced an invalid envelope:\n${issues}`);
}

function writeSidecarWhenRequested(rendered: string): void {
  const outputPath = harnessDiagnosticsOutputPath();
  if (outputPath === undefined) return;
  ensureDirWriteFileAtomicallySync(outputPath, rendered);
}

function writeOutputPath(rendered: string, path: string): void {
  ensureDirWriteFileAtomicallySync(
    isAbsolute(path) ? path : resolve(process.cwd(), path),
    rendered,
  );
}

/**
 * Dispatch on the route, one arm per mode.
 *
 * The arms are exhaustive by construction rather than by negation: the default
 * assigns `route` to a `never`, so adding a fifth mode to
 * {@link HarnessDiagnosticsRoute} without adding its arm here is a compile
 * error instead of silently falling into whichever `!==` tests happen to pass.
 * The check is written inline on purpose — importing a shared `assertNever`
 * would give this module a dependency beyond the shared schema and the atomic
 * writer, which is the property that keeps every envelope producer able to use
 * it.
 */
function writeRenderedEnvelope(rendered: string, route: HarnessDiagnosticsRoute): void {
  switch (route.mode) {
    case "stdout-only":
      process.stdout.write(rendered);
      return;
    case "sidecar-only":
      writeSidecarWhenRequested(rendered);
      return;
    case "stdout-and-sidecar":
      process.stdout.write(rendered);
      writeSidecarWhenRequested(rendered);
      return;
    case "output-path":
      writeOutputPath(rendered, route.path);
      return;
    default: {
      const unroutedMode: never = route;
      throw new Error(`unhandled harness-diagnostics route: ${JSON.stringify(unroutedMode)}`);
    }
  }
}

/**
 * Validate an envelope and route it — the single emission path every
 * harness-diagnostics producer uses.
 *
 * Validation runs before any byte is written, on every envelope that reaches
 * this function, whatever the route: a producer that emits only to stdout is
 * gated exactly like one that writes a sidecar, so no malformed envelope
 * reaches a file or a consumer. What this does NOT claim is that every envelope
 * a producer could build gets validated — `drift:ai` and `logs:audit` check
 * {@link harnessDiagnosticsOutputPath} first and never build an envelope when
 * no sidecar was requested. That skips validation of an envelope that is also
 * never emitted, so the gate still covers everything that is written.
 *
 * The bytes written are the producer's own envelope object
 * (`renderHarnessDiagnosticsEnvelope`), not the parsed copy, so validation is a
 * gate and never silently reorders or rewrites what a producer emits.
 *
 * Failures throw — `HarnessDiagnosticsValidationError` for a malformed
 * envelope, the underlying IO error for a failed write — so a caller routes
 * them through its own tool-failure path rather than reporting them as
 * findings.
 */
export function emitHarnessDiagnostics(
  envelope: HarnessDiagnostics,
  route: HarnessDiagnosticsRoute,
  options: HarnessDiagnosticsEmitOptions,
): void {
  assertValidEnvelope(envelope, options.source);
  writeRenderedEnvelope(renderHarnessDiagnosticsEnvelope(envelope), route);
}

/**
 * Sidecar-only diagnostics writer for tools whose native stdout is their own
 * report surface (`drift:ai`, `logs:audit`) — the `sidecar-only` route of
 * {@link emitHarnessDiagnostics} under the name those producers call it by.
 */
export function writeHarnessDiagnosticsSidecar(envelope: HarnessDiagnostics): void {
  emitHarnessDiagnostics(envelope, { mode: "sidecar-only" }, { source: SIDECAR_SOURCE });
}
