// Declared copy recipes for the public harness adoption starters in
// docs/ai-harness.md, plus the derivation that turns each declared entrypoint
// set into a complete, closed-over copy list.
//
// The guide used to hand-list the files an adopter must copy. Hand lists are
// not closed over the import graph: they drifted with every `scripts/harness/`
// refactor and shipped starters that could not compile. Here the entrypoints
// and the portable/adapter classification are the only authored data; the file
// list itself comes from the source import-closure walker
// (scripts/import-closure/), the same machinery the fixture copy manifests use.
//
// Two authored policies carry the whole boundary, and both fail closed:
//   * PORTING_CLASSIFICATION splits the tree into portable machinery and Musi
//     adapters. A closure member matching neither is a failure, so a new import
//     into app or policy code cannot silently join a public copy recipe.
//   * A recipe's `adapterEdits` must declare every adapter its closure reaches,
//     with the importer and the replacement note an adopter needs, and may only
//     name files the classification calls adapters. Adapters are walked as
//     terminal files: the adopter replaces the module, so Musi's registry
//     internals are not part of anyone's copy set.
//
// Neither policy covers the Musi values hard-coded *inside* portable machinery.
// Those already carry `porting-knob:` markers that harness:check holds against
// the checklist in scripts/ai-hooks/README.md, so each recipe's knob list is
// scanned out of its own copy set rather than restated here by hand.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validateSeedImportClosure } from "../import-closure/closure-walk.js";
import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { collectPortingKnobMarkers } from "./porting-knob-parity.js";

/** A repo prefix (trailing slash) or exact file classified as portable machinery. */
interface PortableRoot {
  readonly path: string;
  readonly reason: string;
}

/** A Musi adapter a recipe's closure reaches, and what an adopter puts in its place. */
interface PortingAdapterEdit {
  readonly path: string;
  readonly importedBy: string;
  readonly replacement: string;
}

/**
 * A `porting-knob` marker inside a recipe's copy set: a hard-coded Musi value
 * the adopter retargets in place, in a file they otherwise keep as machinery.
 */
interface PortingKnobUse {
  readonly id: string;
  readonly files: readonly string[];
}

/** A workspace package copied as a unit rather than picked apart file by file. */
interface PortingPackageCopy {
  readonly path: string;
  readonly specifier: string;
  readonly reason: string;
}

export interface PortingRecipe {
  readonly id: string;
  readonly title: string;
  /** The docs/ai-harness.md starter this recipe backs. */
  readonly summary: string;
  readonly entrypoints: readonly string[];
  readonly packageCopies?: readonly PortingPackageCopy[];
  readonly adapterEdits?: readonly PortingAdapterEdit[];
  /**
   * Walk policy for runtime imports without a static string specifier.
   * `"throw"` is the fail-closed default; a recipe choosing `"skip"` must say
   * in `boundaryNotes` which module loads runtime-configured inputs and why the
   * closure stopping there is correct for an adopter.
   */
  readonly nonStaticSpecifiers: "throw" | "skip";
  /** Rendered under the recipe: what the derived copy set does and does not cover. */
  readonly boundaryNotes?: readonly string[];
}

export interface PortingClassificationPolicy {
  readonly portableRoots: readonly PortableRoot[];
  readonly adapterPaths: readonly string[];
}

export interface PortingRecipeClosure {
  readonly recipe: PortingRecipe;
  readonly portableFiles: readonly string[];
  readonly adapterFiles: readonly string[];
  readonly knobs: readonly PortingKnobUse[];
}

export interface RecipeClassification {
  readonly portableFiles: readonly string[];
  readonly adapterFiles: readonly string[];
  readonly failures: readonly string[];
}

export interface PortingClosureDerivation {
  readonly closures: readonly PortingRecipeClosure[];
  readonly failures: readonly string[];
}

/**
 * The portable/adapter split docs/ai-harness.md narrates, in the one form a
 * validator can enforce. Roots are deliberately coarse: an adopter copies
 * directories, and a per-file allowlist would reintroduce the hand list this
 * surface exists to delete. `adapterPaths` overrides a portable root, which is
 * how a Musi-policy module inside otherwise portable machinery stays visible.
 */
export const PORTING_CLASSIFICATION: PortingClassificationPolicy = {
  portableRoots: [
    { path: "scripts/harness/", reason: "Harness manifest, hook-wiring, and generator machinery." },
    {
      path: "scripts/import-closure/",
      reason: "Source import-closure walker used by the copy-set and fixture checks.",
    },
    {
      path: "scripts/lib/",
      reason: "Shared script helpers (CLI parsing, atomic writes, doc-generator scaffold).",
    },
    {
      path: "scripts/lint-ratchet/",
      reason: "Lint-ratchet CLI modules around the portable engine package.",
    },
    { path: "scripts/harness-audit.ts", reason: "Diagnostics fusion entrypoint." },
    {
      path: "scripts/cli-option-values.ts",
      reason: "Value reader for the spec-driven CLI substrate.",
    },
  ],
  /**
   * The guide's "Musi adapters" narrative, in enforceable form. An entry need
   * not be reachable from a recipe today: the list pre-classifies the
   * Musi-policy modules that sit under an otherwise portable root, where the
   * alternative is silently copying policy as machinery. A closure member that
   * is neither listed here nor under a portable root fails closed on its own.
   */
  adapterPaths: [
    "eslint-config/path-glob-policy.js",
    "scripts/lib/max-lines-policy.ts",
    "scripts/lint-ratchet/lint-ratchet-config.ts",
  ],
};

const LINT_RATCHET_PACKAGE_COPY: PortingPackageCopy = {
  path: "tools/lint-ratchet/",
  specifier: "@musi/lint-ratchet",
  reason:
    "This copy set's `scripts/lib/` one-file indirections re-export entries of the ratchet kernel's utility contract — atomic replacement writes, deterministic codepoint ordering — so the recipe reaches the engine package. Which of them a recipe needs is visible in its file list below. Copy the directory as a unit per docs/guides/lint-ratchet-adoption.md, or, rather than take the whole engine package for the utilities those indirections forward, reimplement them against your own helpers and drop the package.",
};

/**
 * The two public adoption starters in docs/ai-harness.md, declared as
 * entrypoint sets. The lint-ratchet engine recipe is deliberately absent: its
 * guide tells adopters to copy `tools/lint-ratchet/` whole, so it has no file
 * list to close over.
 */
export const PORTING_RECIPES: readonly PortingRecipe[] = [
  {
    id: "diagnostics-starter",
    title: "Minimal starter — diagnostics envelope and fusion",
    summary:
      "Backs the Minimal starter in docs/ai-harness.md: one validated diagnostics envelope, the emission kernel that routes it, and the audit tool that fuses envelopes.",
    entrypoints: [
      "scripts/harness/harness-diagnostics-output.ts",
      "scripts/harness-audit.ts",
      "scripts/harness/harness-audit-report.ts",
    ],
    packageCopies: [
      {
        path: "tools/harness-diagnostics/",
        specifier: "@musi/harness-diagnostics",
        reason:
          "A real workspace package with its own export map and ESLint import boundary; adopters copy the directory rather than picking a schema file out of it.",
      },
      LINT_RATCHET_PACKAGE_COPY,
    ],
    nonStaticSpecifiers: "throw",
    boundaryNotes: [
      "The closure is walked fail-closed: every import in this recipe — value and type-only alike — resolves to a static specifier, so nothing is skipped.",
    ],
  },
  {
    id: "hook-control-core",
    title: "Advanced controls starter — hook wiring and generated docs",
    summary:
      "Backs step 2 of the Advanced controls starter in docs/ai-harness.md: the manifest-driven hook wiring, control-doc, and verify-step generators.",
    entrypoints: [
      "scripts/harness/generate-hook-wiring.ts",
      "scripts/harness/hook-wiring-schema.ts",
      "scripts/harness/hook-wiring-doc.ts",
      "scripts/harness/generate-harness-controls.ts",
      "scripts/harness/generate-verify-steps.ts",
      "scripts/harness/verify-step-schema.ts",
    ],
    packageCopies: [LINT_RATCHET_PACKAGE_COPY],
    adapterEdits: [
      {
        path: "scripts/lint-ratchet/lint-ratchet-config.ts",
        importedBy: "scripts/harness/generate-harness-controls.ts",
        replacement:
          "Musi's concrete ratchet registry. Replace this import with your own registry module exporting the same `lintRatchets` shape; the generator reads ids, rule ids, and guidance from it and never mutates it.",
      },
    ],
    nonStaticSpecifiers: "skip",
    boundaryNotes: [
      "`scripts/lib/lint-rule-docs.ts` imports the host repo's `eslint.config.js` through a path composed at runtime, so the walk stops there: that config and the rule modules it registers are the adopter's own policy, not part of this copy set. See \u201cWhat this manifest does not cover\u201d for what the config has to provide. The skip is recipe-wide, not scoped to that module: a future non-static load anywhere in this closure would drop whatever it loads, so add one only alongside a note here.",
      "`scripts/harness/generated-surface-dependencies.ts` reaches the closure walker through a single-literal dynamic import, which the walk does follow — `scripts/import-closure/` is in the copy set and brings a `typescript` dependency with it.",
      "Adapters are walked as terminal files: their own imports are Musi policy and stay out of the copy set.",
    ],
  },
];

function isPortable(policy: PortingClassificationPolicy, file: string): boolean {
  return policy.portableRoots.some((root) =>
    root.path.endsWith("/") ? file.startsWith(root.path) : file === root.path,
  );
}

/** Corroborate every declared adapter edit against the closure it claims to describe. */
function checkAdapterEdits(
  recipe: PortingRecipe,
  members: ReadonlySet<string>,
  adapterPaths: ReadonlySet<string>,
): readonly string[] {
  const failures: string[] = [];
  for (const edit of recipe.adapterEdits ?? []) {
    if (!adapterPaths.has(edit.path)) {
      failures.push(
        `${recipe.id}: adapterEdits declares ${edit.path}, which PORTING_CLASSIFICATION does not list as a Musi adapter; add it to adapterPaths so the walk stops there and the copy set excludes it`,
      );
      continue;
    }
    if (!members.has(edit.path)) {
      failures.push(
        `${recipe.id}: adapterEdits declares ${edit.path}, which is not in the recipe closure; remove the stale declaration`,
      );
      continue;
    }
    if (!members.has(edit.importedBy)) {
      failures.push(
        `${recipe.id}: adapterEdits for ${edit.path} names importer ${edit.importedBy}, which is not in the recipe closure`,
      );
    }
    if (edit.replacement.trim().length === 0) {
      failures.push(
        `${recipe.id}: adapterEdits for ${edit.path} must carry a non-empty replacement note`,
      );
    }
  }
  return failures;
}

/**
 * Split one recipe's closure into the portable copy set and the adapter edits,
 * failing closed on anything the classification policy does not cover and on
 * any adapter declaration the closure does not corroborate.
 */
export function classifyRecipeClosure(
  recipe: PortingRecipe,
  files: readonly string[],
  policy: PortingClassificationPolicy = PORTING_CLASSIFICATION,
): RecipeClassification {
  const adapterPaths = new Set(policy.adapterPaths);
  const declared = new Set((recipe.adapterEdits ?? []).map((edit) => edit.path));
  const members = new Set(files);
  const portableFiles: string[] = [];
  const adapterFiles: string[] = [];
  const failures: string[] = [];

  for (const file of [...members].sort(compareByCodepoint)) {
    if (!adapterPaths.has(file)) {
      if (isPortable(policy, file)) portableFiles.push(file);
      else {
        failures.push(
          `${recipe.id}: closure member ${file} is neither under a declared portable root nor a known Musi adapter; classify it in PORTING_CLASSIFICATION before an adopter copies it`,
        );
      }
      continue;
    }
    adapterFiles.push(file);
    if (!declared.has(file)) {
      failures.push(
        `${recipe.id}: closure reaches the Musi adapter ${file}, but the recipe declares no adapterEdits entry for it; add one with a replacement note or stop importing it`,
      );
    }
  }

  failures.push(...checkAdapterEdits(recipe, members, adapterPaths));
  return { portableFiles, adapterFiles, failures };
}

interface RecipeWalk {
  readonly files: ReadonlySet<string>;
  readonly failures: readonly string[];
}

/** Walk one recipe's declared entrypoints, collecting the union they reach. */
function walkRecipe(
  repoRoot: string,
  recipe: PortingRecipe,
  policy: PortingClassificationPolicy,
): RecipeWalk {
  const files = new Set<string>();
  const failures: string[] = [];
  for (const entry of recipe.entrypoints) {
    try {
      const walked = validateSeedImportClosure({
        root: repoRoot,
        entry,
        allowedRoots: ["."],
        allowedFiles: [],
        externalPackages: (recipe.packageCopies ?? []).map((copy) => copy.specifier),
        terminalFiles: policy.adapterPaths,
        nonStaticSpecifiers: recipe.nonStaticSpecifiers,
        // A copy set has to compile, not merely run, so the walk follows the
        // type-only edges a runtime fingerprint drops.
        typeOnlyImports: "include",
      });
      for (const file of walked.files) files.add(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${recipe.id}: failed to walk the import closure of ${entry}: ${message}`);
    }
  }
  return { files, failures };
}

/**
 * Corroborate the one field of a package copy nothing else reads. The
 * specifier is checked against the copy set's imports by the recipe tests;
 * `path` is rendered straight into an adopter's instructions, so a typo there
 * points them at a directory that is not the package the specifier names.
 */
function checkPackageCopies(repoRoot: string, recipe: PortingRecipe): readonly string[] {
  const failures: string[] = [];
  for (const copy of recipe.packageCopies ?? []) {
    const manifestPath = join(repoRoot, copy.path, "package.json");
    let name: unknown;
    try {
      // type-assertion-boundary: json - package.json is untyped input; only `name` is read.
      name = (JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown }).name;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(
        `${recipe.id}: packageCopies entry ${copy.path} has no readable package.json: ${message}`,
      );
      continue;
    }
    if (name !== copy.specifier) {
      failures.push(
        `${recipe.id}: packageCopies entry ${copy.path} declares package ${copy.specifier}, but its package.json names ${String(name)}`,
      );
    }
  }
  return failures;
}

/**
 * Scan a recipe's copy set for `porting-knob` markers. Adapter files are left
 * out: an adopter replaces those outright, so a knob inside one is moot. The ids
 * are the same ones `harness:check` holds against the "Porting This" checklist
 * in scripts/ai-hooks/README.md, which is where each one is described.
 */
function collectRecipeKnobs(
  repoRoot: string,
  portableFiles: readonly string[],
): readonly PortingKnobUse[] {
  const sources = new Map(
    portableFiles.map((file) => [file, readFileSync(join(repoRoot, file), "utf8")] as const),
  );
  return [...collectPortingKnobMarkers(sources)].map(([id, files]) => ({ id, files }));
}

/** Walk every declared entrypoint and classify the union it reaches. */
export function derivePortingClosures(
  repoRoot: string,
  recipes: readonly PortingRecipe[] = PORTING_RECIPES,
  policy: PortingClassificationPolicy = PORTING_CLASSIFICATION,
): PortingClosureDerivation {
  const closures: PortingRecipeClosure[] = [];
  const failures: string[] = [];
  for (const recipe of recipes) {
    failures.push(...checkPackageCopies(repoRoot, recipe));
    const walk = walkRecipe(repoRoot, recipe, policy);
    failures.push(...walk.failures);
    const classified = classifyRecipeClosure(recipe, [...walk.files], policy);
    failures.push(...classified.failures);
    closures.push({
      recipe,
      portableFiles: classified.portableFiles,
      adapterFiles: classified.adapterFiles,
      knobs: collectRecipeKnobs(repoRoot, classified.portableFiles),
    });
  }
  return { closures, failures };
}
