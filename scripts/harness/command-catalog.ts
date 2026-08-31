// The command-catalog model: one row per package.json script across every
// tracked manifest, assembled from two metadata sources and rendered by
// scripts/harness/generate-command-catalog.ts into docs/generated/command-catalog.md.
//
// Two sources, never both for the same script:
//   1. CONTROL-DERIVED — the script is a harness control's `bun run <script>`
//      invocation, or the `checkScript` of a control's generatedSurface facet.
//      Purpose, owning guide and side-effect class are all projected from the
//      control record; nothing about these rows is hand-typed here.
//   2. CATALOG — a `commandCatalog` entry in harness.controls.json, for every
//      script no control SPEAKS FOR: the scriptParityExemptions utilities, the
//      root scripts outside the control-prefix convention (`dev`, `test:*`,
//      `format:*`, …), every script in the non-root manifests, and the handful
//      of aggregating commands (`lint`, `doctor`, `drift:ai`, …) that several
//      controls declare — there the controls are the RULES the command runs,
//      so none of them says what the command itself is for, and coverage
//      requires an authored entry instead.
//
// checkScript aliases count exactly ONCE (as a control-derived row), which is
// what keeps the existing "redundant alias-covered exemption fails" invariant
// in harness-gate-parity.ts holding: an alias is already accounted for, so it
// needs neither an exemption nor a catalog entry.
//
// Grouping is DERIVED from the script key's prefix rather than authored per
// entry. The repo's command surface is already organized by prefix — that is
// what CONTROL_PREFIX_PATTERN encodes — so a hand-typed group field would be
// 193 more strings that can disagree with the name they sit next to. Audience
// is carried once per group by the section blurbs in the generator, not once
// per row.

import { compareByCodepoint } from "../lib/codepoint-compare.js";
// Type-only on purpose: the effect vocabulary is manifest contract, so it is
// declared with the Zod section schema, and importing it as a type keeps that
// module (and zod) out of this model's runtime import closure.
import type { CommandEffect } from "./command-catalog-schema.js";

/** A `commandCatalog` entry: the metadata source for a script no single control speaks for. */
export interface CommandCatalogEntry {
  /** Repo-relative manifest path, e.g. `package.json` or `packages/server/package.json`. */
  readonly manifest: string;
  readonly script: string;
  readonly effect: CommandEffect;
  /** One line saying what the command is for. Not a restatement of the key. */
  readonly purpose: string;
  /** Repo-relative doc that owns this command's procedure, when one does. */
  readonly doc?: string;
}

/** One tracked package.json and the scripts it declares. */
export interface PackageManifestScripts {
  readonly path: string;
  readonly packageName: string;
  readonly scripts: ReadonlyMap<string, string>;
}

/** The projection of a control record this module consumes. */
export interface ControlCommandSource {
  readonly id: string;
  readonly kind: string;
  readonly script: string;
  readonly principle?: string;
  readonly pairedGuide?: string;
  /** Set when the row is a generatedSurface `checkScript` rather than an invocation. */
  readonly checksRefreshScript?: string;
  /**
   * Set when this script is the refresh command of some control's
   * generatedSurface — i.e. running it rewrites the committed outputs.
   */
  readonly refreshesGeneratedSurface?: boolean;
  readonly outputPaths?: readonly string[];
}

export interface CommandRow {
  readonly manifest: string;
  readonly script: string;
  readonly group: string;
  readonly invocation: string;
  readonly effect: CommandEffect;
  readonly purpose: string;
  readonly doc?: string;
  /** Control ids backing a control-derived row; empty for a catalog row. */
  readonly controlIds: readonly string[];
}

const ROOT_MANIFEST = "package.json";

/**
 * `bun run <script>` from the repo root only works for the root manifest.
 * Workspace members need `--filter <name>`; a directory that is not a
 * workspace member needs `--cwd`. Derived from the manifest path rather than
 * authored so a package that moves cannot leave a stale invocation behind.
 */
export function deriveInvocation(
  manifestPath: string,
  packageName: string,
  script: string,
  workspacePackageNames: ReadonlySet<string>,
): string {
  if (manifestPath === ROOT_MANIFEST) return `bun run ${script}`;
  if (workspacePackageNames.has(packageName)) {
    return `bun run --filter ${packageName} ${script}`;
  }
  const dir = manifestPath.slice(0, manifestPath.length - "/package.json".length);
  return `bun --cwd=${dir} run ${script}`;
}

/**
 * The group a script belongs to: its prefix when it has one, and otherwise the
 * script's own name when other scripts use it as a prefix (so `test` sits with
 * `test:changed` rather than alone). Everything else is a top-level command.
 */
export function groupKeyOf(script: string, siblingScripts: ReadonlySet<string>): string {
  const colon = script.indexOf(":");
  if (colon > 0) return script.slice(0, colon);
  for (const sibling of siblingScripts) {
    if (sibling.startsWith(`${script}:`)) return script;
  }
  return "";
}

/**
 * The first clause of a control's principle — up to the first `.` or `;`
 * followed by whitespace or end of string. Principles are written as one lead
 * claim plus qualifiers, so the lead claim is exactly the one-line purpose this
 * page wants; the full text stays authoritative in docs/generated/harness-controls.md.
 */
export function summarizeControlPrinciple(principle: string): string {
  const boundary = /[.;](?=\s|$)/u.exec(principle);
  return (boundary === null ? principle : principle.slice(0, boundary.index)).trim();
}

const CONTROL_KIND_EFFECTS: ReadonlyMap<string, CommandEffect> = new Map([
  ["doc-generator", "generator"],
  ["codemod", "repair"],
]);

/**
 * What running the command does to the tree, derived from CAPABILITY first and
 * kind second. A script that refreshes a generated surface rewrites committed
 * files no matter how its control is kinded — most of them are registered as
 * `check` controls whose gate is the `--check` twin — so the writer classification
 * comes from the generatedSurface facet the projection already carries. Kind is
 * only the fallback, for writers with no surface facet (codemods) and for the
 * plain reporters that are everything else.
 */
function controlEffect(sources: readonly ControlCommandSource[]): CommandEffect {
  for (const source of sources) {
    if (source.checksRefreshScript !== undefined) return "check";
  }
  if (sources.some((source) => source.refreshesGeneratedSurface === true)) return "generator";
  for (const source of sources) {
    const effect = CONTROL_KIND_EFFECTS.get(source.kind);
    if (effect !== undefined) return effect;
  }
  return "check";
}

/**
 * The row's effect: authored when an aggregating command carries its own entry,
 * derived otherwise — except that a derived writer classification always wins,
 * because "this script rewrites committed files" is a fact about the manifest,
 * not a claim an entry gets to contradict.
 */
function commandEffect(
  sources: readonly ControlCommandSource[],
  authored: CommandCatalogEntry | undefined,
): CommandEffect {
  const derived = controlEffect(sources);
  if (authored === undefined || derived === "generator" || derived === "repair") return derived;
  return authored.effect;
}

function controlPurpose(sources: readonly ControlCommandSource[]): string {
  const twin = sources.find((source) => source.checksRefreshScript !== undefined);
  if (twin?.checksRefreshScript !== undefined) {
    const outputs = (twin.outputPaths ?? []).map((path) => `\`${path}\``).join(", ");
    return `Fail when ${outputs} is stale — the \`--check\` twin of \`${twin.checksRefreshScript}\`.`;
  }
  const principled = sources.filter((source) => source.principle !== undefined);
  if (principled.length === 1) {
    const [only] = principled;
    return `${summarizeControlPrinciple(only?.principle ?? "")}.`;
  }
  // Unreachable while `harness:check` is green: a script several controls
  // declare must carry a commandCatalog entry, which the caller prefers over
  // this. Kept so the page still renders while the gate reports the gap.
  const kinds = [...new Set(sources.map((source) => source.kind))].sort(compareByCodepoint);
  return `Runs ${String(sources.length)} registered control(s) (${kinds.join(", ")}); see the harness controls map for each one.`;
}

function controlDoc(sources: readonly ControlCommandSource[]): string | undefined {
  for (const source of sources) {
    const guide = source.pairedGuide;
    if (guide !== undefined && guide !== "none") return guide;
  }
  return undefined;
}

/**
 * What the completeness rule reads. Deliberately NAMES AND COUNTS rather than
 * the control records themselves: coverage only asks whether a script has a
 * metadata source and whether any single control speaks for it, so the
 * registration path can answer it from the script names it already collected,
 * without re-parsing the generatedSurface facets whose own validator may be
 * mid-report on a malformed one.
 */
export interface CommandCatalogCoverageInputs {
  readonly manifests: readonly PackageManifestScripts[];
  /**
   * Root-manifest script -> how many controls declare it, counting checkScript
   * aliases. More than one means the controls are the rules the command runs,
   * not descriptions of the command.
   */
  readonly controlScripts: ReadonlyMap<string, number>;
  readonly catalog: readonly CommandCatalogEntry[];
}

export interface BuildCommandRowsInputs extends Omit<
  CommandCatalogCoverageInputs,
  "controlScripts"
> {
  readonly workspacePackageNames: ReadonlySet<string>;
  /** Root-manifest scripts reachable from a control, keyed by script name. */
  readonly controlSources: ReadonlyMap<string, readonly ControlCommandSource[]>;
}

/** Where a row sits, before its metadata source decides what it says. */
type RowPlacement = Pick<CommandRow, "manifest" | "script" | "group" | "invocation">;

/**
 * A row for a script a control reaches. Several controls on one script mean
 * none of them describes the command — they are the rules it runs — so the
 * script's own catalog entry supplies purpose and doc there.
 */
function controlProjectedRow(
  placement: RowPlacement,
  sources: readonly ControlCommandSource[],
  entry: CommandCatalogEntry | undefined,
): CommandRow {
  const authored = sources.length > 1 ? entry : undefined;
  const doc = authored?.doc ?? controlDoc(sources);
  return {
    ...placement,
    effect: commandEffect(sources, authored),
    purpose: authored?.purpose ?? controlPurpose(sources),
    ...(doc === undefined ? {} : { doc }),
    controlIds: sources.map((source) => source.id).sort(compareByCodepoint),
  };
}

/** A row for a script documented only by its `commandCatalog` entry. */
function catalogRow(placement: RowPlacement, entry: CommandCatalogEntry): CommandRow {
  return {
    ...placement,
    effect: entry.effect,
    purpose: entry.purpose,
    ...(entry.doc === undefined ? {} : { doc: entry.doc }),
    controlIds: [],
  };
}

/** One row for a script, or undefined when nothing says what it is for. */
function commandRow(
  placement: RowPlacement,
  sources: readonly ControlCommandSource[] | undefined,
  entry: CommandCatalogEntry | undefined,
): CommandRow | undefined {
  if (sources !== undefined && sources.length > 0) {
    return controlProjectedRow(placement, sources, entry);
  }
  return entry === undefined ? undefined : catalogRow(placement, entry);
}

/**
 * Every script in every tracked manifest as one row, sorted by group then
 * script then manifest. Scripts with no metadata source are omitted — the
 * coverage rule below (collectCommandCatalogCoverageFailures, wired into
 * `harness:check` by registration-manifest-checks.ts) is what reports them, so
 * a missing purpose fails the gate instead of rendering a blank row.
 */
export function buildCommandRows(inputs: BuildCommandRowsInputs): CommandRow[] {
  const catalogByKey = new Map(
    inputs.catalog.map((entry) => [`${entry.manifest}::${entry.script}`, entry]),
  );
  const rows: CommandRow[] = [];
  for (const manifest of inputs.manifests) {
    const siblings = new Set(manifest.scripts.keys());
    for (const script of manifest.scripts.keys()) {
      const row = commandRow(
        {
          manifest: manifest.path,
          script,
          group: groupKeyOf(script, siblings),
          invocation: deriveInvocation(
            manifest.path,
            manifest.packageName,
            script,
            inputs.workspacePackageNames,
          ),
        },
        manifest.path === ROOT_MANIFEST ? inputs.controlSources.get(script) : undefined,
        catalogByKey.get(`${manifest.path}::${script}`),
      );
      if (row !== undefined) rows.push(row);
    }
  }
  rows.sort(
    (a, b) =>
      compareByCodepoint(a.group, b.group) ||
      compareByCodepoint(a.script, b.script) ||
      compareByCodepoint(a.manifest, b.manifest),
  );
  return rows;
}

function catalogEntryKey(entry: CommandCatalogEntry): string {
  return `${entry.manifest}::${entry.script}`;
}

/** How many controls declare this manifest's script; 0 outside the root manifest. */
function controlCount(
  inputs: CommandCatalogCoverageInputs,
  manifestPath: string,
  script: string,
): number {
  if (manifestPath !== ROOT_MANIFEST) return 0;
  return inputs.controlScripts.get(script) ?? 0;
}

/** True when one control already says what this script is for. */
function isControlDocumented(
  inputs: CommandCatalogCoverageInputs,
  manifestPath: string,
  script: string,
): boolean {
  return controlCount(inputs, manifestPath, script) === 1;
}

/** Catalog entries that name nothing live, or name something already documented. */
function collectCatalogEntryFailures(inputs: CommandCatalogCoverageInputs): string[] {
  const failures: string[] = [];
  const manifestByPath = new Map(inputs.manifests.map((manifest) => [manifest.path, manifest]));
  const seen = new Set<string>();
  for (const entry of inputs.catalog) {
    const key = catalogEntryKey(entry);
    if (seen.has(key)) {
      failures.push(`commandCatalog declares ${entry.manifest} script "${entry.script}" twice`);
    }
    seen.add(key);
    const manifest = manifestByPath.get(entry.manifest);
    if (manifest === undefined) {
      failures.push(
        `commandCatalog names unknown manifest "${entry.manifest}" (for script "${entry.script}"); tracked manifests are ${[...manifestByPath.keys()].join(", ")}`,
      );
    } else if (!manifest.scripts.has(entry.script)) {
      failures.push(
        `commandCatalog names unknown script "${entry.script}" in ${entry.manifest}; remove the entry or restore the script`,
      );
    } else if (isControlDocumented(inputs, entry.manifest, entry.script)) {
      failures.push(
        `commandCatalog entry for "${entry.script}" duplicates its harness control metadata; a control-declared script (or a generatedSurface checkScript alias) is already documented, so remove the catalog entry`,
      );
    }
  }
  return failures;
}

/** The `commandCatalog` entry a repair menu asks the reader to add. */
function catalogEntrySpelling(manifestPath: string, script: string): string {
  return (
    `{ "manifest": "${manifestPath}", "script": "${script}", "effect": ..., "purpose": ... } ` +
    "to harness.controls.json, then run `bun run docs:command-catalog`."
  );
}

/** The repair menu for an aggregating command no single control describes. */
function aggregateScriptFailure(manifestPath: string, script: string, controls: number): string {
  return (
    `${manifestPath} script "${script}" is declared by ${String(controls)} controls, so no one of ` +
    `them says what the COMMAND is for — they are the rules it runs. Add a commandCatalog entry ` +
    catalogEntrySpelling(manifestPath, script)
  );
}

/** The repair menu for a script that no control and no catalog entry reaches. */
function undocumentedScriptFailure(manifestPath: string, script: string): string {
  return (
    `${manifestPath} script "${script}" has no purpose line. Fix one of:\n` +
    `      1. Add a control entry (with "invocation": "bun run ${script}") to harness.controls.json.\n` +
    `      2. If it is the --check twin of a generated surface, declare it as ` +
    `"generatedSurface": { "checkScript": "${script}", ... } on that control record.\n` +
    `      3. Otherwise add a commandCatalog entry ` +
    catalogEntrySpelling(manifestPath, script)
  );
}

/**
 * Completeness: every script in every tracked manifest has exactly one metadata
 * source, and no catalog entry names a script that is gone or already covered.
 * This is what makes a new script fail `bun run harness:check` until someone
 * writes down what it is for.
 */
export function collectCommandCatalogCoverageFailures(
  inputs: CommandCatalogCoverageInputs,
): string[] {
  const failures = collectCatalogEntryFailures(inputs);
  const catalogued = new Set(inputs.catalog.map(catalogEntryKey));
  for (const manifest of inputs.manifests) {
    for (const script of manifest.scripts.keys()) {
      if (isControlDocumented(inputs, manifest.path, script)) continue;
      if (catalogued.has(`${manifest.path}::${script}`)) continue;
      const controls = controlCount(inputs, manifest.path, script);
      failures.push(
        controls > 1
          ? aggregateScriptFailure(manifest.path, script, controls)
          : undocumentedScriptFailure(manifest.path, script),
      );
    }
  }
  return failures;
}
