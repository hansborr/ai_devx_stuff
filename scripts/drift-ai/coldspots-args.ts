// Argument parser for the `coldspots` subcommand. Mirrors `hotspots-args.ts`:
// a `--lens` selection map + dispatch (so adding `stale-markers` later is a map
// entry, not a rewrite), `--window`/`--top`, `--config`/`--baseline`, plus the
// coldspot lens's threshold overrides. Reuses the shared subcommand arg base
// (`parseSubcommandArgs`/`SubcommandBaseOptions`).

import { parseWindowDays } from "./advisory-common.js";
import { readPositiveInt } from "./arg-readers.js";
import type { ColdspotLens } from "./coldspots-format.js";
import { DriftAiError } from "./errors.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

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

type MutableThresholds = {
  ageThresholdDays: number | null;
  revisionFloor: number | null;
  neighborhoodChurnRatio: number | null;
  birthBurstFiles: number | null;
  birthBurstLines: number | null;
  goneSilentDays: number | null;
  largeFileChurnLines: number | null;
  markerAgeThresholdDays: number | null;
};

export function parseColdspotsArgs(argv: readonly string[]): ParsedColdspotsArgs {
  let lens: ColdspotLens = "coldspot";
  let windowDays = DEFAULT_COLDSPOT_WINDOW_DAYS;
  let top = DEFAULT_TOP_N;
  let baselinePath: string | null = null;
  const thresholds: MutableThresholds = {
    ageThresholdDays: null,
    revisionFloor: null,
    neighborhoodChurnRatio: null,
    birthBurstFiles: null,
    birthBurstLines: null,
    goneSilentDays: null,
    largeFileChurnLines: null,
    markerAgeThresholdDays: null,
  };
  const base = parseSubcommandArgs(argv, {
    usage: COLDSPOTS_USAGE,
    acceptsConfig: true,
    valueOptions: {
      "--lens": (value) => {
        lens = parseLens(value);
      },
      "--window": (value) => {
        windowDays = parseWindowDays(value, DEFAULT_COLDSPOT_WINDOW_DAYS);
      },
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--baseline": (value) => {
        if (!value) throw new DriftAiError("--baseline requires a path.");
        baselinePath = value;
      },
      "--age-threshold": (value) => {
        thresholds.ageThresholdDays = readPositiveInt(value, "--age-threshold");
      },
      "--revision-floor": (value) => {
        thresholds.revisionFloor = readPositiveInt(value, "--revision-floor");
      },
      "--neighborhood-ratio": (value) => {
        thresholds.neighborhoodChurnRatio = readPositiveInt(value, "--neighborhood-ratio");
      },
      "--birth-burst-files": (value) => {
        thresholds.birthBurstFiles = readPositiveInt(value, "--birth-burst-files");
      },
      "--birth-burst-lines": (value) => {
        thresholds.birthBurstLines = readPositiveInt(value, "--birth-burst-lines");
      },
      "--gone-silent-days": (value) => {
        thresholds.goneSilentDays = readPositiveInt(value, "--gone-silent-days");
      },
      "--large-file-lines": (value) => {
        thresholds.largeFileChurnLines = readPositiveInt(value, "--large-file-lines");
      },
      "--marker-age-threshold": (value) => {
        thresholds.markerAgeThresholdDays = readPositiveInt(value, "--marker-age-threshold");
      },
    },
  });
  return { base, lens, windowDays, top, baselinePath, ...thresholds };
}

function parseLens(value: string): ColdspotLens {
  const lens = COLDSPOT_LENS_VALUES.get(value);
  if (lens !== undefined) return lens;
  throw new DriftAiError(`--lens requires one of coldspot|stale-markers|all (got '${value}').`);
}
