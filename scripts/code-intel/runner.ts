import { parseArgs } from "./cli-args.js";
import { usage } from "./cli-help.js";
import { formatCodeIntelQueryResult } from "./format.js";
import { executeCodeIntelQuery } from "./query-executor.js";
import type { CodeIntelContext } from "./source-project.js";
import type { ParsedCli } from "./types.js";

export function runParsedCodeIntel(parsed: ParsedCli, context: CodeIntelContext = {}): string {
  const { command, format } = parsed;
  if (command.kind === "help") return usage(command.topic);
  return formatCodeIntelQueryResult(executeCodeIntelQuery(command, context), format);
}

export function runCodeIntel(args: string[], context: CodeIntelContext = {}): string {
  return runParsedCodeIntel(parseArgs(args), context);
}
