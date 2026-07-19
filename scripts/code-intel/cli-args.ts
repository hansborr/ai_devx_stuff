import { z } from "zod";

import { readRequiredOptionValue, requireArg as sharedRequireArg } from "../cli-option-values.js";
import { matchesOption, parseCli, parseFormatValue } from "../lib/cli.js";
import { usage } from "./cli-help.js";
import {
  parseDepth,
  parseLimit,
  parseLocation,
  parseProjectFilter,
  parseSymbolName,
} from "./cli-values.js";
import { CodeIntelError } from "./errors.js";
import type { CliCommand, HelpTopic, OutputFormat, ParsedCli } from "./types.js";

// code:intel parse-error contract: every failure throws CodeIntelError (the
// "code:intel: " prefix comes from the class), cli-main maps it to exit 1, and
// unknown-argument diagnostics carry no usage suffix — hence the empty `usage`
// handed to parseCli below. Coercion lives in cli-values.ts; the schemas here
// reuse those parsers as transforms, so the exact thrown error identities are
// unchanged.

const createError = (message: string): Error => new CodeIntelError(message);

const fail = (message: string): never => {
  throw new CodeIntelError(message);
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

// The global pass is a pass-through filter (extract --format anywhere, keep
// every other token for the subcommand parser), which is exactly what
// parseCli deliberately does not do — so this one small loop stays by hand,
// riding the same shared value reader.
function parseGlobalOptions(args: string[]): { args: string[]; format: OutputFormat } {
  const rest: string[] = [];
  let format: OutputFormat = "text";

  for (let index = 0; index < args.length; index += 1) {
    const arg = sharedRequireArg(args[index], fail);
    if (matchesOption(arg, "--format")) {
      const parsed = readRequiredOptionValue({
        arg,
        argv: args,
        index,
        message: "--format requires text or json.",
        createError,
      });
      format = parseFormatValue(parsed.value, fail);
      index = parsed.nextIndex;
      continue;
    }
    rest.push(arg);
  }

  return { args: rest, format };
}

// The pre-spec parsers treated every single-dash token as an (unknown) option;
// parseCli routes them to positionals, so re-reject them for byte-identical
// diagnostics before any positional-count usage error.
function rejectDashPositionals(positionals: readonly string[]): void {
  const dashToken = positionals.find((token) => token.startsWith("-"));
  if (dashToken !== undefined) throw new CodeIntelError(`Unknown argument: ${dashToken}`);
}

const defSchema = z.object({
  "--name": z
    .string()
    .transform((value) => parseSymbolName(value))
    .optional(),
});

function parseDefArgs(args: string[]): CliCommand {
  const parsed = parseCli({
    argv: args,
    usage: "",
    createError,
    options: [
      { name: "--name", kind: "value", valueErrorMessage: "--name requires a symbol name." },
    ],
    schema: defSchema,
  });
  rejectDashPositionals(parsed.positionals);
  const name = parsed.options["--name"];
  if (name !== undefined && parsed.positionals.length > 0) {
    throw new CodeIntelError("Use either def <file>:<line>:<col> or def --name <symbol>.");
  }
  if (name !== undefined) return { kind: "defName", name };
  if (parsed.positionals.length !== 1) {
    throw new CodeIntelError(
      "Usage: bun run code:intel -- def <file>:<line>:<col> OR def --name <symbol>",
    );
  }
  const rawLocation = parsed.positionals[0];
  if (!rawLocation) throw new CodeIntelError("Definition location is required.");
  return { kind: "def", location: parseLocation(rawLocation, "Definition") };
}

// A fixed positional destructure (merge-CLI shape): any single token — even an
// option-like one — is the file argument, so this stays off parseCli.
function parseSingleFileArgs(args: string[]): CliCommand {
  if (args.length !== 1) throw new CodeIntelError("Usage: bun run code:intel -- exports <file>");
  const file = args[0];
  if (!file) throw new CodeIntelError("exports file argument is required.");
  return { kind: "exports", file };
}

const overviewSchema = z.object({});

function parseOverviewArgs(args: string[]): CliCommand {
  const parsed = parseCli({
    argv: args,
    usage: "",
    createError,
    options: [],
    schema: overviewSchema,
  });
  rejectDashPositionals(parsed.positionals);
  if (parsed.positionals.length !== 1) {
    throw new CodeIntelError("Usage: bun run code:intel -- overview <file>");
  }
  const file = parsed.positionals[0];
  if (!file) throw new CodeIntelError("overview file argument is required.");
  return { kind: "overview", file };
}

const dependentsSchema = z.object({
  "--depth": z
    .string()
    .transform((value) => parseDepth(value))
    .default(1),
  "--exclude-tests": z.boolean().default(false),
  "--limit": z
    .string()
    .transform((value) => parseLimit(value))
    .optional(),
  "--project": z
    .string()
    .transform((value) => parseProjectFilter(value))
    .optional(),
});

function parseDependentsArgs(args: string[]): CliCommand {
  const parsed = parseCli({
    argv: args,
    usage: "",
    createError,
    options: [
      { name: "--depth", kind: "value", valueErrorMessage: "--depth requires a positive integer." },
      { name: "--exclude-tests", kind: "flag" },
      {
        name: "--limit",
        kind: "value",
        valueErrorMessage: "--limit requires a non-negative integer.",
      },
      {
        name: "--project",
        kind: "value",
        valueErrorMessage: "--project requires shared, server, or client.",
      },
    ],
    schema: dependentsSchema,
  });
  rejectDashPositionals(parsed.positionals);
  if (parsed.positionals.length !== 1) {
    throw new CodeIntelError(
      "Usage: bun run code:intel -- dependents <file> [--depth <N>] [--project <shared|server|client>] [--exclude-tests] [--limit <N>]",
    );
  }
  const file = parsed.positionals[0];
  if (!file) throw new CodeIntelError("Dependents file argument is required.");
  return {
    kind: "dependents",
    file,
    depth: parsed.options["--depth"],
    excludeTests: parsed.options["--exclude-tests"],
    limit: parsed.options["--limit"],
    project: parsed.options["--project"],
  };
}

const testsSchema = z.object({
  "--depth": z
    .string()
    .transform((value) => parseDepth(value))
    .optional(),
  "--direct": z.boolean().default(false),
  "--limit": z
    .string()
    .transform((value) => parseLimit(value))
    .optional(),
  "--project": z
    .string()
    .transform((value) => parseProjectFilter(value))
    .optional(),
});

function parseTestsArgs(args: string[]): CliCommand {
  const parsed = parseCli({
    argv: args,
    usage: "",
    createError,
    options: [
      { name: "--depth", kind: "value", valueErrorMessage: "--depth requires a positive integer." },
      { name: "--direct", kind: "flag" },
      {
        name: "--limit",
        kind: "value",
        valueErrorMessage: "--limit requires a non-negative integer.",
      },
      {
        name: "--project",
        kind: "value",
        valueErrorMessage: "--project requires shared, server, or client.",
      },
    ],
    schema: testsSchema,
  });
  rejectDashPositionals(parsed.positionals);
  const direct = parsed.options["--direct"];
  const depth = parsed.options["--depth"];
  if (direct && depth !== undefined) {
    throw new CodeIntelError("Use either --direct or --depth, not both.");
  }
  if (parsed.positionals.length !== 1) {
    throw new CodeIntelError(
      "Usage: bun run code:intel -- tests <file> [--depth <N>] [--direct] [--project <shared|server|client>] [--limit <N>]",
    );
  }
  const file = parsed.positionals[0];
  if (!file) throw new CodeIntelError("tests file argument is required.");
  return {
    kind: "tests",
    file,
    depth: direct ? 1 : (depth ?? Number.POSITIVE_INFINITY),
    limit: parsed.options["--limit"],
    project: parsed.options["--project"],
  };
}

const refsSchema = z.object({
  "--limit": z
    .string()
    .transform((value) => parseLimit(value))
    .optional(),
});

function parseRefsArgs(args: string[]): CliCommand {
  const parsed = parseCli({
    argv: args,
    usage: "",
    createError,
    options: [
      {
        name: "--limit",
        kind: "value",
        valueErrorMessage: "--limit requires a non-negative integer.",
      },
    ],
    schema: refsSchema,
  });
  rejectDashPositionals(parsed.positionals);
  if (parsed.positionals.length !== 1) {
    throw new CodeIntelError("Usage: bun run code:intel -- refs <file>:<line>:<col> [--limit <N>]");
  }
  const rawLocation = parsed.positionals[0];
  if (!rawLocation) throw new CodeIntelError("References location is required.");
  return {
    kind: "refs",
    location: parseLocation(rawLocation, "References"),
    limit: parsed.options["--limit"],
  };
}
