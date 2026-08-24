import type { Mode } from "./cli-catalog.js";
import type { CommandHandlerArgs } from "./cli-handler-types.js";

export interface ParsedArgs extends CommandHandlerArgs {
  readonly mode: Mode;
}

export type ParsedArgsState = { -readonly [K in keyof ParsedArgs]: ParsedArgs[K] };
