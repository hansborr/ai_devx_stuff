// Loader and projections for the `generatedSurface` facet declared on
// harness.controls.json control records. The facet is the single-source
// registration for generated harness surfaces (freshness triggers/outputs,
// check/refresh scripts, ai-hooks bun classification, and — from slice S4 —
// fixture copy paths); this module is the only sanctioned read path. The
// freshness pre-commit shell renders here via `renderFreshnessShell` and the
// ai-hooks classifier slices via `renderClassifierFragment`; the remaining
// projection (fixture manifest) lands in slice S4 and must build on
// `loadGeneratedSurfaces` rather than re-reading the manifest.

import { compareByCodepoint } from "@musi/lint-ratchet/kernel/codepoint-compare.js";
import { z } from "zod";

import { extractBunRunScript } from "./harness-check-validation.js";
import { HARNESS_MANIFEST_FILENAME, loadHarnessManifest } from "./harness-manifest.js";

/**
 * How the ai-hooks bun-run-quiet classifier treats a package.json script:
 * `wrapped` scripts run through the quiet wrapper; `bypass` scripts run bare.
 * Declared per record because current behavior genuinely varies (for example
 * `harness:config-surfaces` is wrapped while most refresh commands bypass).
 */
const bunHookClassificationSchema = z.enum(["wrapped", "bypass"]);

type BunHookClassification = z.infer<typeof bunHookClassificationSchema>;

const repoPathSchema = z.string().min(1);

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
   * fixture-closure check (`diffFixtureClosure`) exact-matches against
   * closure files, which are statically walkable TS/JS — shell outputs under
   * a prefix can never appear there, so prefix entries are deliberately
   * inert for it.
   */
  outputPaths: z.array(repoPathSchema).min(1),
  checkScript: z.string().min(1),
  warnLabel: z.string().min(1),
  bunHook: z.strictObject({
    refresh: bunHookClassificationSchema,
    check: bunHookClassificationSchema,
  }),
  /** Fixture copy closure for test-harness-check.sh; populated in slice S4. */
  fixturePaths: z.array(repoPathSchema).min(1).optional(),
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
  };
  readonly fixturePaths?: readonly string[];
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
export function loadGeneratedSurfaces(repoRoot: string): GeneratedSurfaceRecord[] {
  const records: GeneratedSurfaceRecord[] = [];
  const failures: string[] = [];

  for (const entry of loadHarnessManifest(repoRoot)) {
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
      ...(generatedSurface.fixturePaths === undefined
        ? {}
        : { fixturePaths: generatedSurface.fixturePaths }),
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
    const patterns = [...record.triggerPaths, ...record.outputPaths]
      .map(renderCasePattern)
      .join("|");
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
 * `bunHook.check` and its refresh script under `bunHook.refresh`; `policy.sh`
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

/**
 * Convention home for fixture files that several records (or harness-check
 * itself) need: they are attributed to the record that owns this module,
 * `scripts/harness/generated-surfaces.ts`, instead of being duplicated across
 * every record's fixturePaths. The closure validator suggests this record when
 * a missing file is not reachable from exactly one record's generator source.
 */
export const SHARED_FIXTURE_INFRA_RECORD_ID = "check/verify-steps-generator";

/**
 * Repo paths in the harness-check import closure that the smoke fixture
 * synthesizes in place (heredoc stubs) instead of copying, so they must stay
 * out of the copy manifest; the closure validator treats them as satisfied.
 */
export const FIXTURE_SYNTHESIZED_PATHS = ["scripts/lint-agent-guidance.ts"] as const;

/**
 * Pure projection of the facet records into the smoke-fixture copy manifest
 * consumed by scripts/tests/test-harness-check.sh: the deduplicated,
 * codepoint-sorted union of every record's fixturePaths, one repo-relative
 * file per line, copied verbatim into the fixture at the same path. Directory
 * entries are rejected — the manifest carries plain file copies only; the
 * fixture-synthesized files, node_modules resolution symlinks, and stubs stay
 * hand-written in the smoke test.
 */
// porting-knob: fixture-copy-manifest -- smoke-fixture copy closure renders here
export function renderFixtureManifest(records: readonly GeneratedSurfaceRecord[]): string {
  const paths = new Set<string>();
  for (const record of records) {
    for (const path of record.fixturePaths ?? []) {
      if (path.endsWith("/")) {
        throw new Error(
          `${record.id}: fixturePaths entries must be plain files, not directories: ${path}`,
        );
      }
      paths.add(path);
    }
  }
  return [
    "# Generated by scripts/harness/generate-verify-steps.ts. Do not edit by hand.",
    "# Copy manifest for the scripts/tests/test-harness-check.sh fixture: each",
    "# line is a repo-relative file copied verbatim to the same path inside the",
    "# fixture. Entries live in harness.controls.json (generatedSurface",
    "# fixturePaths facets); regenerate with `bun run verify:steps`.",
    "",
    ...Array.from(paths).sort(compareByCodepoint),
    "",
  ].join("\n");
}

/** One walked entry point: a diagnostic owner id and its repo-relative closure files. */
export interface FixtureClosureEntry {
  /** A generatedSurface record id, or the validator root ("scripts/harness-check.ts"). */
  readonly ownerId: string;
  readonly files: readonly string[];
}

export interface DiffFixtureClosureOptions {
  readonly records: readonly GeneratedSurfaceRecord[];
  readonly entryClosures: readonly FixtureClosureEntry[];
  /** Closure files satisfied by fixture synthesis instead of copying. */
  readonly synthesizedPaths?: readonly string[];
}

/**
 * Extensions the static import walker can both enter (entry points) and reach
 * (closure members). Shared by the closure walk and the stale-declaration
 * check so a declaration the walker could see never escapes stale detection.
 */
export const WALKABLE_SOURCE_PATTERN = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/u;

function collectPathOwners(
  entries: readonly (readonly [string, readonly string[]])[],
): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const [ownerId, files] of entries) {
    for (const file of files) {
      const existing = owners.get(file);
      if (existing === undefined) {
        owners.set(file, [ownerId]);
      } else if (!existing.includes(ownerId)) {
        existing.push(ownerId);
      }
    }
  }
  return new Map(Array.from(owners).sort(([left], [right]) => compareByCodepoint(left, right)));
}

/**
 * Compare the declared fixturePaths union against the computed static import
 * closure of harness-check and every record's generator source. Two failure
 * modes, both returned as actionable messages: a closure file that no record
 * declares (and no outputPaths entry regenerates, and no synthesized stub
 * satisfies) is a missing copy; a declared statically walkable file (TS or JS
 * family) outside the closure is a stale declaration. Non-walkable
 * declarations (shell, markdown, JSON runtime inputs) are exempt from the
 * stale check — a static import walk cannot see how they are consumed.
 */
export function diffFixtureClosure(options: DiffFixtureClosureOptions): readonly string[] {
  const declaredOwners = collectPathOwners(
    options.records.map((record) => [record.id, record.fixturePaths ?? []] as const),
  );
  const closureOwners = collectPathOwners(
    options.entryClosures.map((entry) => [entry.ownerId, entry.files] as const),
  );
  return [
    ...missingCopyFailures(options, declaredOwners, closureOwners),
    ...staleDeclarationFailures(declaredOwners, closureOwners),
  ];
}

function missingCopyFailures(
  options: DiffFixtureClosureOptions,
  declaredOwners: ReadonlyMap<string, readonly string[]>,
  closureOwners: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const recordIds = new Set(options.records.map((record) => record.id));
  const generated = new Set(options.records.flatMap((record) => record.outputPaths));
  const synthesized = new Set(options.synthesizedPaths ?? []);
  const failures: string[] = [];
  for (const [file, owners] of closureOwners) {
    if (declaredOwners.has(file) || generated.has(file) || synthesized.has(file)) continue;
    const soleOwner = owners.length === 1 ? owners[0] : undefined;
    const suggestion =
      soleOwner !== undefined && recordIds.has(soleOwner)
        ? soleOwner
        : SHARED_FIXTURE_INFRA_RECORD_ID;
    failures.push(
      `fixture import closure includes ${file} (reached from ${owners.join(", ")}), but no generatedSurface.fixturePaths declares it; add it to fixturePaths of ${suggestion}`,
    );
  }
  return failures;
}

function staleDeclarationFailures(
  declaredOwners: ReadonlyMap<string, readonly string[]>,
  closureOwners: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const failures: string[] = [];
  for (const [file, owners] of declaredOwners) {
    if (!WALKABLE_SOURCE_PATTERN.test(file) || closureOwners.has(file)) continue;
    failures.push(
      `generatedSurface.fixturePaths of ${owners.join(", ")} declares ${file}, which is not in the computed fixture import closure; remove the stale entry`,
    );
  }
  return failures;
}
