// Shared static-import derivation for generated harness surfaces. Real-tree
// projection generation and harness:check both call this module, so the copy
// closure is walked once per consumer and never hand-reimplemented. Reduced
// fixture trees explicitly consume the checked-in projection without walking.

import type { ClosureOptions, ClosureValidation } from "../import-closure/closure-walk.js";
import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { type GeneratedSurfaceRecord, pathListCovers } from "./generated-surfaces.js";

const FIXTURE_CLOSURE_EXTERNAL_PACKAGES = ["@musi/lint-ratchet", "zod"] as const;
const FIXTURE_CLOSURE_REPOSITORY_PACKAGE_IMPORTS = {
  "@musi/lint-ratchet/git-rail/conflict-recovery.js":
    "tools/lint-ratchet/src/git-rail/conflict-recovery.ts",
} as const;
/**
 * Fixture closure roots: the validator the smoke runs against the reduced
 * fixture tree, plus the registration entrypoint whose read-only --explain
 * mode the same smoke proves non-vacuous inside that fixture.
 */
const FIXTURE_CLOSURE_ROOT_ENTRIES = [
  "scripts/harness-check.ts",
  "scripts/harness-registration-check.ts",
] as const;

/** Manifest record that owns validator-root dependencies shared by many generators. */
export const SHARED_FIXTURE_INFRA_RECORD_ID = "check/verify-steps-generator";
export const FIXTURE_SYNTHESIZED_PATHS = ["scripts/lint-agent-guidance.ts"] as const;
export const WALKABLE_SOURCE_PATTERN = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/u;
export const FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV =
  "MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS";

/** One walked entry point: a diagnostic owner id and its repo-relative closure files. */
export interface FixtureClosureEntry {
  readonly ownerId: string;
  readonly files: readonly string[];
}

interface ClosureWalkEntry {
  readonly ownerId: string;
  readonly entry: string;
}

export interface GeneratedSurfaceDependencyDerivation {
  readonly entryClosures: readonly FixtureClosureEntry[];
  readonly fixturePaths: readonly string[];
  readonly failures: readonly string[];
}

type ValidateSeedImportClosure = (options: ClosureOptions) => ClosureValidation;

interface ClosureWalkerModule {
  readonly validateSeedImportClosure: ValidateSeedImportClosure;
}

type ClosureWalkerLoadResult =
  | { readonly ok: true; readonly module: ClosureWalkerModule }
  | { readonly ok: false; readonly message: string };

export interface GeneratedSurfaceDependencyDerivationOptions {
  /**
   * When the walker module cannot load, use authored fixtureExtras as the
   * entire effective list. Walker failures after a successful load still fail.
   */
  readonly allowDeclaredFallback?: boolean;
  /** Test seam for proving the unavailable-walker boundary. */
  readonly loadClosureWalker?: () => Promise<ClosureWalkerModule>;
}

interface FixtureDependencyOptions {
  readonly records: readonly GeneratedSurfaceRecord[];
  readonly entryClosures: readonly FixtureClosureEntry[];
  readonly synthesizedPaths?: readonly string[];
}

interface FixturePathDerivationResult {
  readonly fixturePaths: readonly string[];
  readonly failure?: string;
}

/** The fixture closure roots plus each statically walkable generator source. */
function closureWalkEntries(
  records: readonly GeneratedSurfaceRecord[],
): readonly ClosureWalkEntry[] {
  return [
    ...FIXTURE_CLOSURE_ROOT_ENTRIES.map((entry) => ({ ownerId: entry, entry })),
    ...records.map((record) => ({ ownerId: record.id, entry: record.source })),
  ].filter(({ entry }) => WALKABLE_SOURCE_PATTERN.test(entry));
}

/**
 * Add authored residue to the copyable portion of the static import closure.
 * Generated outputs and fixture-synthesized files satisfy closure edges without
 * being copied, unless an explicit residue entry says the fixture consumes an
 * output as runtime data.
 */
export function deriveFixturePaths(options: FixtureDependencyOptions): readonly string[] {
  const generated = options.records.flatMap((record) => record.outputPaths);
  const synthesized = new Set(options.synthesizedPaths ?? []);
  const paths = new Set(
    options.entryClosures
      .flatMap((entry) => entry.files)
      .filter((file) => !pathListCovers(generated, file) && !synthesized.has(file)),
  );
  for (const record of options.records) {
    for (const extra of record.fixtureExtras ?? []) {
      if (extra.path.endsWith("/")) {
        throw new Error(
          `${record.id}: generatedSurface.fixtureExtras entries must be plain files, not directories: ${extra.path}`,
        );
      }
      paths.add(extra.path);
    }
  }
  return Array.from(paths).sort(compareByCodepoint);
}

function tryDeriveFixturePaths(options: FixtureDependencyOptions): FixturePathDerivationResult {
  try {
    return { fixturePaths: deriveFixturePaths(options) };
  } catch (error) {
    return {
      fixturePaths: [],
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

function collectClosureOwners(
  entryClosures: readonly FixtureClosureEntry[],
): ReadonlyMap<string, readonly string[]> {
  const closureOwners = new Map<string, string[]>();
  for (const entry of entryClosures) {
    for (const file of entry.files) {
      const owners = closureOwners.get(file) ?? [];
      if (!owners.includes(entry.ownerId)) owners.push(entry.ownerId);
      closureOwners.set(file, owners);
    }
  }
  return closureOwners;
}

const fixtureClosureRootSet: ReadonlySet<string> = new Set(FIXTURE_CLOSURE_ROOT_ENTRIES);

function sharedOwnerSuffix(owners: readonly string[] | undefined): string {
  return owners?.some((owner) => fixtureClosureRootSet.has(owner)) === true
    ? `; validator-root infrastructure belongs to ${SHARED_FIXTURE_INFRA_RECORD_ID}`
    : "";
}

/** Reject residue entries that merely restate an import edge or synthesized file. */
export function diffFixtureExtraResidue(options: FixtureDependencyOptions): readonly string[] {
  const closureOwners = collectClosureOwners(options.entryClosures);
  const generated = options.records.flatMap((record) => record.outputPaths);
  const synthesized = new Set(options.synthesizedPaths ?? []);
  const failures: string[] = [];
  for (const record of options.records) {
    for (const extra of record.fixtureExtras ?? []) {
      const owners = closureOwners.get(extra.path);
      if (pathListCovers(generated, extra.path)) continue;
      if (owners === undefined && !synthesized.has(extra.path)) continue;
      failures.push(
        `${record.id}: generatedSurface.fixtureExtras declares ${extra.path}, but fixture derivation already supplies it${sharedOwnerSuffix(owners)}; remove the derivable residue`,
      );
    }
  }
  return failures;
}

/** Render the effective fixture paths as the smoke fixture's checked-in copy manifest. */
// porting-knob: fixture-copy-manifest -- smoke-fixture copy closure renders here
export function renderFixtureManifest(fixturePaths: readonly string[]): string {
  return [
    "# Generated by scripts/harness/generate-verify-steps.ts. Do not edit by hand.",
    "# Copy manifest for the scripts/tests/test-harness-check.sh fixture: each",
    "# line is a repo-relative file copied verbatim to the same path inside the",
    "# fixture. Walkable entries are derived from generatedSurface sources;",
    "# fixtureExtras declare reasoned residue. Regenerate with `bun run verify:steps`.",
    "",
    ...Array.from(new Set(fixturePaths)).sort(compareByCodepoint),
    "",
  ].join("\n");
}

async function loadFixtureClosureWalker(
  options: GeneratedSurfaceDependencyDerivationOptions,
): Promise<ClosureWalkerLoadResult> {
  const loadClosureWalker =
    options.loadClosureWalker ?? (async () => import("../import-closure/closure-walk.js"));
  try {
    return { ok: true, module: await loadClosureWalker() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function unavailableWalkerResult(
  records: readonly GeneratedSurfaceRecord[],
  options: GeneratedSurfaceDependencyDerivationOptions,
  message: string,
): GeneratedSurfaceDependencyDerivation {
  if (
    options.allowDeclaredFallback === true &&
    records.some((record) => record.fixtureExtras !== undefined)
  ) {
    const derived = tryDeriveFixturePaths({ records, entryClosures: [] });
    return {
      entryClosures: [],
      fixturePaths: derived.fixturePaths,
      failures: derived.failure === undefined ? [] : [derived.failure],
    };
  }
  return {
    entryClosures: [],
    fixturePaths: [],
    failures: [`failed to load the fixture import-closure walker: ${message}`],
  };
}

/** Walk and derive the effective fixture copy paths for all generated surfaces. */
export async function deriveGeneratedSurfaceDependencies(
  repoRoot: string,
  records: readonly GeneratedSurfaceRecord[],
  options: GeneratedSurfaceDependencyDerivationOptions = {},
): Promise<GeneratedSurfaceDependencyDerivation> {
  const loadedWalker = await loadFixtureClosureWalker(options);
  if (!loadedWalker.ok) return unavailableWalkerResult(records, options, loadedWalker.message);
  const { validateSeedImportClosure } = loadedWalker.module;
  const entryClosures: FixtureClosureEntry[] = [];
  const failures: string[] = [];
  for (const { ownerId, entry } of closureWalkEntries(records)) {
    try {
      const { files } = validateSeedImportClosure({
        root: repoRoot,
        entry,
        allowedRoots: ["."],
        allowedFiles: [],
        externalPackages: FIXTURE_CLOSURE_EXTERNAL_PACKAGES,
        repositoryPackageImports: FIXTURE_CLOSURE_REPOSITORY_PACKAGE_IMPORTS,
        terminalFiles: Object.values(FIXTURE_CLOSURE_REPOSITORY_PACKAGE_IMPORTS),
        nonStaticSpecifiers: "skip",
      });
      entryClosures.push({ ownerId, files });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`failed to walk the import closure of ${entry} (${ownerId}): ${message}`);
    }
  }
  const derived = tryDeriveFixturePaths({
    records,
    entryClosures,
    synthesizedPaths: FIXTURE_SYNTHESIZED_PATHS,
  });
  if (derived.failure !== undefined) failures.push(derived.failure);
  return { entryClosures, fixturePaths: derived.fixturePaths, failures };
}
