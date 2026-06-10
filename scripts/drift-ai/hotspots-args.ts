import { readPositiveInt } from "./arg-readers.js";
import { DriftAiError } from "./errors.js";
import type { HotspotLens } from "./hotspots-format.js";
import { DEFAULT_WINDOW_DAYS } from "./hotspots-history.js";
import { parseSubcommandArgs, type SubcommandBaseOptions } from "./subcommand-args.js";

const DEFAULT_TOP_N = 20;

export type ConcreteHotspotLens = Exclude<HotspotLens, "all">;

export const CONCRETE_LENSES: readonly ConcreteHotspotLens[] = [
  "churn",
  "coupling",
  "fragmentation",
  "suppression-churn",
  "thrash",
];

export const LENS_SELECTIONS: Record<HotspotLens, readonly ConcreteHotspotLens[]> = {
  churn: ["churn"],
  coupling: ["coupling"],
  fragmentation: ["fragmentation"],
  "suppression-churn": ["suppression-churn"],
  thrash: ["thrash"],
  all: CONCRETE_LENSES,
};

const HOTSPOT_LENS_VALUES: ReadonlyMap<string, HotspotLens> = new Map<string, HotspotLens>([
  ...CONCRETE_LENSES.map((lens): [string, HotspotLens] => [lens, lens]),
  ["all", "all"],
]);

const HOTSPOTS_USAGE = [
  "Usage:",
  "  bun run drift:ai hotspots",
  "  bun run drift:ai hotspots --lens <churn|coupling|fragmentation|suppression-churn|thrash|all>",
  "  bun run drift:ai hotspots --window <days> --top <N>",
  "  bun run drift:ai hotspots --lens coupling --min-support <N>",
  "  bun run drift:ai hotspots --baseline <prev.json>",
  "  bun run drift:ai hotspots --format <text|json> [--output <path>]",
  "  bun run drift:ai hotspots --config <path>",
  "",
  "Report-only advisory (exit 0). Areas to check, not defects. Whole-repo (no",
  "--scope). Git-only lenses: churn, coupling, fragmentation, suppression-churn, thrash.",
].join("\n");

export type ParsedHotspotsArgs = {
  readonly base: SubcommandBaseOptions;
  readonly lens: HotspotLens;
  readonly windowDays: number;
  readonly top: number;
  readonly minSupport: number | null;
  readonly baselinePath: string | null;
};

export function parseHotspotsArgs(argv: readonly string[]): ParsedHotspotsArgs {
  let lens: HotspotLens = "churn";
  let windowDays = DEFAULT_WINDOW_DAYS;
  let top = DEFAULT_TOP_N;
  let minSupport: number | null = null;
  let baselinePath: string | null = null;
  const base = parseSubcommandArgs(argv, {
    usage: HOTSPOTS_USAGE,
    acceptsConfig: true,
    valueOptions: {
      "--lens": (value) => {
        lens = parseLens(value);
      },
      "--window": (value) => {
        windowDays = parseWindowDays(value);
      },
      "--top": (value) => {
        top = readPositiveInt(value, "--top");
      },
      "--min-support": (value) => {
        minSupport = readPositiveInt(value, "--min-support");
      },
      "--baseline": (value) => {
        if (!value) throw new DriftAiError("--baseline requires a path.");
        baselinePath = value;
      },
    },
  });
  return { base, lens, windowDays, top, minSupport, baselinePath };
}

function parseLens(value: string): HotspotLens {
  const lens = HOTSPOT_LENS_VALUES.get(value);
  if (lens !== undefined) return lens;
  throw new DriftAiError(
    `--lens requires one of churn|coupling|fragmentation|suppression-churn|thrash|all (got '${value}').`,
  );
}

function parseWindowDays(value: string): number {
  const match = /^(\d+)d?$/u.exec(value.trim());
  const days = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isInteger(days) || days <= 0) {
    throw new DriftAiError("--window requires a positive number of days, e.g. 14 or 14d.");
  }
  return days;
}
