import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { renderPortingManifest } from "./generate-porting-manifest.js";
import { GENERATED_HARNESS_PORTING_MANIFEST_PATH } from "./harness-paths.js";
import {
  classifyRecipeClosure,
  derivePortingClosures,
  PORTING_CLASSIFICATION,
  PORTING_RECIPES,
  type PortingClassificationPolicy,
  type PortingClosureDerivation,
  type PortingRecipe,
} from "./porting-recipes.js";

const tmpRepo = registerTempRootCleanup();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The host-repo input `scripts/lib/lint-rule-docs.ts` loads at the recipe's one skipped edge. */
const HOST_LINT_CONFIG_FILE = "eslint.config.js";

const testPolicy: PortingClassificationPolicy = {
  portableRoots: [
    { path: "engine/", reason: "Portable engine modules." },
    { path: "entry.ts", reason: "The portable entrypoint." },
  ],
  adapterPaths: ["policy/registry.ts"],
};

/** Each recipe's starter in docs/ai-harness.md, keyed by recipe id. */
const STARTER_HEADINGS: Readonly<Record<string, string>> = {
  "diagnostics-starter": "Minimal starter:",
  "hook-control-core": "Advanced controls starter:",
};

/** The numbered steps under one starter heading, up to the next prose paragraph. */
function starterSection(guide: string, heading: string): string {
  const start = guide.indexOf(`\n${heading}\n`);

  expect(start).toBeGreaterThan(-1);
  const rest = guide.slice(start + 1);
  const end = rest.search(/\n\n(?!\d+\. )/u);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * True when `source` really imports from `specifier`, as opposed to merely
 * mentioning it. A bare substring test is not enough: `from "predicate"` occurs
 * inside a string literal in this very copy set, so an unanchored match would
 * let a package copy survive its last real import.
 */
function importsSpecifier(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^\\s*(?:import|export)[^;]*?from "${escaped}`, "mu").test(source);
}

function recipe(overrides: Partial<PortingRecipe> = {}): PortingRecipe {
  return {
    id: "sample-recipe",
    title: "Sample recipe",
    summary: "A recipe used by the unit tests.",
    entrypoints: ["entry.ts"],
    nonStaticSpecifiers: "throw",
    ...overrides,
  };
}

describe("importsSpecifier", () => {
  it("ignores a package name that is not on an import statement", () => {
    expect(
      importsSpecifier("const label = 'from \"@musi/lint-ratchet\"';\n", "@musi/lint-ratchet"),
    ).toBe(false);
    expect(
      importsSpecifier(
        'import { write } from "@musi/lint-ratchet/atomic-write.js";\n',
        "@musi/lint-ratchet",
      ),
    ).toBe(true);
    expect(
      importsSpecifier(
        'export {\n  write,\n} from "@musi/lint-ratchet/atomic-write.js";\n',
        "@musi/lint-ratchet",
      ),
    ).toBe(true);
  });
});

describe("classifyRecipeClosure", () => {
  it("splits declared adapter edits out of the portable copy set", () => {
    const result = classifyRecipeClosure(
      recipe({
        adapterEdits: [
          {
            path: "policy/registry.ts",
            importedBy: "engine/run.ts",
            replacement: "Replace with your own registry module.",
          },
        ],
      }),
      ["entry.ts", "engine/run.ts", "policy/registry.ts"],
      testPolicy,
    );

    expect(result.failures).toEqual([]);
    expect(result.portableFiles).toEqual(["engine/run.ts", "entry.ts"]);
    expect(result.adapterFiles).toEqual(["policy/registry.ts"]);
  });

  it("fails closed when the closure reaches an undeclared Musi adapter", () => {
    const result = classifyRecipeClosure(recipe(), ["entry.ts", "policy/registry.ts"], testPolicy);

    expect(result.adapterFiles).toEqual(["policy/registry.ts"]);
    expect(result.failures).toEqual([
      "sample-recipe: closure reaches the Musi adapter policy/registry.ts, but the recipe declares no adapterEdits entry for it; add one with a replacement note or stop importing it",
    ]);
  });

  it("fails closed on a closure member outside every declared portable root", () => {
    const result = classifyRecipeClosure(
      recipe(),
      ["entry.ts", "packages/server/src/app.ts"],
      testPolicy,
    );

    expect(result.portableFiles).toEqual(["entry.ts"]);
    expect(result.failures).toEqual([
      "sample-recipe: closure member packages/server/src/app.ts is neither under a declared portable root nor a known Musi adapter; classify it in PORTING_CLASSIFICATION before an adopter copies it",
    ]);
  });

  it("rejects a stale adapter declaration the closure no longer reaches", () => {
    const result = classifyRecipeClosure(
      recipe({
        adapterEdits: [
          {
            path: "policy/registry.ts",
            importedBy: "engine/run.ts",
            replacement: "Replace with your own registry module.",
          },
        ],
      }),
      ["entry.ts"],
      testPolicy,
    );

    expect(result.failures).toEqual([
      "sample-recipe: adapterEdits declares policy/registry.ts, which is not in the recipe closure; remove the stale declaration",
    ]);
  });

  it("rejects an adapter declaration whose importer is outside the closure", () => {
    const result = classifyRecipeClosure(
      recipe({
        adapterEdits: [
          {
            path: "policy/registry.ts",
            importedBy: "engine/absent.ts",
            replacement: "Replace with your own registry module.",
          },
        ],
      }),
      ["entry.ts", "policy/registry.ts"],
      testPolicy,
    );

    expect(result.failures).toEqual([
      "sample-recipe: adapterEdits for policy/registry.ts names importer engine/absent.ts, which is not in the recipe closure",
    ]);
  });

  /**
   * `adapterPaths` is what stops the walk and moves a file out of the copy set;
   * `adapterEdits` only says what an adopter puts in its place. Declaring an
   * edit for a file the policy still calls portable would copy it *and* tell the
   * adopter to replace it, so the two lists are pinned together here rather than
   * left as a same-file footgun.
   */
  it("rejects an adapter edit the classification policy does not call an adapter", () => {
    const result = classifyRecipeClosure(
      recipe({
        adapterEdits: [
          {
            path: "engine/run.ts",
            importedBy: "entry.ts",
            replacement: "Replace with your own module.",
          },
        ],
      }),
      ["entry.ts", "engine/run.ts"],
      testPolicy,
    );

    expect(result.portableFiles).toEqual(["engine/run.ts", "entry.ts"]);
    expect(result.failures).toEqual([
      "sample-recipe: adapterEdits declares engine/run.ts, which PORTING_CLASSIFICATION does not list as a Musi adapter; add it to adapterPaths so the walk stops there and the copy set excludes it",
    ]);
  });

  it("requires a replacement note on every adapter edit", () => {
    const result = classifyRecipeClosure(
      recipe({
        adapterEdits: [{ path: "policy/registry.ts", importedBy: "entry.ts", replacement: "  " }],
      }),
      ["entry.ts", "policy/registry.ts"],
      testPolicy,
    );

    expect(result.failures).toEqual([
      "sample-recipe: adapterEdits for policy/registry.ts must carry a non-empty replacement note",
    ]);
  });
});

describe("derivePortingClosures", () => {
  it("records a declared adapter without following its imports", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./engine/run.js";\n',
        "engine/run.ts": 'import "../policy/registry.js";\n',
        "policy/registry.ts": 'import "./musi-only.js";\nexport const registry = [];\n',
        "policy/musi-only.ts": "export const musiOnly = true;\n",
      },
      "porting-recipes-",
    );

    const { closures, failures } = derivePortingClosures(
      root,
      [
        recipe({
          adapterEdits: [
            {
              path: "policy/registry.ts",
              importedBy: "engine/run.ts",
              replacement: "Replace with your own registry module.",
            },
          ],
        }),
      ],
      testPolicy,
    );

    expect(failures).toEqual([]);
    expect(closures).toHaveLength(1);
    expect(closures[0]?.portableFiles).toEqual(["engine/run.ts", "entry.ts"]);
    expect(closures[0]?.adapterFiles).toEqual(["policy/registry.ts"]);
  });

  /**
   * A copy set is not a fingerprint: the adopter's checkout has to compile, so a
   * type-only import whose target no value import reaches is still a file they
   * must copy. The runtime-only walk drops that edge, which is how a derived
   * list could still ship a starter that fails `tsc`.
   */
  it("copies a type-only dependency no value import reaches", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts":
          'import type { Shape } from "./engine/shape.js";\n' +
          "export const identity = (value: Shape): Shape => value;\n",
        "engine/shape.ts": "export interface Shape {\n  readonly id: string;\n}\n",
      },
      "porting-recipes-",
    );

    const { closures, failures } = derivePortingClosures(root, [recipe()], testPolicy);

    expect(failures).toEqual([]);
    expect(closures[0]?.portableFiles).toEqual(["engine/shape.ts", "entry.ts"]);
  });

  /**
   * A copy set is machinery the adopter keeps, but some of the files in it
   * carry hard-coded Musi values marked in place with `porting-knob`. The
   * manifest derives that list from the same markers `harness:check` holds
   * against scripts/ai-hooks/README.md, so an adopter is never told the copy is
   * the whole edit.
   */
  it("surfaces the porting-knob markers inside a recipe's copy set", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./engine/run.js";\n',
        "engine/run.ts":
          "// porting-knob: sample-knob -- retarget the sample value\nexport const value = 1;\n",
      },
      "porting-recipes-",
    );

    const { closures, failures } = derivePortingClosures(root, [recipe()], testPolicy);

    expect(failures).toEqual([]);
    expect(closures[0]?.knobs).toEqual([{ id: "sample-knob", files: ["engine/run.ts"] }]);
  });

  it("leaves knobs inside a replaced adapter out of the copy set's knob list", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./policy/registry.js";\n',
        "policy/registry.ts":
          "// porting-knob: adapter-knob -- replaced wholesale\nexport const registry = [];\n",
      },
      "porting-recipes-",
    );

    const { closures } = derivePortingClosures(
      root,
      [
        recipe({
          adapterEdits: [
            {
              path: "policy/registry.ts",
              importedBy: "entry.ts",
              replacement: "Replace with your own registry module.",
            },
          ],
        }),
      ],
      testPolicy,
    );

    expect(closures[0]?.knobs).toEqual([]);
  });

  /**
   * `path` is the only field of a package copy the derivation never consumes —
   * it is rendered straight into the adopter's instructions. A typo there sends
   * them to a directory that is not the package the specifier names, and every
   * other check stays green.
   */
  it("rejects a package copy whose directory holds a different package", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": "export const value = 1;\n",
        "vendor/engine/package.json": '{ "name": "@other/engine" }\n',
      },
      "porting-recipes-",
    );

    const { failures } = derivePortingClosures(
      root,
      [
        recipe({
          packageCopies: [
            { path: "vendor/engine/", specifier: "@vendor/engine", reason: "Copied whole." },
          ],
        }),
      ],
      testPolicy,
    );

    expect(failures).toEqual([
      "sample-recipe: packageCopies entry vendor/engine/ declares package @vendor/engine, but its package.json names @other/engine",
    ]);
  });

  it("rejects a package copy whose directory is not there", () => {
    const root = tmpRepo.writeRepo({ "entry.ts": "export const value = 1;\n" }, "porting-recipes-");

    const { failures } = derivePortingClosures(
      root,
      [
        recipe({
          packageCopies: [
            { path: "vendor/absent/", specifier: "@vendor/absent", reason: "Copied whole." },
          ],
        }),
      ],
      testPolicy,
    );

    expect(failures.join("\n")).toContain(
      "sample-recipe: packageCopies entry vendor/absent/ has no readable package.json",
    );
  });

  it("reports the entrypoint when a closure walk fails", () => {
    const root = tmpRepo.writeRepo({ "entry.ts": 'import "./missing.js";\n' }, "porting-recipes-");

    const { failures } = derivePortingClosures(root, [recipe()], testPolicy);

    expect(failures.join("\n")).toContain(
      "sample-recipe: failed to walk the import closure of entry.ts",
    );
  });
});

describe("the live porting recipes", () => {
  // The derivation is pure and the whole block asserts about one answer, so it
  // is walked once: four independent walks over the real tree bought four
  // copies of the same signal.
  let derivation: PortingClosureDerivation;

  beforeAll(() => {
    derivation = derivePortingClosures(repoRoot, PORTING_RECIPES);
  });

  it("classifies every closure member of every recipe", () => {
    const { failures, closures } = derivation;

    expect(failures).toEqual([]);
    expect(closures.map((closure) => closure.recipe.id)).toEqual(
      PORTING_RECIPES.map((entry) => entry.id),
    );
    for (const closure of closures) {
      expect(closure.portableFiles.length).toBeGreaterThan(0);
    }
  });

  it("derives the diagnostics helpers the hand-written starter list omitted", () => {
    const diagnostics = derivation.closures.find(
      (closure) => closure.recipe.id === "diagnostics-starter",
    );

    expect(diagnostics?.portableFiles).toEqual(
      expect.arrayContaining([
        "scripts/cli-option-values.ts",
        "scripts/lib/atomic-write.ts",
        "scripts/lib/cli.ts",
        "scripts/lib/error-message.ts",
        "scripts/lib/process-argv.ts",
      ]),
    );
  });

  it("keeps the portable core's one adapter import declared with a replacement note", () => {
    const core = derivation.closures.find((closure) => closure.recipe.id === "hook-control-core");

    expect(core?.adapterFiles).toEqual(["scripts/lint-ratchet/lint-ratchet-config.ts"]);
    expect(core?.recipe.adapterEdits?.[0]?.importedBy).toBe(
      "scripts/harness/generate-harness-controls.ts",
    );
    expect(core?.recipe.adapterEdits?.[0]?.replacement).not.toBe("");
  });

  /**
   * S2's public contract: the guide names entrypoints and hands the file list
   * off to the manifest. The handoff is asserted inside each starter's own
   * steps: a guide-wide search would still pass with both copy steps deleted,
   * because the manifest link also sits in the section's introduction — and a
   * starter that stops naming the manifest is exactly the drift that put
   * hand-typed copy lists in the guide in the first place.
   */
  it("hands each guide starter off to the generated manifest", () => {
    const guide = readFileSync(join(repoRoot, "docs/ai-harness.md"), "utf8");

    for (const entry of PORTING_RECIPES.flatMap((current) => current.entrypoints)) {
      expect(guide).toContain(entry);
    }
    expect(Object.keys(STARTER_HEADINGS).sort()).toEqual(
      PORTING_RECIPES.map((current) => current.id).sort(),
    );
    for (const closure of derivation.closures) {
      const section = starterSection(guide, STARTER_HEADINGS[closure.recipe.id] ?? "");

      expect(section).toContain(GENERATED_HARNESS_PORTING_MANIFEST_PATH.replace("docs/", ""));
      expect(section).toContain(`\`${closure.recipe.id}\``);
      // A copy set carrying in-file Musi values is not "copy these files": the
      // starter has to send the adopter at the knob list the manifest derives.
      if (closure.knobs.length > 0) expect(section).toContain("porting-knob");
    }
    // The guide's "Musi adapters" bullet is the narrative form of
    // `adapterPaths`; a fourth adapter that never reaches the prose is the same
    // hand-list drift one level up from the copy sets.
    for (const path of PORTING_CLASSIFICATION.adapterPaths) {
      expect(guide).toContain(path);
    }
  });

  /**
   * A whole-package copy is an instruction to take a directory an adopter did
   * not ask for, and its reason describes edges out of the copy set. Nothing in
   * the derivation corroborates that: the walker returns files, not edges. This
   * is the cheap half — every declared package must still be imported by some
   * file the recipe tells adopters to copy, so a dropped indirection cannot
   * leave a stale directory copy in the manifest.
   */
  it("imports every package whose directory the recipe tells adopters to copy", () => {
    for (const closure of derivation.closures) {
      const sources = closure.portableFiles.map((file) =>
        readFileSync(join(repoRoot, file), "utf8"),
      );
      for (const copy of closure.recipe.packageCopies ?? []) {
        const importers = closure.portableFiles.filter((_file, index) =>
          importsSpecifier(sources[index] ?? "", copy.specifier),
        );

        expect(`${closure.recipe.id}: ${copy.specifier} <- ${importers.join(", ")}`).not.toBe(
          `${closure.recipe.id}: ${copy.specifier} <- `,
        );
      }
    }
  });

  /**
   * The one fail-open skip in the recipes is justified by a boundary note, and a
   * note that misnames what the skipped module loads hides an adopter
   * prerequisite: `generate-harness-controls.ts` awaits this loader
   * unconditionally, so a copy set without that host file cannot run at all.
   * Both sides are pinned here — the note is only true while the loader still
   * reads the file it names.
   */
  it("names the host config file the skipped rule-docs loader actually reads", () => {
    const loader = readFileSync(join(repoRoot, "scripts/lib/lint-rule-docs.ts"), "utf8");

    expect(loader).toContain(`join(repoRoot, "${HOST_LINT_CONFIG_FILE}")`);

    const core = PORTING_RECIPES.find((current) => current.id === "hook-control-core");

    expect(core?.boundaryNotes?.join("\n")).toContain(HOST_LINT_CONFIG_FILE);
    expect(renderPortingManifest(derivation, PORTING_CLASSIFICATION)).toContain(
      HOST_LINT_CONFIG_FILE,
    );
  });

  /**
   * The Advanced controls starter used to promise "the one adapter edit"; the
   * `porting-knob` markers inside the copied files say otherwise. A hand-typed
   * list of them in prose would be the same drift this manifest exists to
   * delete, so the manifest scans them out of its own copy set.
   */
  it("derives the in-file Musi knobs the hook-control copy set carries", () => {
    const core = derivation.closures.find((closure) => closure.recipe.id === "hook-control-core");

    expect(core?.knobs.map((knob) => knob.id)).toEqual(
      expect.arrayContaining(["repo-root-fallback", "verify-consumers"]),
    );
    for (const knob of core?.knobs ?? []) {
      expect(core?.portableFiles).toEqual(expect.arrayContaining([...knob.files]));
    }
    expect(renderPortingManifest(derivation, PORTING_CLASSIFICATION)).toContain(
      "`repo-root-fallback`",
    );
  });

  /**
   * `adapterPaths` mixes two kinds of entry: modules a recipe actually reaches
   * and replaces, and pre-classifications that only keep a Musi-policy module
   * under a portable root from being copied as machinery. Telling an adopter to
   * replace all three would send them after two modules no copy set contains,
   * so the rendered list says which is which, from the derivation.
   */
  it("marks the adapter entries no recipe reaches as pre-classifications", () => {
    const rendered = renderPortingManifest(derivation, PORTING_CLASSIFICATION);
    const reached = new Set(derivation.closures.flatMap((closure) => closure.adapterFiles));

    expect(reached).toEqual(new Set(["scripts/lint-ratchet/lint-ratchet-config.ts"]));
    for (const path of PORTING_CLASSIFICATION.adapterPaths) {
      expect(rendered).toContain(
        reached.has(path)
          ? `- \`${path}\` — replaced by`
          : `- \`${path}\` — pre-classified; no recipe below reaches it`,
      );
    }
  });

  it("matches the committed generated copy manifest byte-for-byte", () => {
    expect(derivation.failures).toEqual([]);
    expect(renderPortingManifest(derivation, PORTING_CLASSIFICATION)).toBe(
      readFileSync(join(repoRoot, GENERATED_HARNESS_PORTING_MANIFEST_PATH), "utf8"),
    );
  });
});
