// Renders the derived copy manifest for the public harness adoption starters.
// The authored data is entrypoints and classification (porting-recipes.ts);
// every file list here is walked from the import graph so docs/ai-harness.md can
// point at a copy set instead of hand-listing one that drifts.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runDocGenerator } from "../lib/doc-generator.js";
import { GENERATED_HARNESS_PORTING_MANIFEST_PATH } from "./harness-paths.js";
import {
  derivePortingClosures,
  PORTING_CLASSIFICATION,
  PORTING_RECIPES,
  type PortingClassificationPolicy,
  type PortingClosureDerivation,
  type PortingRecipeClosure,
} from "./porting-recipes.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, GENERATED_HARNESS_PORTING_MANIFEST_PATH);

function renderPolicy(
  policy: PortingClassificationPolicy,
  derivation: PortingClosureDerivation,
): readonly string[] {
  const replacedBy = new Map<string, string[]>();
  for (const closure of derivation.closures) {
    for (const file of closure.adapterFiles) {
      const recipes = replacedBy.get(file) ?? [];
      recipes.push(closure.recipe.id);
      replacedBy.set(file, recipes);
    }
  }

  return [
    "## Classification policy",
    "",
    "Every file a recipe reaches must be portable machinery or a declared Musi",
    "adapter. A closure member matching neither fails `bun run docs:harness-porting:check`,",
    "so new imports cannot quietly widen what an adopter is told to copy.",
    "",
    "Portable roots are directory prefixes, so the check catches an import that",
    "*leaves* them — not Musi policy added *inside* one. A new policy module under a",
    "portable root is classified portable until someone lists it as an adapter below,",
    "which is why some adapter entries sit under a root the table calls portable.",
    "",
    "| Portable root | Why it is portable |",
    "|---|---|",
    ...policy.portableRoots.map((root) => `| \`${root.path}\` | ${root.reason} |`),
    "",
    "Musi adapters override those roots. Where a recipe reaches one it is walked as a",
    "terminal file: the adopter replaces the module, so its own imports are Musi",
    "policy and stay out of every copy set. An entry no recipe reaches is a",
    "pre-classification rather than a copy instruction; the per-recipe \u201cCopy and",
    "replace\u201d tables below are the instructions.",
    "",
    ...policy.adapterPaths.map((path) => {
      const recipes = replacedBy.get(path);
      return recipes === undefined
        ? `- \`${path}\` \u2014 pre-classified; no recipe below reaches it`
        : `- \`${path}\` \u2014 replaced by ${recipes.map((id) => `\`${id}\``).join(", ")}`;
    }),
    "",
  ];
}

/**
 * The Musi values hard-coded inside the copied machinery. Copying the file set
 * and making the adapter edits is not the whole adoption: these markers are the
 * rest of it, and they are scanned out of the copy set so the list cannot drift
 * the way a hand-typed one would.
 */
function renderKnobs(closure: PortingRecipeClosure): readonly string[] {
  if (closure.knobs.length === 0) {
    return [
      "No `porting-knob` marker appears in this copy set: no file above hard-codes a",
      "Musi value that an adopter has to edit in place.",
      "",
    ];
  }
  return [
    "Edit these in place — `porting-knob` markers on hard-coded Musi values inside",
    "the files above. Grep the marker id in the copied file for the exact line;",
    "`scripts/ai-hooks/README.md` (\u201cPorting This\u201d) describes what each one controls.",
    "",
    "| Knob | Files |",
    "|---|---|",
    ...closure.knobs.map(
      (knob) => `| \`${knob.id}\` | ${knob.files.map((file) => `\`${file}\``).join(", ")} |`,
    ),
    "",
  ];
}

function renderRecipe(closure: PortingRecipeClosure): readonly string[] {
  const { recipe } = closure;
  const lines: string[] = [`## ${recipe.title}`, "", recipe.summary, "", "Entrypoints:", ""];
  lines.push(...recipe.entrypoints.map((entry) => `- \`${entry}\``), "");
  if (recipe.packageCopies !== undefined) {
    lines.push(
      "Copy these directories whole:",
      "",
      "| Directory | Package | Why |",
      "|---|---|---|",
    );
    lines.push(
      ...recipe.packageCopies.map(
        (copy) => `| \`${copy.path}\` | \`${copy.specifier}\` | ${copy.reason} |`,
      ),
      "",
    );
  }
  lines.push(
    `Copy these ${String(closure.portableFiles.length)} files (derived from the import graph):`,
    "",
  );
  lines.push(...closure.portableFiles.map((file) => `- \`${file}\``), "");
  if (recipe.adapterEdits !== undefined) {
    lines.push(
      "Copy and replace — Musi adapters this recipe imports:",
      "",
      "| File | Imported by | Replacement |",
      "|---|---|---|",
    );
    lines.push(
      ...recipe.adapterEdits.map(
        (edit) => `| \`${edit.path}\` | \`${edit.importedBy}\` | ${edit.replacement} |`,
      ),
      "",
    );
  }
  lines.push(...renderKnobs(closure));
  if (recipe.boundaryNotes !== undefined) {
    lines.push("Boundary notes:", "", ...recipe.boundaryNotes.map((note) => `- ${note}`), "");
  }
  return lines;
}

/** Render the whole manifest. Exported so the freshness test can compare bytes. */
export function renderPortingManifest(
  derivation: PortingClosureDerivation,
  policy: PortingClassificationPolicy,
): string {
  const lines = [
    "# Harness Porting Copy Manifest",
    "",
    "> Generated by `scripts/harness/generate-porting-manifest.ts`. Do not edit by hand.",
    "> Refresh with `bun run docs:harness-porting`; check with `bun run docs:harness-porting:check`.",
    "",
    "Each section below is one adoption recipe from",
    "[`docs/ai-harness.md`](../ai-harness.md). Entrypoints and the portable/adapter",
    "classification are authored in `scripts/harness/porting-recipes.ts`; the file",
    "lists are walked from the source import graph by `scripts/import-closure/`, the",
    "same walker the fixture copy manifests use. A copy set here is closed over its",
    "imports by construction — value edges and type-only edges alike, because an",
    "adopter's checkout has to compile, not merely run — so following a recipe",
    "yields a checkout that compiles.",
    "",
    "## What this manifest does not cover",
    "",
    "- **Shell helpers.** The reusable `scripts/ai-hooks/*.sh` helpers named in the",
    "  guide's portable-core list are outside any TypeScript import closure. They are",
    "  sourced, not imported, so no walker derives them; the guide names them directly.",
    "- **npm dependencies.** Imports that resolve into `node_modules` leave the tree",
    "  and are recorded by the lockfile, not by this manifest. The recipes below need",
    "  `zod`, and the hook/control core additionally needs `typescript`.",
    "- **Package internals.** Directories listed as whole-package copies are copied as",
    "  units; this manifest does not enumerate their files.",
    "- **Host-repo config the copied code reads.** The hook/control core's",
    "  `generate-harness-controls.ts` unconditionally awaits `loadLintRuleDocs`, which",
    "  imports `<repo root>/eslint.config.js` and expects it to export a config array",
    "  containing a `local` plugin whose rules carry the `meta.docs` contract",
    "  (`description`, `principle`, `category`, `pairedGuide`, `repairKind`). Copying the",
    "  files below is not enough: without it the generator fails with",
    "  `eslint.config.js did not export a config array`, and with",
    "  `Could not find local plugin in eslint.config.js` until the plugin is registered.",
    "",
    ...renderPolicy(policy, derivation),
    ...derivation.closures.flatMap((closure) => renderRecipe(closure)),
  ];
  while (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function main(): void {
  runDocGenerator({
    outputPath,
    refreshCommand: "docs:harness-porting",
    render: () => {
      const derivation = derivePortingClosures(repoRoot, PORTING_RECIPES);
      if (derivation.failures.length > 0) {
        console.error(derivation.failures.join("\n"));
        process.exitCode = 1;
        return undefined;
      }
      const files = derivation.closures.reduce(
        (total, closure) => total + closure.portableFiles.length + closure.adapterFiles.length,
        0,
      );
      return {
        rendered: renderPortingManifest(derivation, PORTING_CLASSIFICATION),
        wroteSuffix: ` (${String(derivation.closures.length)} recipe(s), ${String(files)} file(s))`,
      };
    },
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
