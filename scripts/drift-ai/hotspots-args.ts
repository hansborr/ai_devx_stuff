import { z } from "zod";

import { windowDaysValue } from "./advisory-common.js";
import { positiveIntValue } from "./arg-readers.js";
import { DriftAiError } from "./errors.js";
import type { ConcreteHotspotLens, HotspotLens } from "./hotspots-format.js";
import { DEFAULT_WINDOW_DAYS } from "./hotspots-history.js";
import { CONCRETE_HOTSPOT_LENSES } from "./hotspots-lens-registry.js";
import {
  CONFIG_CLI_OPTION,
  configSchemaShape,
  parseSubcommandCli,
  SUBCOMMAND_BASE_CLI_OPTIONS,
  subcommandBaseFromOptions,
  type SubcommandBaseOptions,
  subcommandBaseSchemaShape,
} from "./subcommand-args.js";

const DEFAULT_TOP_N = 20;

// Resolve a parsed `--lens` to the concrete lenses it selects: `all` fans out
// to every registered lens in registry order, each concrete lens to itself.
// Derived (not tabulated), so a registered lens cannot drop out of the fan-out.
export function lensSelection(lens: HotspotLens): readonly ConcreteHotspotLens[] {
  return lens === "all" ? CONCRETE_HOTSPOT_LENSES : [lens];
}

// Every accepted `--lens` value, `<choice|choice|...>` style, for the usage and
// error prose — derived from the registry so the prose cannot omit a lens.
const LENS_CHOICES = [...CONCRETE_HOTSPOT_LENSES, "all"].join("|");

const HOTSPOT_LENS_VALUES: ReadonlyMap<string, HotspotLens> = new Map<string, HotspotLens>([
  ...CONCRETE_HOTSPOT_LENSES.map((lens): [string, HotspotLens] => [lens, lens]),
  ["all", "all"],
]);

const HOTSPOTS_USAGE = [
  "Usage:",
  "  bun run drift:ai hotspots",
  `  bun run drift:ai hotspots --lens <${LENS_CHOICES}>`,
  "  bun run drift:ai hotspots --window <days> --top <N>",
  "  bun run drift:ai hotspots --lens coupling --min-support <N>",
  "  bun run drift:ai hotspots --baseline <prev.json>",
  "  bun run drift:ai hotspots --format <text|json> [--output <path>]",
  "  bun run drift:ai hotspots --config <path>",
  "",
  "Report-only advisory (exit 0). Areas to check, not defects. Whole-repo (no",
  `--scope). Git-only lenses: ${CONCRETE_HOTSPOT_LENSES.join(", ")}.`,
].join("\n");

export type ParsedHotspotsArgs = {
  readonly base: SubcommandBaseOptions;
  readonly lens: HotspotLens;
  readonly windowDays: number;
  readonly top: number;
  readonly minSupport: number | null;
  readonly baselinePath: string | null;
};

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--lens", kind: "value" },
  { name: "--window", kind: "value" },
  { name: "--top", kind: "value" },
  { name: "--min-support", kind: "value" },
  { name: "--baseline", kind: "value" },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--lens": z
    .string()
    .transform((value) => parseLens(value))
    .default("churn"),
  "--window": windowDaysValue(DEFAULT_WINDOW_DAYS).default(DEFAULT_WINDOW_DAYS),
  "--top": positiveIntValue("--top").default(DEFAULT_TOP_N),
  "--min-support": positiveIntValue("--min-support").optional(),
  "--baseline": z.string().optional(),
});

export function parseHotspotsArgs(argv: readonly string[]): ParsedHotspotsArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: HOTSPOTS_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return {
    base: subcommandBaseFromOptions(options),
    lens: options["--lens"],
    windowDays: options["--window"],
    top: options["--top"],
    minSupport: options["--min-support"] ?? null,
    baselinePath: options["--baseline"] ?? null,
  };
}

function parseLens(value: string): HotspotLens {
  const lens = HOTSPOT_LENS_VALUES.get(value);
  if (lens !== undefined) return lens;
  throw new DriftAiError(`--lens requires one of ${LENS_CHOICES} (got '${value}').`);
}
