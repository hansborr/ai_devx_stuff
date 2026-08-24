// Markdown projection for hook-wiring documentation; parsing and validation
// remain owned by hook-wiring-schema.ts.

import {
  HOOK_HARNESSES,
  type HookHarness,
  type HookHarnessCommand,
  type HookWiring,
} from "./hook-wiring-schema.js";

function formatOutputs(outputs: HookWiring["outputs"]): string[] {
  return outputs === undefined
    ? []
    : [`- outputs: ${outputs.map((output) => `\`${output}\``).join(", ")}`];
}

function formatCommandDetails(command: HookHarnessCommand): string {
  const details = [
    command.matcher !== undefined ? `matcher: \`${command.matcher}\`` : undefined,
    command.timeout !== undefined ? `timeout: \`${String(command.timeout)}s\`` : undefined,
    command.statusMessage !== undefined ? `status: \`${command.statusMessage}\`` : undefined,
  ].filter((detail): detail is string => detail !== undefined);

  return details.length === 0 ? "" : ` (${details.join("; ")})`;
}

function formatHarnessLine(wiring: HookWiring, harness: HookHarness): string | undefined {
  const note = wiring.notes?.[harness];
  const command = wiring.harnesses[harness];
  if (command !== undefined) {
    // A note on a *wired* harness explains why that binding departs from the
    // canonical projection (the aggregators' fixed shim names), so it renders
    // beside the command rather than being dropped.
    const line = `- \`${harness}\` — \`${command.command}\`${formatCommandDetails(command)}`;
    return note === undefined ? line : `${line} — note: ${note}`;
  }

  return note === undefined ? undefined : `- \`${harness}\` — deliberately not wired: ${note}`;
}

/**
 * Rendered once in the harness-controls doc preamble rather than per control:
 * the provenance rule every `hookWiring` record below is read under.
 */
export const HOOK_WIRING_PROVENANCE_NOTE =
  "For `kind: hook`, `harness.controls.json` is the **policy** authority — event, canonical order, shared body, timeout, status message, outputs, and notes are authored decisions. The projection tables in `scripts/harness/hook-wiring-schema.ts` are the **adapter-syntax** authority: once a control declares an `adapter surface`, its `matcher` and command strings are canonical-checked copies of that projection, so treat them like committed generated output rather than free text. The `.claude/`, `.codex/`, `.copilot/`, and `.github/` hook files are generated from this manifest by `bun run harness:wiring` and are never authoritative. Controls with no declared surface — the Bash aggregators and the claude-only lifecycle hooks — are documented architectural asymmetries and record the reason in their notes.";

export function formatHookWiring(wiring: HookWiring | undefined): string[] {
  if (wiring === undefined) return [];
  const lines = ["**Hook wiring:**", ""];
  const surface =
    wiring.surface === undefined ? "" : `; adapter surface: \`${wiring.surface}\` (canonical)`;
  lines.push(
    `- event: \`${wiring.event}\`; canonical order: \`${String(wiring.order)}\`; shared body: \`${wiring.body}\`${surface}`,
  );
  lines.push(...formatOutputs(wiring.outputs));
  for (const harness of HOOK_HARNESSES) {
    const line = formatHarnessLine(wiring, harness);
    if (line !== undefined) lines.push(line);
  }
  lines.push("");
  return lines;
}
