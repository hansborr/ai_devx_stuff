// `drift:ai hotspots` subcommand: a bespoke, brand-firewalled advisory over a
// windowed git-history walk. NOT a CheckPlugin — it has its own time axis, makes
// no recommendation, and must never lower trust in the precise findings stream.
// There is intentionally no `hotspots` entry in DriftCheckId / ALL_CHECKS /
// CHECK_PLUGINS; it is reachable ONLY via `drift:ai hotspots`.
//
// Tasks 40-42 ship the collector and all git-only lenses: churn, coupling,
// fragmentation, suppression-churn, and thrash. churn × complexity is
// deliberately NOT a lens: complexity is covered by lint-baseline adapters
// (task 30).

import { readFileSync } from "node:fs";

import { DriftAiHelp } from "./cli-args.js";
import { loadDriftAiConfig, type LoadedDriftAiConfig } from "./config.js";
import { DriftAiError } from "./errors.js";
import { defaultGitRunner, type GitRunner, resolveRepoRoot } from "./git-changed-scope.js";
import { tagSectionsWithBaseline } from "./hotspots-actionability.js";
import {
  type ConcreteHotspotLens,
  LENS_SELECTIONS,
  type ParsedHotspotsArgs,
  parseHotspotsArgs,
} from "./hotspots-args.js";
import { reduceChurn } from "./hotspots-churn.js";
import { reduceCoupling } from "./hotspots-coupling.js";
import {
  formatHotspotsJson,
  formatHotspotsText,
  type HotspotLens,
  type HotspotsAdvisory,
  type HotspotSection,
} from "./hotspots-format.js";
import { reduceFragmentation } from "./hotspots-fragmentation.js";
import {
  type CollectedHistory,
  collectHistory,
  type CommitRecord,
  defaultHistoryGitRunner,
} from "./hotspots-history.js";
import {
  collectSuppressionChurnRecords,
  reduceSuppressionChurn,
} from "./hotspots-suppression-churn.js";
import { reduceThrash } from "./hotspots-thrash.js";
import { defaultReportWriter, type ReportWriter } from "./report-output.js";
import {
  loadBaseline,
  type SubcommandBaseOptions,
  writeSubcommandOutput,
} from "./subcommand-args.js";

const BANNER = "Areas to check, not defects. drift:ai makes no claim these are problems.";
const COMPLEXITY_NOTE =
  "not measured; complexity is covered by lint-baseline adapters, not hotspots";

export type HotspotsRunOptions = {
  readonly argv: readonly string[]; // argv sliced past the "hotspots" token
  readonly git?: GitRunner;
  readonly writer?: ReportWriter;
  readonly readBaseline?: (path: string) => string; // injected for tests; defaults to fs
};

export type HotspotsRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function runHotspots(options: HotspotsRunOptions): HotspotsRunResult {
  const parsed = parseHotspotsForRun(options.argv);
  if (!parsed.ok) return parsed.result;
  return runParsedHotspots(options, parsed.args);
}

type ParsedOrResult =
  | { readonly ok: true; readonly args: ParsedHotspotsArgs }
  | { readonly ok: false; readonly result: HotspotsRunResult };

function parseHotspotsForRun(argv: readonly string[]): ParsedOrResult {
  try {
    return { ok: true, args: parseHotspotsArgs(argv) };
  } catch (err) {
    if (err instanceof DriftAiHelp)
      return { ok: false, result: { exitCode: 0, stdout: err.message } };
    if (err instanceof DriftAiError)
      return { ok: false, result: { exitCode: 2, stdout: err.message } };
    throw err;
  }
}

function runParsedHotspots(
  options: HotspotsRunOptions,
  parsed: ParsedHotspotsArgs,
): HotspotsRunResult {
  const git = options.git ?? defaultGitRunner();
  const repoRoot = resolveRepoRoot(git);
  const prepared = prepareInputs(parsed, repoRoot, options.readBaseline ?? defaultReadBaseline);
  if (!prepared.ok) return prepared.result;
  // The collector walks numstat over the window — far larger than the small
  // rev-parse output above — so it needs the large-buffer runner. An injected
  // runner (tests) is used for everything; only the real path swaps it in.
  const historyGit = options.git ?? defaultHistoryGitRunner(repoRoot);
  const history = collectHistory({
    git: historyGit,
    windowDays: parsed.windowDays,
    ignore: prepared.config.config.ignore,
  });
  const suppressionRecords = collectSuppressionRecordsForLens(
    parsed.lens,
    historyGit,
    history,
    prepared.config.config.ignore,
  );
  const advisory = buildAdvisory(parsed, history, suppressionRecords, prepared.baseline);
  const rendered = renderAdvisory(advisory, parsed.base.format);
  const writer = options.writer ?? defaultReportWriter;
  return { exitCode: 0, stdout: writeSubcommandOutput(parsed.base, rendered, writer) };
}

function renderAdvisory(
  advisory: HotspotsAdvisory,
  format: SubcommandBaseOptions["format"],
): string {
  return format === "json" ? formatHotspotsJson(advisory) : formatHotspotsText(advisory);
}

function defaultReadBaseline(path: string): string {
  return readFileSync(path, "utf8");
}

type PreparedInputs =
  | {
      readonly ok: true;
      readonly config: LoadedDriftAiConfig;
      readonly baseline: unknown;
    }
  | { readonly ok: false; readonly result: HotspotsRunResult };

// Load the (optional) --config and --baseline up front; both map a DriftAiError to
// the standard exit-2 message like the main command, rather than escaping as a
// stack trace + exit 1.
function prepareInputs(
  parsed: ParsedHotspotsArgs,
  repoRoot: string,
  read: (path: string) => string,
): PreparedInputs {
  try {
    const config = loadDriftAiConfig({
      repoRoot,
      ...(parsed.base.configPath === null ? {} : { configPath: parsed.base.configPath }),
    });
    const baseline = parsed.baselinePath === null ? null : loadBaseline(parsed.baselinePath, read);
    return { ok: true, config, baseline };
  } catch (err) {
    if (err instanceof DriftAiError)
      return { ok: false, result: { exitCode: 2, stdout: err.message } };
    throw err;
  }
}

function buildAdvisory(
  parsed: ParsedHotspotsArgs,
  history: CollectedHistory,
  suppressionRecords: SuppressionChurnInput,
  baseline: unknown,
): HotspotsAdvisory {
  const rawSections = buildSections(parsed, history, suppressionRecords);
  // Gate on whether --baseline was PASSED (baselinePath), not on the parsed value:
  // a baseline file containing literally `null` is still a (degenerate) baseline,
  // so every row should tag NEW rather than read as "no baseline given".
  const tagged =
    parsed.baselinePath === null
      ? { sections: rawSections, note: null }
      : tagSectionsWithBaseline(rawSections, baseline);
  return {
    kind: "advisory",
    lens: parsed.lens,
    note: mergeNotes(tagged.note),
    banner: BANNER,
    window: {
      requestedDays: history.requestedWindowDays,
      effectiveDays: history.effectiveWindowDays,
      widened: history.widened,
      widenReason: history.widenReason,
    },
    commitCount: history.commitCount,
    metric: {
      name: history.metric,
      autoSwitched: history.metricAutoSwitched,
      squashReason: history.squashReason,
    },
    linesAvailable: history.linesAvailable,
    complexity: COMPLEXITY_NOTE,
    sections: tagged.sections,
  };
}

// Join the non-null disclosures (currently baseline metric-mismatch notes) into
// one header line; null when there is nothing to disclose.
function mergeNotes(...notes: readonly (string | null)[]): string | null {
  const present = notes.filter((note): note is string => note !== null);
  return present.length === 0 ? null : present.join("; ");
}

function buildSections(
  parsed: ParsedHotspotsArgs,
  history: CollectedHistory,
  suppressionRecords: SuppressionChurnInput,
): HotspotSection[] {
  return LENS_SELECTIONS[parsed.lens].map((lens) =>
    reduceSection(lens, { parsed, history, suppressionRecords }),
  );
}

type SectionContext = {
  readonly parsed: ParsedHotspotsArgs;
  readonly history: CollectedHistory;
  readonly suppressionRecords: SuppressionChurnInput;
};

function reduceSection(lens: ConcreteHotspotLens, context: SectionContext): HotspotSection {
  switch (lens) {
    case "churn":
      return reduceChurn(context.history, { top: context.parsed.top });
    case "coupling":
      return reduceCoupling(context.history, {
        top: context.parsed.top,
        ...(context.parsed.minSupport === null ? {} : { minSupport: context.parsed.minSupport }),
      });
    case "fragmentation":
      return reduceFragmentation(context.history, { top: context.parsed.top });
    case "suppression-churn":
      return reduceSuppressionChurn(context.suppressionRecords.records, {
        top: context.parsed.top,
        skipReason: context.suppressionRecords.skipReason,
      });
    case "thrash":
      return reduceThrash(context.history, { top: context.parsed.top });
  }
}

function collectSuppressionRecordsForLens(
  lens: HotspotLens,
  git: GitRunner,
  history: CollectedHistory,
  ignore: LoadedDriftAiConfig["config"]["ignore"],
): SuppressionChurnInput {
  if (!LENS_SELECTIONS[lens].includes("suppression-churn")) {
    return { records: [], skipReason: null };
  }
  if (!history.linesAvailable) {
    return {
      records: [],
      skipReason:
        "content scan unavailable on a blobless partial clone; git log -G needs blob content.",
    };
  }
  return {
    records: collectSuppressionChurnRecords({
      git,
      windowDays: history.effectiveWindowDays,
      ignore,
    }),
    skipReason: null,
  };
}

type SuppressionChurnInput = {
  readonly records: readonly CommitRecord[];
  readonly skipReason: string | null;
};
