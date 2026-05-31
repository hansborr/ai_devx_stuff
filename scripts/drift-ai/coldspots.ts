// `drift:ai coldspots` subcommand: a bespoke, brand-firewalled advisory over the
// SAME windowed git-history walk hotspots uses, viewed through the opposite lens —
// stillness that an amplifier suggests is concealment, not quality. NOT a
// CheckPlugin (own time axis, makes no recommendation, must never lower trust in
// the precise findings stream). There is intentionally no `coldspots` entry in
// DriftCheckId / ALL_CHECKS / CHECK_PLUGINS; it is reachable ONLY via this
// subcommand, a sibling of `hotspots` (resolved decision #1).
//
// Shared wiring is FACTORED, not copied: the subcommand arg base, the git collector
// (`collectHistory`, unchanged), and the per-row actionability context all come from
// the hotspots modules. Only the cold-specific lens + format are new.

import { readFileSync } from "node:fs";

import { DriftAiHelp } from "./cli-args.js";
import {
  COLDSPOT_LENS_SELECTIONS,
  type ConcreteColdspotLens,
  parseColdspotsArgs,
  type ParsedColdspotsArgs,
} from "./coldspots-args.js";
import { tagColdspotSectionsWithBaseline } from "./coldspots-baseline.js";
import { defaultBlameGitRunner } from "./coldspots-blame.js";
import { reduceColdspot } from "./coldspots-coldspot.js";
import {
  type ColdspotLens,
  type ColdspotsAdvisory,
  type ColdspotsSection,
  formatColdspotsJson,
  formatColdspotsText,
} from "./coldspots-format.js";
import { reduceStaleMarkers } from "./coldspots-stale-markers.js";
import { loadDriftAiConfig, type LoadedDriftAiConfig } from "./config.js";
import { DriftAiError } from "./errors.js";
import { defaultGitRunner, type GitRunner, resolveRepoRoot } from "./git-changed-scope.js";
import {
  type CollectedHistory,
  collectHistory,
  defaultHistoryGitRunner,
} from "./hotspots-history.js";
import { defaultFileReader, type RepoFileReader } from "./repo-io.js";
import { defaultReportWriter, type ReportWriter } from "./report-output.js";
import { buildSourceExtensions } from "./scope.js";
import { walkSourceFiles } from "./source-walk.js";
import { type SubcommandBaseOptions, writeSubcommandOutput } from "./subcommand-args.js";

const BANNER = "Areas to check, not defects. drift:ai makes no claim these are problems.";

export type ColdspotsRunOptions = {
  readonly argv: readonly string[]; // argv sliced past the "coldspots" token
  readonly git?: GitRunner;
  readonly writer?: ReportWriter;
  readonly readBaseline?: (path: string) => string; // injected for tests; defaults to fs
  // Injected for the stale-markers lens (testable seams). `readFile` reads source
  // contents; `listFiles` enumerates repo-relative candidate paths. Both default to
  // the real fs walk anchored at repoRoot. `now` is the wall-clock reference for
  // marker aging (defaults to Date.now()); injected so tests stay deterministic.
  readonly readFile?: RepoFileReader;
  readonly listFiles?: (repoRoot: string, config: LoadedDriftAiConfig) => readonly string[];
  readonly now?: number;
};

export type ColdspotsRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

export function runColdspots(options: ColdspotsRunOptions): ColdspotsRunResult {
  const parsed = parseColdspotsForRun(options.argv);
  if (!parsed.ok) return parsed.result;
  return runParsedColdspots(options, parsed.args);
}

type ParsedOrResult =
  | { readonly ok: true; readonly args: ParsedColdspotsArgs }
  | { readonly ok: false; readonly result: ColdspotsRunResult };

function parseColdspotsForRun(argv: readonly string[]): ParsedOrResult {
  try {
    return { ok: true, args: parseColdspotsArgs(argv) };
  } catch (err) {
    if (err instanceof DriftAiHelp) {
      return { ok: false, result: { exitCode: 0, stdout: err.message } };
    }
    if (err instanceof DriftAiError) {
      return { ok: false, result: { exitCode: 2, stdout: err.message } };
    }
    throw err;
  }
}

function runParsedColdspots(
  options: ColdspotsRunOptions,
  parsed: ParsedColdspotsArgs,
): ColdspotsRunResult {
  const git = options.git ?? defaultGitRunner();
  const repoRoot = resolveRepoRoot(git);
  const prepared = prepareInputs(parsed, repoRoot, options.readBaseline ?? defaultReadBaseline);
  if (!prepared.ok) return prepared.result;
  // The collector walks numstat over the window (far larger than rev-parse), so the
  // real path needs the large-buffer runner; an injected runner (tests) is used for
  // everything else.
  const historyGit = options.git ?? defaultHistoryGitRunner(repoRoot);
  const history = collectHistory({
    git: historyGit,
    windowDays: parsed.windowDays,
    ignore: prepared.config.config.ignore,
  });
  // The stale-markers lens needs file enumeration + a reader + blame; blame is
  // anchored at repoRoot (the injected runner is used in tests). Keep file
  // enumeration lazy so the default coldspot lens does not walk the source tree.
  const listFiles = lazyStaleMarkerFileList(
    options.listFiles ?? defaultListFiles,
    repoRoot,
    prepared.config,
  );
  const sectionContext: SectionContext = {
    parsed,
    history,
    repoRoot,
    // A stderr-quiet runner: blame is expected to fail on uncommitted/renamed paths,
    // and the parser degrades those to age-unknown without leaking git's `fatal:`.
    blameGit: options.git ?? defaultBlameGitRunner(repoRoot),
    readFile: options.readFile ?? defaultFileReader(repoRoot),
    listFiles,
    // Marker staleness is a CALENDAR question (the Morlion ~246d anchor is
    // wall-clock), so the stale-markers lens ages against real "now" — NOT the newest
    // in-window commit, which would under-count age on a repo with an old HEAD. The
    // coldspot lens computes its own repo-activity reference internally and ignores
    // this. The section discloses the resolved reference date.
    nowMs: options.now ?? Date.now(),
  };
  const advisory = buildAdvisory(sectionContext, prepared.baseline);
  const rendered = renderAdvisory(advisory, parsed.base.format);
  const writer = options.writer ?? defaultReportWriter;
  return { exitCode: 0, stdout: writeSubcommandOutput(parsed.base, rendered, writer) };
}

// Default candidate enumeration for the stale-markers lens: the same source-walk the
// checks use, honoring the config's roots / extra source extensions / ignore set.
function defaultListFiles(repoRoot: string, config: LoadedDriftAiConfig): readonly string[] {
  return walkSourceFiles({
    repoRoot,
    roots: config.config.roots,
    sourceExtensions: buildSourceExtensions(config.config.additionalSourceExtensions),
    ignore: config.config.ignore,
  });
}

function lazyStaleMarkerFileList(
  listFiles: (repoRoot: string, config: LoadedDriftAiConfig) => readonly string[],
  repoRoot: string,
  config: LoadedDriftAiConfig,
): () => readonly string[] {
  let cached: readonly string[] | undefined;
  return () => {
    cached ??= listFiles(repoRoot, config);
    return cached;
  };
}

function renderAdvisory(
  advisory: ColdspotsAdvisory,
  format: SubcommandBaseOptions["format"],
): string {
  return format === "json" ? formatColdspotsJson(advisory) : formatColdspotsText(advisory);
}

function defaultReadBaseline(path: string): string {
  return readFileSync(path, "utf8");
}

type PreparedInputs =
  | { readonly ok: true; readonly config: LoadedDriftAiConfig; readonly baseline: unknown }
  | { readonly ok: false; readonly result: ColdspotsRunResult };

// Load the (optional) --config and --baseline up front; both map a DriftAiError to
// the standard exit-2 message rather than escaping as a stack trace + exit 1.
function prepareInputs(
  parsed: ParsedColdspotsArgs,
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
    if (err instanceof DriftAiError) {
      return { ok: false, result: { exitCode: 2, stdout: err.message } };
    }
    throw err;
  }
}

function loadBaseline(path: string, read: (path: string) => string): unknown {
  let raw: string;
  try {
    raw = read(path);
  } catch {
    throw new DriftAiError(`--baseline file does not exist or is unreadable: ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new DriftAiError(`--baseline file is not valid JSON: ${path}`);
  }
}

// Everything a lens reducer might need. The coldspot lens uses only `history`; the
// stale-markers lens also needs the lazy file walk + reader + blame runner +
// reference time. Threading one context keeps the dispatch map uniform.
type SectionContext = {
  readonly parsed: ParsedColdspotsArgs;
  readonly history: CollectedHistory;
  readonly repoRoot: string;
  readonly blameGit: GitRunner;
  readonly readFile: RepoFileReader;
  readonly listFiles: () => readonly string[];
  readonly nowMs: number;
};

function buildAdvisory(context: SectionContext, baseline: unknown): ColdspotsAdvisory {
  const { parsed, history } = context;
  const rawSections = buildSections(context);
  // Gate on whether --baseline was PASSED (baselinePath), not on the parsed value:
  // a baseline file containing literally `null` is still a (degenerate) baseline.
  const sections =
    parsed.baselinePath === null
      ? rawSections
      : tagColdspotSectionsWithBaseline(rawSections, baseline);
  return {
    kind: "advisory",
    lens: parsed.lens,
    note: null,
    banner: BANNER,
    window: {
      requestedDays: history.requestedWindowDays,
      effectiveDays: history.effectiveWindowDays,
      widened: history.widened,
      widenReason: history.widenReason,
    },
    commitCount: history.commitCount,
    linesAvailable: history.linesAvailable,
    squashReason: history.squashReason,
    sections,
  };
}

function buildSections(context: SectionContext): ColdspotsSection[] {
  return COLDSPOT_LENS_SELECTIONS[context.parsed.lens].map((lens) => LENS_REDUCERS[lens](context));
}

// One reducer per concrete lens, keyed so adding a lens is a new map entry (mirroring
// how hotspots dispatches its lenses) — not a rewritten switch.
type LensReducer = (context: SectionContext) => ColdspotsSection;

const LENS_REDUCERS: Record<ConcreteColdspotLens, LensReducer> = {
  coldspot: ({ parsed, history }) =>
    reduceColdspot(history, {
      top: parsed.top,
      ...(parsed.ageThresholdDays === null ? {} : { ageThresholdDays: parsed.ageThresholdDays }),
      ...(parsed.revisionFloor === null ? {} : { revisionFloor: parsed.revisionFloor }),
      ...(parsed.neighborhoodChurnRatio === null
        ? {}
        : { neighborhoodChurnRatio: parsed.neighborhoodChurnRatio }),
      ...(parsed.birthBurstFiles === null ? {} : { birthBurstFiles: parsed.birthBurstFiles }),
      ...(parsed.birthBurstLines === null ? {} : { birthBurstLines: parsed.birthBurstLines }),
      ...(parsed.goneSilentDays === null ? {} : { goneSilentDays: parsed.goneSilentDays }),
      ...(parsed.largeFileChurnLines === null
        ? {}
        : { largeFileChurnLines: parsed.largeFileChurnLines }),
    }),
  "stale-markers": (context) =>
    reduceStaleMarkers({
      files: context.listFiles(),
      readFile: context.readFile,
      git: context.blameGit,
      repoRoot: context.repoRoot,
      // Blame is meaningless on a blobless clone (it would lazily fetch blobs); the
      // collector already detected that via linesAvailable, so reuse it as the gate.
      agesAvailable: context.history.linesAvailable,
      nowMs: context.nowMs,
      top: context.parsed.top,
      ...(context.parsed.markerAgeThresholdDays === null
        ? {}
        : { ageThresholdDays: context.parsed.markerAgeThresholdDays }),
    }),
};

export type { ColdspotLens };
