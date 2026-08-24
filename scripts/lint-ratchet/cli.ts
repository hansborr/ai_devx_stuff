import { parseArgs as nodeParseArgs } from "node:util";

import {
  type CommandOption,
  deriveHeadOptions,
  deriveInlineValueFlags,
  deriveModeLookup,
  deriveOptionLookup,
  deriveStringFlagMessages,
  deriveTerminalLookup,
  type TerminalCommand,
} from "./cli-catalog.js";
import { UsageError } from "./cli-errors.js";
import type { ParsedArgs, ParsedArgsState } from "./cli-types.js";
import { validateAndBuild } from "./cli-validate.js";
import { parseProposeCliOptions, ProposeArgsUsageError } from "./propose-cli-options.js";

export { UsageError } from "./cli-errors.js";
export type { ParsedArgs } from "./cli-types.js";
export { usage } from "./cli-usage.js";

export const PROCESS_ARG_OFFSET = 2;
const DEFAULT_SUMMARY_DIRECTORY_DEPTH = 3;
const DECIMAL_RADIX = 10;

// Modes selected by a bare flag; each flag name doubles as its mode id.
const MODE_FLAGS = deriveModeLookup();

// Modes that consume the rest of argv as their own sub-grammar; split off before
// the head is tokenized so a later flag reads as their argument (and a mode
// already chosen in the head collides here, not the other way round).
// Matched against raw argv, so these carry the `--` prefix (unlike MODE_FLAGS,
// which is matched against parseArgs token names).
const TERMINAL_FLAGS = deriveTerminalLookup();

// node:util parseArgs option spec for the head grammar. Value flags are `string`,
// every mode/boolean flag is `boolean`. `strict: false` keeps parseArgs from
// throwing so this module owns every diagnostic; an unknown flag surfaces as a
// boolean token this walker rejects by name.
const HEAD_OPTIONS = deriveHeadOptions();

// Only these two flags ever accepted the inline `--flag=value` form; the old
// parser rejected `=` on every other flag (including boolean/mode flags, where
// `--allow-worse=false` must not silently enable the flag) as an unknown
// argument. Everything else keeps that rejection.
const INLINE_VALUE_FLAGS = deriveInlineValueFlags();

const STRING_FLAG_MESSAGES = deriveStringFlagMessages();
const OPTION_FLAGS = deriveOptionLookup();

// The node:util token shapes, spelled out so the walker's helpers can take a
// precise parameter type without an inferred-return annotation.
type HeadOptionToken = {
  readonly kind: "option";
  readonly index: number;
  readonly name: string;
  readonly rawName: string;
  readonly value: string | undefined;
  readonly inlineValue: boolean | undefined;
};
type HeadToken =
  | HeadOptionToken
  | { readonly kind: "positional"; readonly index: number; readonly value: string }
  | { readonly kind: "option-terminator"; readonly index: number };

function tokenizeHead(args: readonly string[]): readonly HeadToken[] {
  return nodeParseArgs({ args: [...args], options: HEAD_OPTIONS, strict: false, tokens: true })
    .tokens;
}

function setMode(state: ParsedArgsState, mode: Exclude<ParsedArgs["mode"], "default">): void {
  if (state.mode !== "default") throw new UsageError("choose only one mode");
  state.mode = mode;
}

function unknownArgumentMessage(arg: string): string {
  return arg.startsWith("--input")
    ? "--input is not supported; use bun run lint:ratchet:report < diagnostics.json"
    : `Unknown argument: ${arg}`;
}

function parsePositiveInteger(value: string, message: string): number {
  const parsed = Number.parseInt(value, DECIMAL_RADIX);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new UsageError(message);
  }
  return parsed;
}

// A space-form value that looks like a flag (`--reason --allow-worse`) means the
// argument was forgotten; the inline form (`--reason=`) is taken verbatim, so an
// empty or dashed reason is still accepted here and rejected later by content.
function requireValue(token: HeadOptionToken, message: string): string {
  if (token.value === undefined) throw new UsageError(message);
  if (!token.inlineValue && token.value.startsWith("--")) throw new UsageError(message);
  return token.value;
}

function assignStateValue(
  state: ParsedArgsState,
  stateKey: CommandOption["stateKey"],
  value: boolean | number | readonly string[] | string,
): void {
  Reflect.set(state, stateKey, value);
}

// Apply one option token. `raw` is the original argv token, used verbatim in
// unknown-argument diagnostics. `--by-directory` optionally takes the depth from
// the positional that follows it, so return whether that positional was consumed.
function applyOptionToken(
  state: ParsedArgsState,
  token: HeadOptionToken,
  raw: string,
  followingPositional: string | undefined,
): boolean {
  const { name } = token;
  // Reject an inline value on any flag that never accepted one (booleans, modes,
  // and the non-reason value flags), matching the old exact-string dispatch.
  if (token.inlineValue === true && !INLINE_VALUE_FLAGS.has(name)) {
    throw new UsageError(unknownArgumentMessage(raw));
  }
  const mode = MODE_FLAGS.get(name);
  if (mode !== undefined) {
    setMode(state, mode);
    return false;
  }
  const option = OPTION_FLAGS.get(name);
  if (option === undefined) throw new UsageError(unknownArgumentMessage(raw));
  if (option.valueParser === "directory-depth") {
    return applyByDirectory(state, option, followingPositional);
  }
  if (option.valueParser === "positive-integer") {
    const message = option.missingValueMessage;
    if (message === undefined) throw new UsageError(unknownArgumentMessage(raw));
    assignStateValue(
      state,
      option.stateKey,
      parsePositiveInteger(requireValue(token, message), message),
    );
    return false;
  }
  if (option.type === "string") {
    const message = STRING_FLAG_MESSAGES[name];
    if (message === undefined) throw new UsageError(unknownArgumentMessage(raw));
    assignStateValue(state, option.stateKey, requireValue(token, message));
    return false;
  }
  assignStateValue(state, option.stateKey, true);
  return false;
}

function applyByDirectory(
  state: ParsedArgsState,
  option: CommandOption,
  followingPositional: string | undefined,
): boolean {
  if (followingPositional === undefined) {
    assignStateValue(state, option.stateKey, DEFAULT_SUMMARY_DIRECTORY_DEPTH);
    return false;
  }
  assignStateValue(
    state,
    option.stateKey,
    parsePositiveInteger(followingPositional, "--by-directory depth must be a positive integer"),
  );
  return true;
}

function parseHead(state: ParsedArgsState, head: readonly string[]): void {
  // Keep `--` as an option-terminator token rather than stripping it: dropping it
  // would let a value flag reconnect to the token past the separator (so
  // `--reason -- x` would wrongly bind "x"). Tokens after `--` become positionals
  // and are rejected as unknown arguments below.
  const tokens = tokenizeHead(head);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.kind === "option-terminator") continue;
    if (token.kind === "positional") throw new UsageError(unknownArgumentMessage(token.value));
    const raw = head[token.index] ?? `--${token.name}`;
    const next = tokens[index + 1];
    const followingPositional =
      token.name === "by-directory" && next?.kind === "positional" ? next.value : undefined;
    if (applyOptionToken(state, token, raw, followingPositional)) index += 1;
  }
}

function applyPropose(state: ParsedArgsState, tail: readonly string[]): void {
  setMode(state, "propose");
  let parsed: ReturnType<typeof parseProposeCliOptions>;
  try {
    parsed = parseProposeCliOptions(tail);
  } catch (error) {
    if (error instanceof ProposeArgsUsageError) throw new UsageError(error.message);
    throw error;
  }
  state.proposeRuleId = parsed.ruleId;
  state.proposeFiles = parsed.files;
  if (parsed.ignores !== undefined) state.proposeIgnores = parsed.ignores;
  if (parsed.metric !== undefined) state.proposeMetric = parsed.metric;
  if (parsed.ruleOptionsJson !== undefined) state.proposeRuleOptionsJson = parsed.ruleOptionsJson;
  if (parsed.pluginModule !== undefined) state.proposePluginModule = parsed.pluginModule;
  if (parsed.pluginExport !== undefined) state.proposePluginExport = parsed.pluginExport;
  if (parsed.parserProfile !== undefined) state.proposeParserProfile = parsed.parserProfile;
}

function applyTerminal(
  state: ParsedArgsState,
  terminal: TerminalCommand,
  tail: readonly string[],
): void {
  if (terminal.tail === "propose") {
    applyPropose(state, tail);
    return;
  }
  const paths = tail.filter((value) => value.length > 0);
  setMode(state, terminal.mode);
  assignStateValue(state, terminal.stateKey, paths);
}

export function parseArgs(args: readonly string[]): ParsedArgs {
  const state: ParsedArgsState = { mode: "default", allowWorse: false };
  const terminalIndex = args.findIndex((arg) => TERMINAL_FLAGS.has(arg));
  const head = terminalIndex === -1 ? args : args.slice(0, terminalIndex);
  parseHead(state, head);
  if (terminalIndex !== -1) {
    const rawTerminal = args[terminalIndex] ?? "";
    const terminal = TERMINAL_FLAGS.get(rawTerminal);
    if (terminal === undefined) throw new UsageError(unknownArgumentMessage(rawTerminal));
    applyTerminal(state, terminal, args.slice(terminalIndex + 1));
  }
  return validateAndBuild(state);
}
