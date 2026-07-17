import type { TriagePacketFilters } from "./drift-ai/triage-packet-types.js";
import { DEFAULT_MIN_CLONE_FRAGMENT } from "./drift-ai/triage-report.js";
import { type CliFormat, parseCliArgs, parseFormatValue } from "./lib/cli.js";

const DEFAULT_PACKET_SIZE = 20;
const PRIORITIES = ["review-first", "review"] as const;
const CATEGORIES = ["maintenance", "structure", "clone", "security"] as const;

export type DriftTriageOptions = {
  readonly inputs: readonly string[];
  readonly format: CliFormat;
  readonly output: string | undefined;
  readonly includeLiterals: boolean;
  readonly includeTypeOnlyCycles: boolean;
  readonly minCloneFragment: number;
  readonly packetDir: string | undefined;
  readonly packetSize: number;
  readonly packetFilters: TriagePacketFilters;
};

export class DriftTriageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriftTriageError";
  }
}

export class DriftTriageHelp extends Error {
  constructor() {
    super(usage());
    this.name = "DriftTriageHelp";
  }
}

function usage(): string {
  return [
    "Usage:",
    "  bun run drift:triage [options] <report.json> [more.json...]",
    "",
    "Inputs may be drift:ai JSON reports or semgrep-candidates/dolos-candidates",
    "prototype advisory JSON. Equivalent evidence is merged before optional",
    "swarm packet generation; every packet item retains raw input provenance.",
    "",
    "Options:",
    "  --format <text|json>",
    "  --output <path>",
    "  --include-literals",
    "  --include-type-only-cycles",
    `  --min-clone-fragment <N>  Dolos longest-fragment floor (default ${String(DEFAULT_MIN_CLONE_FRAGMENT)})`,
    "  --packet-dir <path>        Write deterministic swarm packets and manifest",
    `  --packet-size <N>          Target items per packet (default ${String(DEFAULT_PACKET_SIZE)})`,
    "  --priority <review-first|review>  Repeatable packet filter",
    "  --category <maintenance|structure|clone|security>  Repeatable packet filter",
    "  --source <source>          Repeatable exact evidence-source packet filter",
    "  --path-prefix <prefix>     Repeatable packet location filter",
  ].join("\n");
}

export function parseArgs(argv: readonly string[]): DriftTriageOptions {
  const state = createParseState();
  const fail = (message: string): never => {
    throw new DriftTriageError(message);
  };
  parseCliArgs({
    argv,
    usage: usage(),
    createError: (message) => new DriftTriageError(message),
    onHelp: () => {
      throw new DriftTriageHelp();
    },
    options: optionDefinitions(state, fail),
    onPositional: (value) => state.inputs.push(value),
  });
  validateParsedState(state, fail);
  return toOptions(state);
}

type ParseState = {
  inputs: string[];
  format: CliFormat;
  output: string | undefined;
  includeLiterals: boolean;
  includeTypeOnlyCycles: boolean;
  minCloneFragment: number;
  packetDir: string | undefined;
  packetSize: number;
  priorities: TriagePacketFilters["priorities"][number][];
  categories: TriagePacketFilters["categories"][number][];
  sources: string[];
  pathPrefixes: string[];
  packetSelectionFlag: string | undefined;
};

type OptionDefinition =
  | { readonly name: string; readonly kind: "value"; readonly apply: (value: string) => void }
  | { readonly name: string; readonly kind: "flag"; readonly apply: () => void };

function createParseState(): ParseState {
  return {
    inputs: [],
    format: "text",
    output: undefined,
    includeLiterals: false,
    includeTypeOnlyCycles: false,
    minCloneFragment: DEFAULT_MIN_CLONE_FRAGMENT,
    packetDir: undefined,
    packetSize: DEFAULT_PACKET_SIZE,
    priorities: [],
    categories: [],
    sources: [],
    pathPrefixes: [],
    packetSelectionFlag: undefined,
  };
}

function optionDefinitions(
  state: ParseState,
  fail: (message: string) => never,
): OptionDefinition[] {
  return [
    valueOption("--format", (value) => {
      state.format = parseFormatValue(value, fail);
    }),
    valueOption("--output", (value) => {
      state.output = value;
    }),
    flagOption("--include-literals", () => {
      state.includeLiterals = true;
    }),
    flagOption("--include-type-only-cycles", () => {
      state.includeTypeOnlyCycles = true;
    }),
    valueOption("--min-clone-fragment", (value) => {
      state.minCloneFragment = parseNonNegativeNumber(value, "--min-clone-fragment", fail);
    }),
    valueOption("--packet-dir", (value) => {
      state.packetDir = requireNonEmpty(value, "--packet-dir", fail);
    }),
    valueOption("--packet-size", (value) => {
      state.packetSelectionFlag ??= "--packet-size";
      state.packetSize = parsePositiveInteger(value, "--packet-size", fail);
    }),
    valueOption("--priority", (value) => {
      state.packetSelectionFlag ??= "--priority";
      state.priorities.push(parseChoice(value, "--priority", PRIORITIES, fail));
    }),
    valueOption("--category", (value) => {
      state.packetSelectionFlag ??= "--category";
      state.categories.push(parseChoice(value, "--category", CATEGORIES, fail));
    }),
    valueOption("--source", (value) => {
      state.packetSelectionFlag ??= "--source";
      state.sources.push(requireNonEmpty(value, "--source", fail));
    }),
    valueOption("--path-prefix", (value) => {
      state.packetSelectionFlag ??= "--path-prefix";
      state.pathPrefixes.push(requireNonEmpty(value, "--path-prefix", fail));
    }),
  ];
}

function valueOption(name: string, apply: (value: string) => void): OptionDefinition {
  return { name, kind: "value" as const, apply };
}

function flagOption(name: string, apply: () => void): OptionDefinition {
  return { name, kind: "flag" as const, apply };
}

function validateParsedState(state: ParseState, fail: (message: string) => never): void {
  if (state.inputs.length === 0)
    fail(`drift:triage requires at least one report file.\n${usage()}`);
  if (state.packetDir === undefined && state.packetSelectionFlag !== undefined) {
    fail(`${state.packetSelectionFlag} requires --packet-dir.`);
  }
}

function toOptions(state: ParseState): DriftTriageOptions {
  return {
    inputs: state.inputs,
    format: state.format,
    output: state.output,
    includeLiterals: state.includeLiterals,
    includeTypeOnlyCycles: state.includeTypeOnlyCycles,
    minCloneFragment: state.minCloneFragment,
    packetDir: state.packetDir,
    packetSize: state.packetSize,
    packetFilters: {
      priorities: state.priorities,
      categories: state.categories,
      sources: state.sources,
      pathPrefixes: state.pathPrefixes,
    },
  };
}

function parseChoice<Value extends string>(
  value: string,
  option: string,
  choices: readonly Value[],
  fail: (message: string) => never,
): Value {
  const match = choices.find((choice) => choice === value);
  if (match === undefined) fail(`${option} requires one of: ${choices.join(", ")}.`);
  return match;
}

function parsePositiveInteger(
  value: string,
  option: string,
  fail: (message: string) => never,
): number {
  if (!/^\d+$/u.test(value)) fail(`${option} requires a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${option} requires a positive integer.`);
  return parsed;
}

function parseNonNegativeNumber(
  value: string,
  option: string,
  fail: (message: string) => never,
): number {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) fail(`${option} requires a non-negative number.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail(`${option} requires a non-negative number.`);
  return parsed;
}

function requireNonEmpty(value: string, option: string, fail: (message: string) => never): string {
  if (value.length === 0) fail(`${option} requires a non-empty value.`);
  return value;
}
