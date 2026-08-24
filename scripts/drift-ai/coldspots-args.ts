// Argument parser for the `coldspots` subcommand. Mirrors `hotspots-args.ts`:
// a `--lens` selection map + dispatch (so adding `stale-markers` later is a map
// entry, not a rewrite), `--window`/`--top`, `--config`/`--baseline`, plus the
// coldspot lens's threshold overrides. Composes the shared subcommand base
// fragments (`parseSubcommandCli`/`SubcommandBaseOptions`).

import { z } from "zod";

import { windowDaysValue } from "./advisory-common.js";
import { positiveIntValue } from "./arg-readers.js";
import type { ColdspotLens } from "./coldspots-format.js";
import { DriftAiError } from "./errors.js";
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
// Coldspots needs deeper history than the 14d hotspots default — stillness is only
// meaningful over a longer horizon — so it defaults to the human-team hotspot
// horizon (also the collector's widen cap). The collector still widens if sparse.
const DEFAULT_COLDSPOT_WINDOW_DAYS = 180;

export type ConcreteColdspotLens = Exclude<ColdspotLens, "all">;

const CONCRETE_COLDSPOT_LENSES: readonly ConcreteColdspotLens[] = ["coldspot", "stale-markers"];

export const COLDSPOT_LENS_SELECTIONS: Record<ColdspotLens, readonly ConcreteColdspotLens[]> = {
  coldspot: ["coldspot"],
  "stale-markers": ["stale-markers"],
  all: CONCRETE_COLDSPOT_LENSES,
};

const COLDSPOT_LENS_VALUES: ReadonlyMap<string, ColdspotLens> = new Map<string, ColdspotLens>([
  ...CONCRETE_COLDSPOT_LENSES.map((lens): [string, ColdspotLens] => [lens, lens]),
  ["all", "all"],
]);

const COLDSPOTS_USAGE = [
  "Usage:",
  "  bun run drift:ai coldspots",
  "  bun run drift:ai coldspots --lens <coldspot|stale-markers|all>",
  "  bun run drift:ai coldspots --window <days> --top <N>",
  "  bun run drift:ai coldspots --age-threshold <days> --revision-floor <N>",
  "  bun run drift:ai coldspots --neighborhood-ratio <K> --birth-burst-files <N> --birth-burst-lines <M>",
  "  bun run drift:ai coldspots --gone-silent-days <days> --large-file-lines <N>",
  "  bun run drift:ai coldspots --lens stale-markers --marker-age-threshold <days>",
  "  bun run drift:ai coldspots --baseline <prev.json>",
  "  bun run drift:ai coldspots --format <text|json> [--output <path>]",
  "  bun run drift:ai coldspots --config <path>",
  "",
  "Report-only advisory (exit 0). Areas to check, not defects. Whole-repo command",
  "(no --scope), but the coldspot lens only considers files touched in the effective",
  "git window; current files with no in-window commits need a separate zero-touch",
  "evidence model. A coldspot is surfaced only when it is old, barely-touched, AND",
  "at least one amplifier fires (stale-in-hot-neighborhood, write-once-birth-burst,",
  "gone-silent-author, large-file-cold). The stale-markers lens ages TODO/FIXME/",
  "HACK/XXX/@deprecated comments by their git introduction date.",
].join("\n");

export type ParsedColdspotsArgs = {
  readonly base: SubcommandBaseOptions;
  readonly lens: ColdspotLens;
  readonly windowDays: number;
  readonly top: number;
  readonly baselinePath: string | null;
  // null = use the reducer's default for that threshold.
  readonly ageThresholdDays: number | null;
  readonly revisionFloor: number | null;
  readonly neighborhoodChurnRatio: number | null;
  readonly birthBurstFiles: number | null;
  readonly birthBurstLines: number | null;
  readonly goneSilentDays: number | null;
  readonly largeFileChurnLines: number | null;
  // stale-markers lens threshold (separate axis from the coldspot age floor).
  readonly markerAgeThresholdDays: number | null;
};

const CLI_OPTIONS = [
  ...SUBCOMMAND_BASE_CLI_OPTIONS,
  CONFIG_CLI_OPTION,
  { name: "--lens", kind: "value" },
  { name: "--window", kind: "value" },
  { name: "--top", kind: "value" },
  { name: "--baseline", kind: "value" },
  { name: "--age-threshold", kind: "value" },
  { name: "--revision-floor", kind: "value" },
  { name: "--neighborhood-ratio", kind: "value" },
  { name: "--birth-burst-files", kind: "value" },
  { name: "--birth-burst-lines", kind: "value" },
  { name: "--gone-silent-days", kind: "value" },
  { name: "--large-file-lines", kind: "value" },
  { name: "--marker-age-threshold", kind: "value" },
] as const;

const cliOptionsSchema = z.object({
  ...subcommandBaseSchemaShape,
  ...configSchemaShape,
  "--lens": z
    .string()
    .transform((value) => parseLens(value))
    .default("coldspot"),
  "--window": windowDaysValue(DEFAULT_COLDSPOT_WINDOW_DAYS).default(DEFAULT_COLDSPOT_WINDOW_DAYS),
  "--top": positiveIntValue("--top").default(DEFAULT_TOP_N),
  "--baseline": z.string().optional(),
  "--age-threshold": positiveIntValue("--age-threshold").optional(),
  "--revision-floor": positiveIntValue("--revision-floor").optional(),
  "--neighborhood-ratio": positiveIntValue("--neighborhood-ratio").optional(),
  "--birth-burst-files": positiveIntValue("--birth-burst-files").optional(),
  "--birth-burst-lines": positiveIntValue("--birth-burst-lines").optional(),
  "--gone-silent-days": positiveIntValue("--gone-silent-days").optional(),
  "--large-file-lines": positiveIntValue("--large-file-lines").optional(),
  "--marker-age-threshold": positiveIntValue("--marker-age-threshold").optional(),
});

export function parseColdspotsArgs(argv: readonly string[]): ParsedColdspotsArgs {
  const { options } = parseSubcommandCli({
    argv,
    usage: COLDSPOTS_USAGE,
    options: CLI_OPTIONS,
    schema: cliOptionsSchema,
  });
  return {
    base: subcommandBaseFromOptions(options),
    lens: options["--lens"],
    windowDays: options["--window"],
    top: options["--top"],
    baselinePath: options["--baseline"] ?? null,
    ageThresholdDays: options["--age-threshold"] ?? null,
    revisionFloor: options["--revision-floor"] ?? null,
    neighborhoodChurnRatio: options["--neighborhood-ratio"] ?? null,
    birthBurstFiles: options["--birth-burst-files"] ?? null,
    birthBurstLines: options["--birth-burst-lines"] ?? null,
    goneSilentDays: options["--gone-silent-days"] ?? null,
    largeFileChurnLines: options["--large-file-lines"] ?? null,
    markerAgeThresholdDays: options["--marker-age-threshold"] ?? null,
  };
}

function parseLens(value: string): ColdspotLens {
  const lens = COLDSPOT_LENS_VALUES.get(value);
  if (lens !== undefined) return lens;
  throw new DriftAiError(`--lens requires one of coldspot|stale-markers|all (got '${value}').`);
}
