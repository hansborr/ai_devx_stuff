import { parseArgs } from "./cli-args.js";
import { usage } from "./cli-help.js";
import { requestDaemonQuery } from "./daemon-client.js";
import { isDaemonRoutableCommand } from "./daemon-commands.js";
import { CodeIntelError } from "./errors.js";
import { formatCodeIntelQueryResult } from "./format.js";
import type { ParsedCli } from "./types.js";

const PROCESS_ARG_OFFSET = 2;

export async function runCodeIntelCli(
  args: string[] = process.argv.slice(PROCESS_ARG_OFFSET),
): Promise<void> {
  try {
    const output = await runCodeIntelCliCommand(args);
    if (output.length > 0) console.log(output);
  } catch (error) {
    if (error instanceof CodeIntelError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

async function runCodeIntelCliCommand(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.command.kind === "help") return usage(parsed.command.topic);
  const daemonOutput = await tryDaemonRoute(parsed);
  if (daemonOutput !== undefined) return daemonOutput;
  return runOneShot(parsed);
}

async function tryDaemonRoute(parsed: ParsedCli): Promise<string | undefined> {
  if (parsed.command.kind === "help" || !isDaemonRoutableCommand(parsed.command)) return undefined;
  const outcome = await requestDaemonQuery(parsed.command);
  if (outcome.kind === "fallback") return undefined;
  return formatCodeIntelQueryResult(outcome.result, parsed.format);
}

async function runOneShot(parsed: ParsedCli): Promise<string> {
  const { runParsedCodeIntel } = await import("./runner.js");
  return runParsedCodeIntel(parsed);
}
