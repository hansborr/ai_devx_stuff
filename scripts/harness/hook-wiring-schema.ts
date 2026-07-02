export const HOOK_HARNESSES = ["claude", "codex", "copilot"] as const;
export const HOOK_OUTPUT_CAPABILITIES = ["additionalContext", "decisionBlock"] as const;
export const HOOK_EVENTS = [
  "SessionStart",
  "Setup",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "MessageDisplay",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "TeammateIdle",
  "InstructionsLoaded",
  "ConfigChange",
  "CwdChanged",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd",
] as const;

export type HookHarness = (typeof HOOK_HARNESSES)[number];
export type HookEvent = (typeof HOOK_EVENTS)[number];
export type HookOutputCapability = (typeof HOOK_OUTPUT_CAPABILITIES)[number];

type MatcherPolicy = "required" | "optional" | "unsupported";

const HOOK_MATCHER_POLICY = {
  SessionStart: "optional",
  Setup: "optional",
  UserPromptSubmit: "unsupported",
  UserPromptExpansion: "optional",
  PreToolUse: "required",
  PermissionRequest: "required",
  PermissionDenied: "required",
  PostToolUse: "required",
  PostToolUseFailure: "required",
  PostToolBatch: "unsupported",
  Notification: "optional",
  MessageDisplay: "unsupported",
  SubagentStart: "optional",
  SubagentStop: "optional",
  TaskCreated: "unsupported",
  TaskCompleted: "unsupported",
  Stop: "unsupported",
  StopFailure: "optional",
  TeammateIdle: "unsupported",
  InstructionsLoaded: "optional",
  ConfigChange: "optional",
  CwdChanged: "unsupported",
  FileChanged: "required",
  WorktreeCreate: "unsupported",
  WorktreeRemove: "unsupported",
  PreCompact: "optional",
  PostCompact: "optional",
  Elicitation: "optional",
  ElicitationResult: "optional",
  SessionEnd: "optional",
} as const satisfies Record<HookEvent, MatcherPolicy>;

// Codex hooks are a separate runtime. Docs-verified against the current Codex
// hooks manual during the 2026-07 Batch D platform-contract fix; inferred
// entries: none. Unsupported events must stay out of .codex/hooks.json.
const CODEX_SUPPORTED_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "PreCompact",
  "PostCompact",
] as const satisfies readonly HookEvent[];

// Copilot's repository hook bridge currently exposes only these three events.
const COPILOT_SUPPORTED_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "Stop",
] as const satisfies readonly HookEvent[];

const HARNESS_SUPPORTED_EVENTS = {
  claude: HOOK_EVENTS,
  codex: CODEX_SUPPORTED_EVENTS,
  copilot: COPILOT_SUPPORTED_EVENTS,
} as const satisfies Record<HookHarness, readonly HookEvent[]>;

const HOOK_OUTPUT_SUPPORT = {
  claude: {
    additionalContext: [
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "SubagentStop",
    ],
    decisionBlock: ["PreToolUse", "Stop", "SubagentStop"],
  },
  codex: {
    additionalContext: ["PreToolUse", "PostToolUse"],
    decisionBlock: ["PreToolUse", "PostToolUse", "SubagentStop", "Stop"],
  },
  copilot: {
    additionalContext: ["PreToolUse", "PostToolUse", "Stop"],
    decisionBlock: ["PreToolUse", "Stop"],
  },
} as const satisfies Record<HookHarness, Record<HookOutputCapability, readonly HookEvent[]>>;

export interface HookHarnessCommand {
  readonly matcher?: string;
  readonly command: string;
  readonly statusMessage?: string;
  readonly timeout?: number;
}

export interface HookWiring {
  readonly event: HookEvent;
  readonly order: number;
  readonly outputs?: readonly HookOutputCapability[];
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

function isHookOutputCapability(value: unknown): value is HookOutputCapability {
  return (
    typeof value === "string" && HOOK_OUTPUT_CAPABILITIES.some((capability) => capability === value)
  );
}

function harnessSupportsEvent(harness: HookHarness, event: HookEvent): boolean {
  return HARNESS_SUPPORTED_EVENTS[harness].some((supportedEvent) => supportedEvent === event);
}

function harnessSupportsOutput(
  harness: HookHarness,
  event: HookEvent,
  output: HookOutputCapability,
): boolean {
  return HOOK_OUTPUT_SUPPORT[harness][output].some((supportedEvent) => supportedEvent === event);
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

// Copilot CLI 1.0.68 honors native matchers for preToolUse/postToolUse. The
// .copilot/hooks adapters still filter by toolName as defense in depth.
function assertCopilotCommandShape(statusMessage: string | undefined, context: string): void {
  if (statusMessage !== undefined) {
    throw new Error(`${context}.statusMessage is invalid: Copilot does not support it`);
  }
}

function assertHarnessSupportsEvent(harness: HookHarness, event: HookEvent, context: string): void {
  if (harnessSupportsEvent(harness, event)) return;
  throw new Error(
    `${context}: ${harness} does not support ${event}; omit this harness and add hookWiring.notes.${harness}`,
  );
}

function assertMatcherPolicy(event: HookEvent, matcher: string | undefined, context: string): void {
  const matcherPolicy = HOOK_MATCHER_POLICY[event];
  if (matcherPolicy === "required" && matcher === undefined) {
    throw new Error(`${context}.matcher is required for ${event}`);
  }
  if (matcherPolicy === "unsupported" && matcher !== undefined) {
    throw new Error(`${context}.matcher is not supported for ${event}`);
  }
}

function parseHarnessCommand(
  harness: HookHarness,
  raw: unknown,
  event: HookEvent,
  context: string,
): HookHarnessCommand {
  if (!isObject(raw)) throw new Error(`${context} must be an object`);
  assertHarnessSupportsEvent(harness, event, context);
  const matcher = optionalString(raw, "matcher", context);
  const statusMessage = optionalString(raw, "statusMessage", context);
  const timeout = optionalPositiveInteger(raw, "timeout", context);
  if (harness === "copilot") {
    assertCopilotCommandShape(statusMessage, context);
  }
  assertMatcherPolicy(event, matcher, context);
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

function parseOutputs(rawOutputs: unknown, controlId: string): HookWiring["outputs"] {
  if (rawOutputs === undefined) return undefined;
  if (!Array.isArray(rawOutputs)) {
    throw new Error(`${controlId}.hookWiring.outputs must be an array`);
  }
  if (rawOutputs.length === 0) {
    throw new Error(`${controlId}.hookWiring.outputs cannot be empty`);
  }

  const outputs: HookOutputCapability[] = [];
  for (const [index, output] of rawOutputs.entries()) {
    if (!isHookOutputCapability(output)) {
      throw new Error(
        `${controlId}.hookWiring.outputs[${String(index)}] must be one of: ${HOOK_OUTPUT_CAPABILITIES.join(", ")}`,
      );
    }
    if (outputs.some((existing) => existing === output)) {
      throw new Error(`${controlId}.hookWiring.outputs[${String(index)}] duplicates ${output}`);
    }
    outputs.push(output);
  }

  return outputs;
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

function assertOutputSupport(
  controlId: string,
  event: HookEvent,
  harnesses: Readonly<Partial<Record<HookHarness, HookHarnessCommand>>>,
  outputs: HookWiring["outputs"],
): void {
  if (outputs === undefined) return;

  for (const harness of HOOK_HARNESSES) {
    if (harnesses[harness] === undefined) continue;
    for (const output of outputs) {
      if (harnessSupportsOutput(harness, event, output)) continue;
      throw new Error(
        `${controlId}.hookWiring: ${harness} ${event} does not support ${output} output`,
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
  const outputs = parseOutputs(rawWiring.outputs, controlId);
  assertHarnessCoverage(controlId, harnesses, notes);
  assertOutputSupport(controlId, rawWiring.event, harnesses, outputs);
  return {
    event: rawWiring.event,
    order: positiveInteger(rawWiring, "order", `${controlId}.hookWiring`),
    ...(outputs !== undefined ? { outputs } : {}),
    harnesses,
    ...(notes !== undefined ? { notes } : {}),
  };
}

function formatOutputs(outputs: readonly HookOutputCapability[] | undefined): string[] {
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
  const command = wiring.harnesses[harness];
  if (command !== undefined) {
    return `- \`${harness}\` — \`${command.command}\`${formatCommandDetails(command)}`;
  }

  const note = wiring.notes?.[harness];
  return note === undefined ? undefined : `- \`${harness}\` — deliberately not wired: ${note}`;
}

export function formatHookWiring(wiring: HookWiring | undefined): string[] {
  if (wiring === undefined) return [];
  const lines = ["**Hook wiring:**", ""];
  lines.push(`- event: \`${wiring.event}\`; canonical order: \`${String(wiring.order)}\``);
  lines.push(...formatOutputs(wiring.outputs));
  for (const harness of HOOK_HARNESSES) {
    const line = formatHarnessLine(wiring, harness);
    if (line !== undefined) lines.push(line);
  }
  lines.push("");
  return lines;
}
