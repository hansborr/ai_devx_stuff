import { usage } from "./cli-help.js";
import {
  ensureFlagHasNoValue,
  type ParsedOption,
  parseOption,
  readOptionValue,
  requireArg,
  unknownArgument,
} from "./cli-options.js";
import {
  parseDepth,
  parseLimit,
  parseLocation,
  parseProjectFilter,
  parseSymbolName,
} from "./cli-values.js";
import { CodeIntelError } from "./errors.js";
import type { CliCommand, HelpTopic, OutputFormat, ParsedCli, ProjectFilter } from "./types.js";

type DependentsArgState = {
  depth: number;
  excludeTests: boolean;
  limit?: number;
  project?: ProjectFilter;
};

type RefsArgState = {
  limit?: number;
};

type TestsArgState = {
  depth: number;
  depthSpecified: boolean;
  direct: boolean;
  limit?: number;
  project?: ProjectFilter;
};

const SUBCOMMAND_PARSERS: Record<HelpTopic, (args: string[]) => CliCommand> = {
  def: parseDefArgs,
  dependents: parseDependentsArgs,
  exports: parseSingleFileArgs,
  overview: parseOverviewArgs,
  refs: parseRefsArgs,
  tests: parseTestsArgs,
};

export function parseArgs(args: string[]): ParsedCli {
  const globalOptions = parseGlobalOptions(args);
  const command = globalOptions.args[0];
  if (!command) throw new CodeIntelError(usage());

  if (command === "--help" || command === "-h") {
    return { command: { kind: "help" }, format: globalOptions.format };
  }
  const topic = helpTopic(command);
  if (topic && isSubcommandHelp(globalOptions.args.slice(1))) {
    return { command: { kind: "help", topic }, format: globalOptions.format };
  }
  const parser = topic ? SUBCOMMAND_PARSERS[topic] : undefined;
  if (parser) {
    return { command: parser(globalOptions.args.slice(1)), format: globalOptions.format };
  }
  throw new CodeIntelError(`Unknown command: ${command}\n${usage()}`);
}

function helpTopic(command: string): HelpTopic | undefined {
  if (
    command === "def" ||
    command === "exports" ||
    command === "overview" ||
    command === "dependents" ||
    command === "refs" ||
    command === "tests"
  ) {
    return command;
  }
  return undefined;
}

function isSubcommandHelp(args: string[]): boolean {
  return args.length === 1 && (args[0] === "--help" || args[0] === "-h");
}

function parseGlobalOptions(args: string[]): { args: string[]; format: OutputFormat } {
  const parsedArgs: string[] = [];
  let format: OutputFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = requireArg(args[index]);
    if (arg === "--format") {
      const value = args[index + 1];
      if (!value) throw new CodeIntelError("--format requires text or json.");
      format = parseOutputFormat(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      format = parseOutputFormat(arg.slice("--format=".length));
      continue;
    }
    parsedArgs.push(arg);
  }

  return { args: parsedArgs, format };
}

function parseOutputFormat(value: string): OutputFormat {
  if (value === "text" || value === "json") return value;
  throw new CodeIntelError("--format requires text or json.");
}

function parseDefArgs(args: string[]): CliCommand {
  const positional: string[] = [];
  let name: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = requireArg(args[index]);
    const option = parseOption(arg);
    if (!option) {
      positional.push(arg);
      continue;
    }
    if (option.name !== "--name") throw unknownArgument(option.raw);
    const parsed = readOptionValue(option, args, index, "--name requires a symbol name.");
    name = parseSymbolName(parsed.value);
    index = parsed.nextIndex;
  }

  if (name && positional.length > 0) {
    throw new CodeIntelError("Use either def <file>:<line>:<col> or def --name <symbol>.");
  }
  if (name) return { kind: "defName", name };
  if (positional.length !== 1) {
    throw new CodeIntelError(
      "Usage: bun run code:intel -- def <file>:<line>:<col> OR def --name <symbol>",
    );
  }
  const rawLocation = positional[0];
  if (!rawLocation) throw new CodeIntelError("Definition location is required.");
  return { kind: "def", location: parseLocation(rawLocation, "Definition") };
}

function parseSingleFileArgs(args: string[]): CliCommand {
  if (args.length !== 1) throw new CodeIntelError("Usage: bun run code:intel -- exports <file>");
  const file = args[0];
  if (!file) throw new CodeIntelError("exports file argument is required.");
  return { kind: "exports", file };
}

function parseOverviewArgs(args: string[]): CliCommand {
  const positional: string[] = [];
  for (const rawArg of args) {
    const arg = requireArg(rawArg);
    const option = parseOption(arg);
    if (option) throw unknownArgument(option.raw);
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new CodeIntelError("Usage: bun run code:intel -- overview <file>");
  }
  const file = positional[0];
  if (!file) throw new CodeIntelError("overview file argument is required.");
  return { kind: "overview", file };
}

function parseDependentsArgs(args: string[]): CliCommand {
  const positional: string[] = [];
  const state: DependentsArgState = { depth: 1, excludeTests: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = requireArg(args[index]);
    const option = parseOption(arg);
    if (!option) {
      positional.push(arg);
      continue;
    }
    index = consumeDependentsOption(option, args, index, state);
  }

  if (positional.length !== 1) {
    throw new CodeIntelError(
      "Usage: bun run code:intel -- dependents <file> [--depth <N>] [--project <shared|server|client>] [--exclude-tests] [--limit <N>]",
    );
  }
  const file = positional[0];
  if (!file) throw new CodeIntelError("Dependents file argument is required.");
  return {
    kind: "dependents",
    file,
    depth: state.depth,
    excludeTests: state.excludeTests,
    limit: state.limit,
    project: state.project,
  };
}

function consumeDependentsOption(
  option: ParsedOption,
  args: string[],
  index: number,
  state: DependentsArgState,
): number {
  if (option.name === "--exclude-tests") {
    ensureFlagHasNoValue(option);
    state.excludeTests = true;
    return index;
  }
  if (option.name === "--depth") {
    const parsed = readOptionValue(option, args, index, "--depth requires a positive integer.");
    state.depth = parseDepth(parsed.value);
    return parsed.nextIndex;
  }
  if (option.name === "--limit") {
    const parsed = readOptionValue(option, args, index, "--limit requires a non-negative integer.");
    state.limit = parseLimit(parsed.value);
    return parsed.nextIndex;
  }
  if (option.name === "--project") {
    const parsed = readOptionValue(
      option,
      args,
      index,
      "--project requires shared, server, or client.",
    );
    state.project = parseProjectFilter(parsed.value);
    return parsed.nextIndex;
  }
  throw unknownArgument(option.raw);
}

function parseTestsArgs(args: string[]): CliCommand {
  const positional: string[] = [];
  const state: TestsArgState = {
    depth: Number.POSITIVE_INFINITY,
    depthSpecified: false,
    direct: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = requireArg(args[index]);
    const option = parseOption(arg);
    if (!option) {
      positional.push(arg);
      continue;
    }
    index = consumeTestsOption(option, args, index, state);
  }

  if (state.direct && state.depthSpecified) {
    throw new CodeIntelError("Use either --direct or --depth, not both.");
  }
  if (positional.length !== 1) {
    throw new CodeIntelError(
      "Usage: bun run code:intel -- tests <file> [--depth <N>] [--direct] [--project <shared|server|client>] [--limit <N>]",
    );
  }
  const file = positional[0];
  if (!file) throw new CodeIntelError("tests file argument is required.");
  return {
    kind: "tests",
    file,
    depth: state.direct ? 1 : state.depth,
    limit: state.limit,
    project: state.project,
  };
}

function parseRefsArgs(args: string[]): CliCommand {
  const positional: string[] = [];
  const state: RefsArgState = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = requireArg(args[index]);
    const option = parseOption(arg);
    if (!option) {
      positional.push(arg);
      continue;
    }
    if (option.name !== "--limit") throw unknownArgument(option.raw);
    const parsed = readOptionValue(option, args, index, "--limit requires a non-negative integer.");
    state.limit = parseLimit(parsed.value);
    index = parsed.nextIndex;
  }

  if (positional.length !== 1) {
    throw new CodeIntelError("Usage: bun run code:intel -- refs <file>:<line>:<col> [--limit <N>]");
  }
  const rawLocation = positional[0];
  if (!rawLocation) throw new CodeIntelError("References location is required.");
  return { kind: "refs", location: parseLocation(rawLocation, "References"), limit: state.limit };
}

function consumeTestsOption(
  option: ParsedOption,
  args: string[],
  index: number,
  state: TestsArgState,
): number {
  if (option.name === "--direct") {
    ensureFlagHasNoValue(option);
    state.direct = true;
    return index;
  }
  if (option.name === "--depth") {
    const parsed = readOptionValue(option, args, index, "--depth requires a positive integer.");
    state.depth = parseDepth(parsed.value);
    state.depthSpecified = true;
    return parsed.nextIndex;
  }
  if (option.name === "--limit") {
    const parsed = readOptionValue(option, args, index, "--limit requires a non-negative integer.");
    state.limit = parseLimit(parsed.value);
    return parsed.nextIndex;
  }
  if (option.name === "--project") {
    const parsed = readOptionValue(
      option,
      args,
      index,
      "--project requires shared, server, or client.",
    );
    state.project = parseProjectFilter(parsed.value);
    return parsed.nextIndex;
  }
  throw unknownArgument(option.raw);
}
