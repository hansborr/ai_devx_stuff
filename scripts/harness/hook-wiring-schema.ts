import { isRecord } from "../lib/records.js";

export const HOOK_HARNESSES = ["claude", "codex", "copilot"] as const;
const HOOK_OUTPUT_CAPABILITIES = ["additionalContext", "decisionBlock", "systemMessage"] as const;
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
type HookOutputCapability = (typeof HOOK_OUTPUT_CAPABILITIES)[number];

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
    additionalContext: ["SessionStart", "PreToolUse", "PostToolUse", "PostToolUseFailure"],
    decisionBlock: ["PreToolUse"],
    systemMessage: ["Stop", "SubagentStop"],
  },
  codex: {
    additionalContext: ["PreToolUse", "PostToolUse"],
    decisionBlock: ["PreToolUse", "PostToolUse"],
    systemMessage: [],
  },
  copilot: {
    additionalContext: ["PreToolUse", "PostToolUse"],
    decisionBlock: ["PreToolUse"],
    systemMessage: [],
  },
} as const satisfies Record<HookHarness, Record<HookOutputCapability, readonly HookEvent[]>>;

/**
 * Provenance split for `hookWiring`, stage 1 (assert-canonical validate mode):
 *
 * - **The manifest is the policy authority** — `event`, `order`, `body`,
 *   `timeout`, `statusMessage`, `outputs`, and `notes` are authored decisions
 *   nothing derives.
 * - **The projection tables below are the adapter-syntax authority.** Once a
 *   binding declares a neutral `surface`, its authored `matcher` and `command`
 *   are canonical-checked copies — treat them like committed generated output,
 *   not like free text.
 * - **`.claude/`, `.codex/`, `.copilot/`, and `.github/` hook files are
 *   generated** by `generate-hook-wiring.ts` and are never authoritative.
 *
 * Flipping this from assert to emit (deriving the strings instead of checking
 * them) is a mechanical follow-up on these same tables; it is deliberately not
 * done here, so the manifest stays readable standalone.
 */
const HOOK_SURFACES = ["bash", "edit"] as const;

type HookSurface = (typeof HOOK_SURFACES)[number];

// porting-knob: canonical-adapter-matcher -- each harness's tool-surface matcher
// syntax. A missing (harness, surface) row fails closed: codex Bash matchers
// exist only on the Bash aggregator controls, which route a shared body rather
// than projecting a per-hook surface, so they declare no `surface` at all.
const CANONICAL_MATCHER = {
  claude: { bash: "Bash", edit: "Edit|Write" },
  codex: { edit: "apply_patch" },
  copilot: { bash: "bash|powershell", edit: "create|edit" },
} as const satisfies Record<HookHarness, Partial<Record<HookSurface, string>>>;

// porting-knob: canonical-adapter-shim-dir -- the generated adapter directory per
// harness. Must stay in step with HOOK_SHIM_DIRS in hook-shims.ts, which owns
// the generator's write targets; `bun run harness:wiring:check` fails end to end
// if the two ever disagree. Mirrored rather than imported so this module keeps
// its dependency-free fixture-copy closure.
const CANONICAL_SHIM_DIR = {
  claude: ".claude/hooks",
  codex: ".codex/hooks",
  copilot: ".copilot/hooks",
} as const satisfies Record<HookHarness, string>;

// The complete authored field inventories. Unknown keys are registration typos,
// not extension points: hookWiring was the last facet whose consumer silently
// discarded them, so a misspelling used to vanish from the resolved model.
const HOOK_WIRING_FIELDS = ["body", "event", "harnesses", "notes", "order", "outputs", "surface"];
const HOOK_HARNESS_COMMAND_FIELDS = ["command", "matcher", "statusMessage", "timeout"];

export interface HookHarnessCommand {
  readonly matcher?: string;
  readonly command: string;
  readonly statusMessage?: string;
  readonly timeout?: number;
}

export interface HookWiring {
  readonly event: HookEvent;
  readonly body: string;
  readonly order: number;
  /**
   * Neutral tool surface this hook policies. Declaring it opts the control's
   * bindings into canonical matcher/command projection (see the provenance
   * split above), and is accepted only on the tool-use events whose matchers
   * are adapter syntax (`SURFACE_DECLARABLE_EVENTS`). Aggregator and lifecycle
   * controls omit it and explain the asymmetry in `notes`.
   */
  readonly surface?: HookSurface;
  readonly outputs?: readonly HookOutputCapability[];
  readonly harnesses: Readonly<Partial<Record<HookHarness, HookHarnessCommand>>>;
  readonly notes?: Readonly<Partial<Record<HookHarness, string>>>;
}

/**
 * The one command template per harness, projected from the shared hook body.
 * Claude resolves through `$CLAUDE_PROJECT_DIR`; every other adapter uses the
 * toplevel-quoted form.
 */
export function canonicalHookCommand(harness: HookHarness, body: string): string {
  const shim = `${CANONICAL_SHIM_DIR[harness]}/${body.slice(body.lastIndexOf("/") + 1)}`;
  return harness === "claude"
    ? `bash $CLAUDE_PROJECT_DIR/${shim}`
    : `bash "$(git rev-parse --show-toplevel)/${shim}"`;
}

function canonicalMatcher(harness: HookHarness, surface: HookSurface): string | undefined {
  const row: Partial<Record<HookSurface, string>> = CANONICAL_MATCHER[harness];
  return row[surface];
}

function isHookSurface(value: unknown): value is HookSurface {
  return typeof value === "string" && HOOK_SURFACES.some((surface) => surface === value);
}

/**
 * Events whose matcher is pure adapter syntax, so a binding may declare the
 * surface that produced it. Every other event's matcher is authored policy —
 * the claude-only lifecycle hook's `startup|resume|compact` picks *which
 * session sources fire*, which no tool-surface table can project, so declaring
 * a surface there would let adapter syntax silently displace that choice.
 */
const SURFACE_DECLARABLE_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
] as const satisfies readonly HookEvent[];

function isSurfaceDeclarableEvent(event: HookEvent): boolean {
  return SURFACE_DECLARABLE_EVENTS.some((declarable) => declarable === event);
}

/**
 * The subset the opt-out tripwire polices. `PostToolUseFailure` matchers are
 * adapter syntax too and a declaration is accepted there, but it is
 * deliberately never demanded — the tripwire stays scoped to the two events
 * whose bindings the projection tables cover end to end.
 */
function isSurfaceProjectedEvent(event: HookEvent): boolean {
  return event === "PreToolUse" || event === "PostToolUse";
}

function assertAllowedFields(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  for (const key of Object.keys(raw)) {
    if (allowed.some((field) => field === key)) continue;
    throw new Error(`${context}.${key} is not a supported field; supported: ${allowed.join(", ")}`);
  }
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

interface SurfacePolicyInput {
  readonly controlId: string;
  readonly event: HookEvent;
  readonly body: string;
  readonly surface: HookSurface | undefined;
  readonly harnesses: Readonly<Partial<Record<HookHarness, HookHarnessCommand>>>;
  readonly notes: HookWiring["notes"];
}

/**
 * With a `surface` declared, the binding's matcher and command are canonical
 * copies rather than authored text: both must byte-equal the projection. The
 * diagnostic prints the expected string so the validator teaches the template.
 */
function assertCanonicalProjection(
  harness: HookHarness,
  surface: HookSurface,
  command: HookHarnessCommand,
  wiring: SurfacePolicyInput,
): void {
  const context = `${wiring.controlId}.hookWiring.harnesses.${harness}`;
  const body = wiring.body;
  const matcher = canonicalMatcher(harness, surface);
  if (matcher === undefined) {
    throw new Error(
      `${context}: no canonical ${surface} adapter syntax exists for ${harness}; drop hookWiring.surface and record the asymmetry in hookWiring.notes`,
    );
  }
  if (command.matcher !== matcher) {
    throw new Error(
      `${context}.matcher must be "${matcher}" for the declared ${surface} surface; got "${command.matcher ?? "(none)"}"`,
    );
  }
  const expected = canonicalHookCommand(harness, body);
  if (command.command !== expected) {
    throw new Error(
      `${context}.command must be the canonical projection of hookWiring.body: ${expected}; got: ${command.command}`,
    );
  }
}

/**
 * Opt-out tripwire. A tool-use binding that already carries canonical adapter
 * syntax must either declare the `surface` that produced it or carry
 * `notes.<that harness>` explaining why it is not a canonical per-hook binding
 * — which is how the Bash aggregators (shared body, fixed aggregator shim name
 * rather than the projected one) stay expressible.
 *
 * The note is keyed to the *wired* harness that diverges, not to the control.
 * `assertHarnessCoverage` already demands a note for every *omitted* harness,
 * so accepting any `notes` object at all would make this branch unreachable
 * for single-harness controls: a mistyped shim basename would then ship with
 * neither string checked. Wired-harness notes render in the generated
 * harness-controls doc alongside the command they explain.
 */
function assertSurfaceDeclared(wiring: SurfacePolicyInput): void {
  if (!isSurfaceProjectedEvent(wiring.event)) return;
  const { controlId, harnesses, notes } = wiring;
  for (const harness of HOOK_HARNESSES) {
    const command = harnesses[harness];
    if (command === undefined) continue;
    // Iterating the harness's declared rows rather than every surface keeps an
    // absent (harness, surface) pair out of the comparison entirely, so no
    // `undefined === undefined` can ever read an unwired pair as canonical.
    const canonicalRows: Readonly<Record<string, string>> = CANONICAL_MATCHER[harness];
    for (const [surface, canonical] of Object.entries(canonicalRows)) {
      if (command.matcher !== canonical) continue;
      if (command.command === canonicalHookCommand(harness, wiring.body)) {
        throw new Error(
          `${controlId}.hookWiring must declare surface: "${surface}": harnesses.${harness} already uses the canonical ${surface} matcher and command projection, so those strings are adapter syntax and must be checked against it`,
        );
      }
      if (notes?.[harness] === undefined) {
        throw new Error(
          `${controlId}.hookWiring.harnesses.${harness} uses the canonical ${surface} matcher "${canonical}" but not the canonical command projection (expected: ${canonicalHookCommand(harness, wiring.body)}); declare hookWiring.surface, or explain this binding in hookWiring.notes.${harness}`,
        );
      }
    }
  }
}

/**
 * The whole surface contract: canonical projection where `surface` is declared,
 * the opt-out tripwire where it is not.
 */
function assertSurfacePolicy(wiring: SurfacePolicyInput): void {
  const { surface } = wiring;
  if (surface === undefined) {
    assertSurfaceDeclared(wiring);
    return;
  }
  if (!isSurfaceDeclarableEvent(wiring.event)) {
    throw new Error(
      `${wiring.controlId}.hookWiring.surface is not supported for ${wiring.event}: only ${SURFACE_DECLARABLE_EVENTS.join(", ")} matchers are adapter syntax, so a ${wiring.event} matcher stays authored policy`,
    );
  }
  for (const harness of HOOK_HARNESSES) {
    const command = wiring.harnesses[harness];
    if (command === undefined) continue;
    assertCanonicalProjection(harness, surface, command, wiring);
  }
}

function parseHarnessCommand(
  harness: HookHarness,
  raw: unknown,
  event: HookEvent,
  context: string,
): HookHarnessCommand {
  if (!isRecord(raw)) throw new Error(`${context} must be an object`);
  assertAllowedFields(raw, HOOK_HARNESS_COMMAND_FIELDS, context);
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
  if (!isRecord(rawNotes)) throw new Error(`${controlId}.hookWiring.notes must be an object`);
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

function parseSurface(rawSurface: unknown, controlId: string): HookSurface | undefined {
  if (rawSurface === undefined) return undefined;
  if (!isHookSurface(rawSurface)) {
    throw new Error(`${controlId}.hookWiring.surface must be one of: ${HOOK_SURFACES.join(", ")}`);
  }
  return rawSurface;
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

function parseHarnesses(
  controlId: string,
  rawHarnesses: Record<string, unknown>,
  event: HookEvent,
): Partial<Record<HookHarness, HookHarnessCommand>> {
  const harnesses: Partial<Record<HookHarness, HookHarnessCommand>> = {};
  for (const [key, value] of Object.entries(rawHarnesses)) {
    if (key === "cursor") {
      throw new Error(
        `${controlId}.hookWiring.harnesses.cursor: Cursor has no repository PreToolUse policy surface; agent-cli work cursor uses --force with unrestricted shell. Revisit this exclusion before adding Cursor hook wiring.`,
      );
    }
    if (!isHookHarness(key)) throw new Error(`${controlId}.hookWiring.harnesses.${key} is invalid`);
    harnesses[key] = parseHarnessCommand(
      key,
      value,
      event,
      `${controlId}.hookWiring.harnesses.${key}`,
    );
  }
  if (Object.keys(harnesses).length === 0) {
    throw new Error(`${controlId}.hookWiring.harnesses cannot be empty`);
  }
  return harnesses;
}

export function resolveHookWiring(controlId: string, rawWiring: unknown): HookWiring {
  if (!isRecord(rawWiring)) throw new Error(`${controlId}.hookWiring must be an object`);
  assertAllowedFields(rawWiring, HOOK_WIRING_FIELDS, `${controlId}.hookWiring`);
  if (!isHookEvent(rawWiring.event)) {
    throw new Error(`${controlId}.hookWiring.event must be one of: ${HOOK_EVENTS.join(", ")}`);
  }
  if (!isRecord(rawWiring.harnesses)) {
    throw new Error(`${controlId}.hookWiring.harnesses must be an object`);
  }
  const body = requiredString(rawWiring, "body", `${controlId}.hookWiring`);
  const harnesses = parseHarnesses(controlId, rawWiring.harnesses, rawWiring.event);
  const notes = parseNotes(rawWiring.notes, controlId);
  const outputs = parseOutputs(rawWiring.outputs, controlId);
  const surface = parseSurface(rawWiring.surface, controlId);
  assertHarnessCoverage(controlId, harnesses, notes);
  assertOutputSupport(controlId, rawWiring.event, harnesses, outputs);
  assertSurfacePolicy({
    controlId,
    event: rawWiring.event,
    body,
    surface,
    harnesses,
    notes,
  });
  return {
    event: rawWiring.event,
    body,
    order: positiveInteger(rawWiring, "order", `${controlId}.hookWiring`),
    ...(surface !== undefined ? { surface } : {}),
    ...(outputs !== undefined ? { outputs } : {}),
    harnesses,
    ...(notes !== undefined ? { notes } : {}),
  };
}
