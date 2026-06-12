export const HOOK_HARNESSES = ["claude", "codex"] as const;
export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "Stop"] as const;

export type HookHarness = (typeof HOOK_HARNESSES)[number];
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookHarnessCommand {
  readonly matcher?: string;
  readonly command: string;
  readonly statusMessage?: string;
  readonly timeout?: number;
}

export interface HookWiring {
  readonly event: HookEvent;
  readonly order: number;
  readonly harnesses: Readonly<Partial<Record<HookHarness, HookHarnessCommand>>>;
  readonly notes?: Readonly<Partial<Record<HookHarness, string>>>;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHookHarness(value: string): value is HookHarness {
  return HOOK_HARNESSES.some((harness) => harness === value);
}

function isHookEvent(value: unknown): value is HookEvent {
  return typeof value === "string" && HOOK_EVENTS.some((event) => event === value);
}

function requiredString(raw: Record<string, unknown>, field: string, context: string): string {
  const value = raw[field];
  if (!isNonEmptyString(value)) throw new Error(`${context}.${field} must be a non-empty string`);
  return value;
}

function optionalString(
  raw: Record<string, unknown>,
  field: string,
  context: string,
): string | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value)) throw new Error(`${context}.${field} must be a non-empty string`);
  return value;
}

function positiveInteger(raw: Record<string, unknown>, field: string, context: string): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${context}.${field} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInteger(
  raw: Record<string, unknown>,
  field: string,
  context: string,
): number | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${context}.${field} must be a positive integer`);
  }
  return value;
}

function parseHarnessCommand(
  harness: HookHarness,
  raw: unknown,
  event: HookEvent,
  context: string,
): HookHarnessCommand {
  if (!isObject(raw)) throw new Error(`${context} must be an object`);
  const matcher = optionalString(raw, "matcher", context);
  const statusMessage = optionalString(raw, "statusMessage", context);
  const timeout = optionalPositiveInteger(raw, "timeout", context);
  if (event !== "Stop" && matcher === undefined) {
    throw new Error(`${context}.matcher is required for ${event}`);
  }
  if (harness === "codex" && statusMessage === undefined) {
    throw new Error(`${context}.statusMessage is required for Codex hooks`);
  }
  return {
    command: requiredString(raw, "command", context),
    ...(matcher !== undefined ? { matcher } : {}),
    ...(statusMessage !== undefined ? { statusMessage } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

function parseNotes(rawNotes: unknown, controlId: string): HookWiring["notes"] {
  if (rawNotes === undefined) return undefined;
  if (!isObject(rawNotes)) throw new Error(`${controlId}.hookWiring.notes must be an object`);
  const notes: Partial<Record<HookHarness, string>> = {};
  for (const [key, value] of Object.entries(rawNotes)) {
    if (!isHookHarness(key))
      throw new Error(`${controlId}.hookWiring.notes.${key} is not supported`);
    if (!isNonEmptyString(value)) {
      throw new Error(`${controlId}.hookWiring.notes.${key} must be a non-empty string`);
    }
    notes[key] = value;
  }
  return notes;
}

function assertHarnessCoverage(
  controlId: string,
  harnesses: Readonly<Partial<Record<HookHarness, HookHarnessCommand>>>,
  notes: HookWiring["notes"],
): void {
  for (const harness of HOOK_HARNESSES) {
    if (harnesses[harness] === undefined && notes?.[harness] === undefined) {
      throw new Error(
        `${controlId} omits ${harness} wiring without a notes.${harness} explanation`,
      );
    }
  }
}

export function resolveHookWiring(controlId: string, rawWiring: unknown): HookWiring {
  if (!isObject(rawWiring)) throw new Error(`${controlId}.hookWiring must be an object`);
  if (!isHookEvent(rawWiring.event)) {
    throw new Error(`${controlId}.hookWiring.event must be one of: ${HOOK_EVENTS.join(", ")}`);
  }
  if (!isObject(rawWiring.harnesses)) {
    throw new Error(`${controlId}.hookWiring.harnesses must be an object`);
  }
  const harnesses: Partial<Record<HookHarness, HookHarnessCommand>> = {};
  for (const [key, value] of Object.entries(rawWiring.harnesses)) {
    if (!isHookHarness(key)) throw new Error(`${controlId}.hookWiring.harnesses.${key} is invalid`);
    harnesses[key] = parseHarnessCommand(
      key,
      value,
      rawWiring.event,
      `${controlId}.hookWiring.harnesses.${key}`,
    );
  }
  if (Object.keys(harnesses).length === 0) {
    throw new Error(`${controlId}.hookWiring.harnesses cannot be empty`);
  }
  const notes = parseNotes(rawWiring.notes, controlId);
  assertHarnessCoverage(controlId, harnesses, notes);
  return {
    event: rawWiring.event,
    order: positiveInteger(rawWiring, "order", `${controlId}.hookWiring`),
    harnesses,
    ...(notes !== undefined ? { notes } : {}),
  };
}

export function formatHookWiring(wiring: HookWiring | undefined): string[] {
  if (wiring === undefined) return [];
  const lines = ["**Hook wiring:**", ""];
  lines.push(`- event: \`${wiring.event}\`; canonical order: \`${String(wiring.order)}\``);
  for (const harness of HOOK_HARNESSES) {
    const command = wiring.harnesses[harness];
    if (command === undefined) {
      const note = wiring.notes?.[harness];
      if (note !== undefined) lines.push(`- \`${harness}\` — deliberately not wired: ${note}`);
      continue;
    }
    const details = [
      command.matcher !== undefined ? `matcher: \`${command.matcher}\`` : undefined,
      command.timeout !== undefined ? `timeout: \`${String(command.timeout)}s\`` : undefined,
      command.statusMessage !== undefined ? `status: \`${command.statusMessage}\`` : undefined,
    ].filter((detail): detail is string => detail !== undefined);
    const suffix = details.length === 0 ? "" : ` (${details.join("; ")})`;
    lines.push(`- \`${harness}\` — \`${command.command}\`${suffix}`);
  }
  lines.push("");
  return lines;
}
