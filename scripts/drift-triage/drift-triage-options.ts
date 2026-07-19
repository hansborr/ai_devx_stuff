import { z } from "zod";

import { type CliFormat, parseCli } from "../lib/cli.js";
import type { TriagePacketFilters } from "./triage-packet-types.js";
import { DEFAULT_MIN_CLONE_FRAGMENT } from "./triage-report.js";

const DEFAULT_PACKET_SIZE = 20;
const PRIORITIES = ["review-first", "review"] as const;
const CATEGORIES = ["maintenance", "structure", "clone", "security"] as const;
// Any of these flags is meaningless without --packet-dir; the first one seen in
// argv order names the "<flag> requires --packet-dir." diagnostic.
const PACKET_SELECTION_FLAGS = [
  "--packet-size",
  "--priority",
  "--category",
  "--source",
  "--path-prefix",
] as const;

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

function positiveInteger(option: string): z.ZodPipe<z.ZodString, z.ZodTransform<number, string>> {
  return z
    .string()
    .refine(
      (value) => {
        if (!/^\d+$/u.test(value)) return false;
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed > 0;
      },
      { error: `${option} requires a positive integer.` },
    )
    .transform(Number);
}

function nonNegativeNumber(option: string): z.ZodPipe<z.ZodString, z.ZodTransform<number, string>> {
  return z
    .string()
    .refine((value) => /^\d+(?:\.\d+)?$/u.test(value) && Number.isFinite(Number(value)), {
      error: `${option} requires a non-negative number.`,
    })
    .transform(Number);
}

function choice<const Values extends readonly [string, ...string[]]>(
  option: string,
  values: Values,
): z.ZodEnum<{ [Value in Values[number]]: Value }> {
  return z.enum(values, { error: `${option} requires one of: ${values.join(", ")}.` });
}

const cliOptionsSchema = z.object({
  "--format": z
    .enum(["text", "json"], { error: "--format requires text or json." })
    .default("text"),
  "--output": z.string().optional(),
  "--include-literals": z.boolean().default(false),
  "--include-type-only-cycles": z.boolean().default(false),
  "--min-clone-fragment": nonNegativeNumber("--min-clone-fragment").default(
    DEFAULT_MIN_CLONE_FRAGMENT,
  ),
  "--packet-dir": z.string().optional(),
  "--packet-size": positiveInteger("--packet-size").default(DEFAULT_PACKET_SIZE),
  "--priority": z.array(choice("--priority", PRIORITIES)).default([]),
  "--category": z.array(choice("--category", CATEGORIES)).default([]),
  "--source": z.array(z.string()).default([]),
  "--path-prefix": z.array(z.string()).default([]),
});

function firstPacketSelectionFlag(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    const match = PACKET_SELECTION_FLAGS.find((flag) => arg === flag || arg.startsWith(`${flag}=`));
    if (match !== undefined) return match;
  }
  return undefined;
}

export function parseArgs(argv: readonly string[]): DriftTriageOptions {
  const parsed = parseCli({
    argv,
    usage: usage(),
    createError: (message) => new DriftTriageError(message),
    onHelp: () => {
      throw new DriftTriageHelp();
    },
    options: [
      { name: "--format", kind: "value" },
      { name: "--output", kind: "value" },
      { name: "--include-literals", kind: "flag" },
      { name: "--include-type-only-cycles", kind: "flag" },
      { name: "--min-clone-fragment", kind: "value" },
      { name: "--packet-dir", kind: "value" },
      { name: "--packet-size", kind: "value" },
      { name: "--priority", kind: "value", repeatable: true },
      { name: "--category", kind: "value", repeatable: true },
      { name: "--source", kind: "value", repeatable: true },
      { name: "--path-prefix", kind: "value", repeatable: true },
    ],
    schema: cliOptionsSchema,
  });

  if (parsed.positionals.length === 0) {
    throw new DriftTriageError(`drift:triage requires at least one report file.\n${usage()}`);
  }
  const packetDir = parsed.options["--packet-dir"];
  if (packetDir === undefined) {
    const selection = firstPacketSelectionFlag(argv);
    if (selection !== undefined) {
      throw new DriftTriageError(`${selection} requires --packet-dir.`);
    }
  }
  return {
    inputs: parsed.positionals,
    format: parsed.options["--format"],
    output: parsed.options["--output"],
    includeLiterals: parsed.options["--include-literals"],
    includeTypeOnlyCycles: parsed.options["--include-type-only-cycles"],
    minCloneFragment: parsed.options["--min-clone-fragment"],
    packetDir,
    packetSize: parsed.options["--packet-size"],
    packetFilters: {
      priorities: parsed.options["--priority"],
      categories: parsed.options["--category"],
      sources: parsed.options["--source"],
      pathPrefixes: parsed.options["--path-prefix"],
    },
  };
}
