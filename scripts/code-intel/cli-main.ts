import { parseArgs } from "./cli-args.js";
import { usage } from "./cli-help.js";
import { CodeIntelError } from "./errors.js";
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

export async function runCodeIntelCliCommand(args: string[]): Promise<string> {
  const parsed = parseArgs(args);
  if (parsed.command.kind === "help") return usage(parsed.command.topic);
  return runOneShot(parsed);
}

async function runOneShot(parsed: ParsedCli): Promise<string> {
  const { runParsedCodeIntel } = await import("./runner.js");
  return runParsedCodeIntel(parsed);
}
