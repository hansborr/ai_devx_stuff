// Loader and projections for the `generatedSurface` facet declared on
// harness.controls.json control records. The facet is the single-source
// registration for generated harness surfaces (freshness triggers/outputs,
// check/refresh scripts, ai-hooks bun classification, and reasoned fixture
// residue); this module is the only sanctioned read path. Walkable fixture
// dependencies are an additive projection over these declarations in
// generated-surface-dependencies.ts, never a second registration surface.

import { z } from "zod";

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { type FixtureClosureEntry } from "./generated-surface-dependencies.js";
import { extractBunRunScript } from "./harness-check-validation.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";

/**
 * How the ai-hooks bun-run-quiet classifier treats a package.json script:
 * `wrapped` scripts run through the quiet wrapper; `bypass` scripts run bare.
 * Declared per record because current behavior genuinely varies (for example
 * `harness:config-surfaces` is wrapped while most refresh commands bypass).
 */
const bunHookClassificationSchema = z.enum(["wrapped", "bypass"]);

type BunHookClassification = z.infer<typeof bunHookClassificationSchema>;

const repoPathSchema = z.string().min(1);
const fixtureExtraSchema = z.strictObject({
  path: repoPathSchema,
  reason: z.string().trim().min(1),
});

// Strict: an unknown key inside the facet is a registration typo, and the god-
// record accretion risk means new fields need a design ruling, not a hot add.
const generatedSurfaceFacetSchema = z.strictObject({
  /** Exact repo paths, or directory prefixes ending in slash, that can stale the outputs. */
  triggerPaths: z.array(repoPathSchema).min(1),
  /**
   * Exact repo paths, or directory prefixes ending in slash (e.g. the
   * generator-owned `.claude/hooks/` shim directory). Consumer semantics for
   * prefix entries: the freshness warner (`renderFreshnessShell` below) is
   * prefix-aware via `renderCasePattern`; `harness-check.ts` only joins
   * outputPaths into a failure label, so a prefix reads fine as prose; the
   * fixture derivation treats closure files under a prefix as generated with
   * the same prefix semantics (today the only prefixes hold
   * shell shims the TS/JS walker never reaches, but the matcher stays aligned
   * with triggerPaths semantics rather than silently exact-matching).
   */
  outputPaths: z.array(repoPathSchema).min(1),
  checkScript: z.string().min(1),
  warnLabel: z.string().min(1),
  bunHook: z.strictObject({
    refresh: bunHookClassificationSchema,
    check: bunHookClassificationSchema,
    /** Additional package scripts whose classification is owned by this generated facet. */
    scripts: z.record(z.string().min(1), bunHookClassificationSchema).optional(),
  }),
  /** Non-import fixture dependencies, each with the reason it must be copied. */
  fixtureExtras: z.array(fixtureExtraSchema).min(1).optional(),
});

// Loose carrier: only the fields the loader consumes are validated here; the
// full control-record contract stays owned by harness:check and the docs
// generator. The refresh script is intentionally NOT a facet field — it is
// derived from the record's existing `invocation` (`bun run <script>`).
const generatedSurfaceCarrierSchema = z.looseObject({
  id: z.string().min(1),
  source: z.string().min(1),
  invocation: z.string().min(1),
  generatedSurface: generatedSurfaceFacetSchema,
});

export interface GeneratedSurfaceRecord {
  readonly id: string;
  readonly source: string;
  readonly checkScript: string;
  readonly refreshScript: string;
  readonly triggerPaths: readonly string[];
  readonly outputPaths: readonly string[];
  readonly warnLabel: string;
  readonly bunHook: {
    readonly refresh: BunHookClassification;
    readonly check: BunHookClassification;
    readonly scripts?: Readonly<Record<string, BunHookClassification>>;
  };
  readonly fixtureExtras?: readonly FixtureExtra[];
}

export interface FixtureExtra {
  readonly path: string;
  readonly reason: string;
}

function carriesGeneratedSurface(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === "object" && entry !== null && "generatedSurface" in entry;
}

function describeCarrier(entry: Record<string, unknown>): string {
  const id = entry.id;
  return typeof id === "string" && id.length > 0 ? id : "(missing id)";
}

function compareById(a: GeneratedSurfaceRecord, b: GeneratedSurfaceRecord): number {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

/**
 * Read `harness.controls.json` under `repoRoot`, validate every control record
 * carrying a `generatedSurface` facet, and return normalized records sorted by
 * id. Throws one aggregated error listing every invalid record so registration
 * mistakes surface in a single run.
 */
export function parseGeneratedSurfaces(entries: readonly unknown[]): GeneratedSurfaceRecord[] {
  const records: GeneratedSurfaceRecord[] = [];
  const failures: string[] = [];

  for (const entry of entries) {
    if (!carriesGeneratedSurface(entry)) continue;
    const carrierId = describeCarrier(entry);
    const parsed = generatedSurfaceCarrierSchema.safeParse(entry);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        failures.push(`${carrierId}: ${issue.path.join(".")}: ${issue.message}`);
      }
      continue;
    }
    const { id, source, invocation, generatedSurface } = parsed.data;
    const refreshScript = extractBunRunScript(invocation);
    if (refreshScript === undefined) {
      failures.push(
        `${id}: invocation must be "bun run <script>" so the refresh script is derivable; got: ${invocation}`,
      );
      continue;
    }
    records.push({
      id,
      source,
      checkScript: generatedSurface.checkScript,
      refreshScript,
      triggerPaths: generatedSurface.triggerPaths,
      outputPaths: generatedSurface.outputPaths,
      warnLabel: generatedSurface.warnLabel,
      bunHook: generatedSurface.bunHook,
      ...(generatedSurface.fixtureExtras === undefined
        ? {}
        : { fixtureExtras: generatedSurface.fixtureExtras }),
    });
  }

  if (failures.length > 0) {
    throw new Error(
      [
        `${HARNESS_MANIFEST_FILENAME} has invalid generatedSurface records:`,
        ...failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
  }
  return records.sort(compareById);
}

function shellSingleQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function renderCasePattern(path: string): string {
  return path.endsWith("/") ? shellSingleQuote(path) + "*" : shellSingleQuote(path);
}

/**
 * Trigger and output paths with any exact path a declared directory prefix
 * already matches removed. A record legitimately declares an output inside one
 * of its own trigger directories (a generated note beside the notes it
 * summarizes); rendering both patterns into one `case` arm produces a dead
 * alternative that shellcheck rejects as SC2221/SC2222.
 */
function casePaths(record: GeneratedSurfaceRecord): string[] {
  const paths = [...record.triggerPaths, ...record.outputPaths];
  const prefixes = paths.filter((path) => path.endsWith("/"));
  return paths.filter(
    (path) => path.endsWith("/") || !prefixes.some((prefix) => path.startsWith(prefix)),
  );
}

/**
 * Pure projection of the facet records into the pre-commit staleness warner
 * `musi_warn_generated_surfaces_stale()`. Every record renders its own
 * while/case block over the staged paths, so a staged path shared by several
 * records (for example `harness.controls.json`) warns once per record; record
 * order only affects the order those warnings print, never whether one fires.
 */
// porting-knob: generated-surface-freshness -- retarget generated inputs, outputs, and checks
export function renderFreshnessShell(records: readonly GeneratedSurfaceRecord[]): string {
  const lines = [
    "# shellcheck shell=bash",
    "# Generated by scripts/harness/generate-verify-steps.ts. Do not edit by hand.",
    "# Freshness records live in harness.controls.json (generatedSurface facets).",
    "",
    "musi_warn_generated_surfaces_stale() {",
    "  local staged staged_path",
    '  staged="$(git diff --cached --name-only --diff-filter=ACMR)"',
    '  [ -n "$staged" ] || return 0',
  ];

  for (const record of records) {
    const patterns = casePaths(record).map(renderCasePattern).join("|");
    lines.push(
      "",
      "  while IFS= read -r staged_path; do",
      '    case "$staged_path" in',
      "      " + patterns + ")",
      "        warn_if_generated_surface_stale " +
        shellSingleQuote(record.warnLabel) +
        " " +
        shellSingleQuote(record.checkScript),
      "        break",
      "        ;;",
      "    esac",
      '  done <<< "$staged"',
    );
  }
  lines.push("}", "");
  return lines.join("\n");
}

function renderClassifierScriptList(name: string, scripts: ReadonlySet<string>): string {
  const sorted = Array.from(scripts).sort(compareByCodepoint);
  const body = sorted.length === 0 ? "" : `\n${sorted.join("\n")}\n`;
  return `${name}=${shellSingleQuote(body)}`;
}

/**
 * Pure projection of the facet records into the generator-contributed ai-hooks
 * bun classifier slices. Each record contributes its check script under
 * `bunHook.check`, its refresh script under `bunHook.refresh`, and any
 * explicitly owned extra package scripts under `bunHook.scripts`; `policy.sh`
 * appends the wrapped slice to `AI_WRAPPED_BUN_SCRIPTS` and
 * `scripts/ai-hooks/test.sh` appends the bypass slice to
 * `AI_BUN_CLASSIFIED_BYPASS_SCRIPTS`, so the hand-maintained heredocs only
 * carry non-generator scripts. Entries are deduplicated and codepoint-sorted;
 * two records classifying one script differently is a registration conflict
 * and throws instead of rendering an ambiguous list.
 */
// porting-knob: wrapped-bun-scripts -- generator-contributed classifier slices render here
export function renderClassifierFragment(records: readonly GeneratedSurfaceRecord[]): string {
  const wrapped = new Set<string>();
  const bypass = new Set<string>();
  const classify = (script: string, classification: BunHookClassification): void => {
    (classification === "wrapped" ? wrapped : bypass).add(script);
  };
  for (const record of records) {
    classify(record.checkScript, record.bunHook.check);
    classify(record.refreshScript, record.bunHook.refresh);
    for (const [script, classification] of Object.entries(record.bunHook.scripts ?? {})) {
      classify(script, classification);
    }
  }

  const conflicts = Array.from(wrapped)
    .filter((script) => bypass.has(script))
    .sort(compareByCodepoint);
  if (conflicts.length > 0) {
    throw new Error(
      `generatedSurface records classify script(s) both wrapped and bypass: ${conflicts.join(", ")}`,
    );
  }

  return [
    "# shellcheck shell=bash",
    "# shellcheck disable=SC2034",
    "# Generated by scripts/harness/generate-verify-steps.ts. Do not edit by hand.",
    "# Classifier slices live in harness.controls.json (generatedSurface bunHook",
    "# facets); regenerate with `bun run verify:steps`.",
    "",
    renderClassifierScriptList("AI_GENERATED_WRAPPED_BUN_SCRIPTS", wrapped),
    "",
    renderClassifierScriptList("AI_GENERATED_BYPASS_BUN_SCRIPTS", bypass),
    "",
  ].join("\n");
}

export interface DiffTriggerPathClosureOptions {
  readonly records: readonly GeneratedSurfaceRecord[];
  readonly entryClosures: readonly FixtureClosureEntry[];
}

/** True when any entry covers `file` exactly, or via a directory prefix ending in slash. */
export function pathListCovers(paths: readonly string[], file: string): boolean {
  return paths.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

/**
 * Compare each record's declared `triggerPaths` against the computed static
 * import closure of its generator source: a closure file no trigger covers
 * (exactly, or via a directory prefix ending in slash) means edits to that
 * file would never stale-warn the record's generated outputs — the drift class
 * a hand-maintained trigger list accumulates silently. One direction only:
 * triggers legitimately exceed the closure (runtime data like
 * harness.controls.json, scanned directories), so extra triggers never fail.
 * Closure entries with no matching record id (the validator root) are ignored,
 * and records without a walked closure (non-walkable sources) are skipped.
 */
export function diffTriggerPathClosure(options: DiffTriggerPathClosureOptions): readonly string[] {
  const closuresByOwner = new Map(
    options.entryClosures.map((entry) => [entry.ownerId, entry.files] as const),
  );
  const failures: string[] = [];
  for (const record of options.records) {
    const closure = closuresByOwner.get(record.id);
    if (closure === undefined) continue;
    const uncovered = closure
      .filter((file) => !pathListCovers(record.triggerPaths, file))
      .sort(compareByCodepoint);
    for (const file of uncovered) {
      failures.push(
        `${record.id}: generator import closure includes ${file}, but no generatedSurface.triggerPaths entry covers it; add the file (or a covering directory prefix ending in /) so edits to it stale-warn the generated outputs`,
      );
    }
  }
  return failures;
}
