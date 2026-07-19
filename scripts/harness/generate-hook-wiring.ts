import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareByCodepoint } from "@musi/lint-ratchet/kernel/codepoint-compare.js";

import { ensureDirWriteFileAtomicallySync } from "../lib/atomic-write.js";
import { HARNESS_MANIFEST_FILENAME, readHarnessManifest } from "./harness-manifest.js";
import { CLAUDE_SETTINGS_PATH, CODEX_HOOKS_PATH, COPILOT_HOOKS_PATH } from "./harness-paths.js";
import { checkHookShimsOnDisk, writeHookShims } from "./hook-shim-files.js";
import { deriveHookShims, type RenderedShim } from "./hook-shims.js";
import {
  HOOK_EVENTS,
  type HookEvent,
  type HookHarness as Harness,
  type HookHarnessCommand,
  type HookWiring,
  isNonEmptyString,
  isObject,
  resolveHookWiring,
} from "./hook-wiring-schema.js";

const PROCESS_ARG_OFFSET = 2;
const JSON_INDENT = 2;

interface OrderedHookWiring extends HookWiring {
  readonly controlId: string;
}

interface GeneratedCommand {
  readonly type: "command";
  readonly command: string;
  readonly statusMessage?: string;
  readonly timeout?: number;
}

interface GeneratedGroup {
  readonly matcher?: string;
  readonly hooks: GeneratedCommand[];
}

type GeneratedHooks = Partial<Record<HookEvent, GeneratedGroup[]>>;

// Copilot repo hook config (.github/hooks/*.json): flat per-event command
// arrays with camelCase event names, `bash` command strings, and `timeoutSec`.
// The `Stop` manifest event maps to Copilot's `agentStop`.
type CopilotEventName = "preToolUse" | "postToolUse" | "agentStop";

interface GeneratedCopilotCommand {
  readonly type: "command";
  readonly matcher?: string;
  readonly bash: string;
  readonly timeoutSec?: number;
}

type GeneratedCopilotHooks = Partial<Record<CopilotEventName, GeneratedCopilotCommand[]>>;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const claudeSettingsPath = join(repoRoot, CLAUDE_SETTINGS_PATH);
const codexHooksPath = join(repoRoot, CODEX_HOOKS_PATH);
const copilotHooksPath = join(repoRoot, COPILOT_HOOKS_PATH);

function copilotEventNameFor(event: HookEvent): CopilotEventName | undefined {
  if (event === "PreToolUse") return "preToolUse";
  if (event === "PostToolUse") return "postToolUse";
  if (event === "Stop") return "agentStop";
  return undefined;
}

function parseHookWiring(control: Record<string, unknown>): OrderedHookWiring | undefined {
  const rawWiring = control.hookWiring;
  if (rawWiring === undefined) return undefined;
  if (!isNonEmptyString(control.id)) throw new Error("hookWiring control id must be a string");
  return { controlId: control.id, ...resolveHookWiring(control.id, rawWiring) };
}

function collectHookWiring(manifest: unknown): OrderedHookWiring[] {
  if (!isObject(manifest) || !Array.isArray(manifest.controls)) {
    throw new Error(`${HARNESS_MANIFEST_FILENAME} must declare a controls array`);
  }
  const hooks: OrderedHookWiring[] = [];
  const seenIds = new Set<string>();
  for (const [index, control] of manifest.controls.entries()) {
    if (!isObject(control))
      throw new Error(`control entry at index ${String(index)} must be an object`);
    if (isNonEmptyString(control.id)) {
      if (seenIds.has(control.id)) throw new Error(`duplicate control id: ${control.id}`);
      seenIds.add(control.id);
    }
    const wiring = parseHookWiring(control);
    if (wiring !== undefined) hooks.push(wiring);
  }
  return hooks.sort((left, right) => {
    const eventOrder = HOOK_EVENTS.indexOf(left.event) - HOOK_EVENTS.indexOf(right.event);
    if (eventOrder !== 0) return eventOrder;
    // codepoint order, not localeCompare — load-bearing for committed/freshness-compared bytes:
    // the controlId tiebreaker feeds the committed settings.json / codex / copilot hook files
    // (freshness-gated by harness:check).
    return left.order - right.order || compareByCodepoint(left.controlId, right.controlId);
  });
}

function toGeneratedCommand(hook: HookHarnessCommand): GeneratedCommand {
  return {
    type: "command",
    command: hook.command,
    ...(hook.statusMessage !== undefined ? { statusMessage: hook.statusMessage } : {}),
    ...(hook.timeout !== undefined ? { timeout: hook.timeout } : {}),
  };
}

function renderCopilotHooks(hooks: readonly OrderedHookWiring[]): GeneratedCopilotHooks {
  const output: GeneratedCopilotHooks = {};
  for (const event of HOOK_EVENTS) {
    const copilotEventName = copilotEventNameFor(event);
    if (copilotEventName === undefined) continue;
    const commands: GeneratedCopilotCommand[] = [];
    for (const wiring of hooks.filter((entry) => entry.event === event)) {
      const hook = wiring.harnesses.copilot;
      if (hook === undefined) continue;
      commands.push({
        type: "command",
        ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
        bash: hook.command,
        ...(hook.timeout !== undefined ? { timeoutSec: hook.timeout } : {}),
      });
    }
    if (commands.length > 0) output[copilotEventName] = commands;
  }
  return output;
}

function renderHooksForHarness(
  hooks: readonly OrderedHookWiring[],
  harness: Harness,
): GeneratedHooks {
  const output: GeneratedHooks = {};
  for (const event of HOOK_EVENTS) {
    const groups: GeneratedGroup[] = [];
    const byMatcher = new Map<string, GeneratedGroup>();
    for (const wiring of hooks.filter((entry) => entry.event === event)) {
      const hook = wiring.harnesses[harness];
      if (hook === undefined) continue;
      const key = hook.matcher ?? "";
      let group = byMatcher.get(key);
      if (group === undefined) {
        group = { ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}), hooks: [] };
        byMatcher.set(key, group);
        groups.push(group);
      }
      group.hooks.push(toGeneratedCommand(hook));
    }
    if (groups.length > 0) output[event] = groups;
  }
  return output;
}

function indentJsonValue(json: string, baseIndent: string): string {
  const lines = json.split("\n");
  return lines.map((line, index) => (index === 0 ? line : `${baseIndent}${line}`)).join("\n");
}

function findJsonStringEnd(text: string, start: number): number {
  for (let index = start + 1, escaped = false; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      return index + 1;
    }
  }
  throw new Error("Unterminated JSON string while locating .claude settings hooks");
}

function parseJsonStringAt(
  text: string,
  start: number,
): { readonly value: string; readonly end: number } {
  const end = findJsonStringEnd(text, start);
  const parsed: unknown = JSON.parse(text.slice(start, end));
  if (!isNonEmptyString(parsed)) throw new Error("JSON object key must be a string");
  return { value: parsed, end };
}

function findJsonValueEnd(text: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index = findJsonStringEnd(text, index);
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  throw new Error("Could not locate end of .claude settings hooks value");
}

function findHooksValueStart(settingsText: string, keyEnd: number): number {
  let cursor = keyEnd;
  while (/\s/u.test(settingsText[cursor] ?? "")) cursor += 1;
  if (settingsText[cursor] !== ":") throw new Error(".claude settings hooks key missing colon");
  cursor += 1;
  while (/\s/u.test(settingsText[cursor] ?? "")) cursor += 1;
  return cursor;
}

function isJsonObjectKeyPosition(settingsText: string, stringStart: number): boolean {
  let cursor = stringStart - 1;
  while (cursor >= 0 && /\s/u.test(settingsText[cursor] ?? "")) cursor -= 1;
  return settingsText[cursor] === "{" || settingsText[cursor] === ",";
}

function findClaudeHooksRange(settingsText: string): {
  readonly start: number;
  readonly end: number;
  readonly indent: string;
} {
  JSON.parse(settingsText);
  let depth = 0;
  for (let index = 0; index < settingsText.length; index += 1) {
    const char = settingsText[index];
    if (char === '"') {
      const parsed = parseJsonStringAt(settingsText, index);
      if (depth === 1 && parsed.value === "hooks" && isJsonObjectKeyPosition(settingsText, index)) {
        const start = findHooksValueStart(settingsText, parsed.end);
        const lineStart = settingsText.lastIndexOf("\n", index - 1) + 1;
        const keyIndent = settingsText.slice(lineStart, index);
        return {
          start,
          end: findJsonValueEnd(settingsText, start),
          indent: /^[ \t]*$/u.test(keyIndent) ? keyIndent : "",
        };
      }
      index = parsed.end - 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }
  }
  throw new Error(".claude/settings.json must declare a top-level hooks key");
}

export function replaceClaudeHooksInSettings(settingsText: string, hooks: GeneratedHooks): string {
  const range = findClaudeHooksRange(settingsText);
  const renderedHooks = indentJsonValue(JSON.stringify(hooks, null, JSON_INDENT), range.indent);
  const next = `${settingsText.slice(0, range.start)}${renderedHooks}${settingsText.slice(range.end)}`;
  JSON.parse(next);
  return next;
}

export function renderHookWiringOutputsFromManifest(
  manifest: unknown,
  claudeSettingsText: string,
): {
  readonly claudeSettingsJson: string;
  readonly codexHooksJson: string;
  readonly copilotHooksJson: string;
  readonly shims: readonly RenderedShim[];
} {
  const hooks = collectHookWiring(manifest);
  const claudeHooks = renderHooksForHarness(hooks, "claude");
  const codexHooks = renderHooksForHarness(hooks, "codex");
  const copilotHooks = renderCopilotHooks(hooks);
  return {
    claudeSettingsJson: replaceClaudeHooksInSettings(claudeSettingsText, claudeHooks),
    codexHooksJson: `${JSON.stringify({ hooks: codexHooks }, null, JSON_INDENT)}\n`,
    copilotHooksJson: `${JSON.stringify({ version: 1, hooks: copilotHooks }, null, JSON_INDENT)}\n`,
    shims: deriveHookShims(hooks),
  };
}

function readFileOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // Missing file is "out of date", not a crash.
    return "";
  }
}

export function writeHookWiringOutputs(
  outputs: ReturnType<typeof renderHookWiringOutputsFromManifest>,
  paths = { claudeSettingsPath, codexHooksPath, copilotHooksPath, shimRootPath: repoRoot },
): void {
  ensureDirWriteFileAtomicallySync(paths.claudeSettingsPath, outputs.claudeSettingsJson);
  ensureDirWriteFileAtomicallySync(paths.codexHooksPath, outputs.codexHooksJson);
  ensureDirWriteFileAtomicallySync(paths.copilotHooksPath, outputs.copilotHooksJson);
  writeHookShims(outputs.shims, paths.shimRootPath);
}

function parseArgs(args: readonly string[]): { readonly checkMode: boolean } {
  const unknownArgs = args.filter((arg) => arg !== "--" && arg !== "--check");
  if (unknownArgs.length > 0) throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  return { checkMode: args.includes("--check") };
}

function main(): void {
  const { checkMode } = parseArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  const claudeSettingsText = readFileSync(claudeSettingsPath, "utf8");
  const outputs = renderHookWiringOutputsFromManifest(
    readHarnessManifest(repoRoot),
    claudeSettingsText,
  );
  if (checkMode) {
    const stale = [
      ...(claudeSettingsText === outputs.claudeSettingsJson ? [] : [claudeSettingsPath]),
      ...(readFileOrEmpty(codexHooksPath) === outputs.codexHooksJson ? [] : [codexHooksPath]),
      ...(readFileOrEmpty(copilotHooksPath) === outputs.copilotHooksJson ? [] : [copilotHooksPath]),
      ...checkHookShimsOnDisk(outputs.shims, repoRoot),
    ];
    if (stale.length === 0) {
      console.log("Generated hook wiring is up to date.");
      return;
    }
    console.error(`${stale.join(", ")} out of date. Run \`bun run harness:wiring\`.`);
    process.exitCode = 1;
    return;
  }
  writeHookWiringOutputs(outputs);
  console.log(
    `Wrote ${claudeSettingsPath} hooks, ${codexHooksPath}, ${copilotHooksPath}, and ${String(outputs.shims.length)} adapter shims.`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
