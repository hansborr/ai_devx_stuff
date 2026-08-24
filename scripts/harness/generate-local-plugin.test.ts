// Generator coverage for the local plugin registry.
//
// This file also carries the two guarantees the retired hand-registry test
// (eslint-rules/local-plugin-registry.test.js) used to own, now expressed
// against the generator instead of against a hand-maintained map:
//
// 1. ordering — the committed registry lists rule ids in one deterministic
//    order, pinned here on the renderer rather than re-asserted on the file;
// 2. filesystem completeness — every rule-shaped module in eslint-rules/ is
//    registered, and every registered id resolves to that module's object.
//
// The live-tree cases import the generated registry through a COMPUTED
// specifier on purpose: a static import would pull the whole eslint-rules/*.js
// graph into the tsconfig.scripts.json program, which is exactly what
// tsconfig.eslint-js.json excludes it from (parked estree/TSESTree JSDoc drift).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { format, resolveConfig } from "prettier";
import { describe, expect, it } from "vitest";

import { isObjectLike } from "../lib/records.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  LOCAL_PLUGIN_OUTPUT_PATH,
  localPluginImportBinding,
  localPluginRuleIds,
  renderLocalPluginModule,
} from "./generate-local-plugin.js";
import {
  type DiscoveredLocalRule,
  discoverLocalRules,
  LOCAL_RULE_DIRECTORY,
  localRuleCandidateFiles,
  localRuleSourcePath,
} from "./local-rule-discovery.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tmpRepo = registerTempRootCleanup();

const RULE_MODULE = "export default { meta: { docs: {} }, create() { return {}; } };\n";
const HELPER_MODULE = "export function helper() { return 1; }\n";
const META_ONLY_MODULE = "export default { meta: { docs: {} } };\n";

function rule(id: string): DiscoveredLocalRule {
  return { id, source: localRuleSourcePath(id) };
}

async function loadGeneratedPluginRules(): Promise<Record<string, unknown>> {
  const module: unknown = await import(
    pathToFileURL(join(repoRoot, LOCAL_PLUGIN_OUTPUT_PATH)).href
  );
  if (!isObjectLike(module) || !isObjectLike(module.localPlugin)) {
    throw new Error(`${LOCAL_PLUGIN_OUTPUT_PATH} must export localPlugin`);
  }
  const { rules } = module.localPlugin;
  if (!isObjectLike(rules)) throw new Error(`${LOCAL_PLUGIN_OUTPUT_PATH} must export rules`);
  return rules;
}

/**
 * Plugin keys in the order a rendered module lists them, read back from its
 * text. Quoting is optional: a single-word id is emitted bare so the render
 * stays a prettier fixed point.
 */
function renderedPluginRuleKeys(rendered: string): readonly string[] {
  return [...rendered.matchAll(/^ {4}"?([^":]+)"?: /gmu)].map(([, id]) => id ?? "");
}

async function loadRuleFileDefault(id: string): Promise<unknown> {
  const module: unknown = await import(pathToFileURL(join(repoRoot, localRuleSourcePath(id))).href);
  if (!isObjectLike(module)) throw new Error(`${localRuleSourcePath(id)} did not load`);
  return module.default;
}

describe("localRuleCandidateFiles", () => {
  it("keeps module files, drops suites and non-JS, and sorts deterministically", () => {
    expect(
      localRuleCandidateFiles([
        "no-barrel.test.js",
        "zz-last.js",
        "vitest.config.ts",
        "ast-helpers.js",
        "no-barrel.js",
        "corpus.json",
      ]),
    ).toEqual(["ast-helpers.js", "no-barrel.js", "zz-last.js"]);
  });
});

describe("discoverLocalRules", () => {
  it("accepts only modules with the ESLint rule export shape", async () => {
    const root = tmpRepo.makeTempRepo("local-rule-discovery-");
    for (const [name, body] of [
      ["b-rule.js", RULE_MODULE],
      ["a-rule.js", RULE_MODULE],
      ["ast-helpers.js", HELPER_MODULE],
      ["meta-only.js", META_ONLY_MODULE],
      ["a-rule.test.js", "throw new Error('a suite must never be imported by discovery');\n"],
    ] as const) {
      tmpRepo.writeRepoFile(root, `${LOCAL_RULE_DIRECTORY}/${name}`, body);
    }

    expect(await discoverLocalRules(root)).toEqual([rule("a-rule"), rule("b-rule")]);
  });

  it("refuses to derive an empty rule set", async () => {
    const root = tmpRepo.makeTempRepo("local-rule-discovery-empty-");
    tmpRepo.writeRepoFile(root, `${LOCAL_RULE_DIRECTORY}/ast-helpers.js`, HELPER_MODULE);

    await expect(discoverLocalRules(root)).rejects.toThrow(/refusing to render an empty/u);
  });

  it("wraps a module that fails to load with the bootstrap rule", async () => {
    const root = tmpRepo.makeTempRepo("local-rule-discovery-cycle-");
    tmpRepo.writeRepoFile(root, `${LOCAL_RULE_DIRECTORY}/a-rule.js`, RULE_MODULE);
    tmpRepo.writeRepoFile(
      root,
      `${LOCAL_RULE_DIRECTORY}/registry-consumer.js`,
      'throw new Error("local-plugin.generated.js is not built yet");\n',
    );

    await expect(discoverLocalRules(root)).rejects.toThrow(
      /must be importable without the generated plugin registry/u,
    );
  });
});

describe("localPluginImportBinding", () => {
  it("camel-cases kebab rule ids", () => {
    expect(localPluginImportBinding("no-plain-error-in-trpc")).toBe("noPlainErrorInTrpc");
    expect(localPluginImportBinding("e2e-prefer-role-selectors")).toBe("e2ePreferRoleSelectors");
    expect(localPluginImportBinding("max-lines")).toBe("maxLines");
  });
});

describe("renderLocalPluginModule", () => {
  it("emits static imports and plugin keys in one deterministic order", () => {
    const rendered = renderLocalPluginModule([rule("zz-last"), rule("aa-first"), rule("mm-mid")]);

    expect(rendered).toContain('import aaFirst from "../eslint-rules/aa-first.js";');
    expect(rendered.indexOf("aa-first")).toBeLessThan(rendered.indexOf("mm-mid"));
    expect(rendered.indexOf("mm-mid")).toBeLessThan(rendered.indexOf("zz-last"));
    expect(rendered).toContain('    "mm-mid": mmMid,');
  });

  it("stays synchronously importable: no await, no fs, no dynamic import", () => {
    const rendered = renderLocalPluginModule([rule("aa-first")]);

    expect(rendered).not.toMatch(/\bawait\b/u);
    expect(rendered).not.toMatch(/\bimport\s*\(/u);
    expect(rendered).not.toMatch(/node:fs|readdirSync/u);
  });

  it("refuses an empty rule set", () => {
    expect(() => renderLocalPluginModule([])).toThrow(/refusing to render an empty/u);
  });

  // Bindable ids still collide when a hyphen precedes a digit: uppercasing a
  // digit is a no-op, so `e-2e` and `e2e` produce the same binding.
  it("refuses ids that collide on one import binding", () => {
    expect(() => renderLocalPluginModule([rule("e-2e"), rule("e2e")])).toThrow(
      /both map to the import binding e2e/u,
    );
  });

  // Rendering an unbindable id would write syntactically invalid JavaScript
  // that still passes its own freshness check: the refresh would exit 0, and
  // every command that LOADS eslint.config.js — every lint run, and the
  // generators that read flat-config activation — would die with a raw ESM
  // SyntaxError instead of a named generator error. The generator itself never
  // loads flat config, so it cannot report the defect after the fact.
  it.each([
    ["a leading digit", "2fa-required"],
    ["dots", "no.barrel"],
    ["uppercase", "No-Barrel"],
    ["an underscore", "no_barrel"],
    ["a trailing hyphen", "no-barrel-"],
  ])("refuses a rule filename with %s", (_label, id) => {
    expect(() => renderLocalPluginModule([rule(id)])).toThrow(/cannot become an import binding/u);
  });

  it("refuses a rule filename that is a reserved word", () => {
    expect(() => renderLocalPluginModule([rule("default")])).toThrow(/reserved word/u);
  });

  // eslint-rules/local-plugin.js is a bindable, collision-free id that camel-cases
  // onto the binding the rendered module declares for itself, so `import
  // localPlugin ...` would sit above `export const localPlugin = {` — a lexical
  // redeclaration that is a SyntaxError on every flat-config load, while the
  // freshness check still passes because the bytes match a fresh render. Same
  // failure class as the unbindable filenames above, so it must fail the same way.
  it("refuses a rule filename that shadows the module's own export binding", () => {
    expect(() => renderLocalPluginModule([rule("local-plugin"), rule("no-barrel")])).toThrow(
      /already declares/u,
    );
  });

  // The rendered bytes are gated twice, by two tools that must agree: the
  // freshness check demands exactly what this renderer emits, and format:check
  // demands exactly what prettier emits. .prettierrc sets no quoteProps, so
  // prettier's default `as-needed` strips the quotes off any key that is already
  // an identifier. Every live rule id is hyphenated, so quotes are required
  // today; a single-word id (eslint-rules/complexity.js) emitted as
  // `"complexity":` would leave format and lint:local-plugin:check each undoing
  // the other's edit, with no tree that satisfies both. Assert the fixed point
  // against real prettier rather than a restatement of its rule.
  it("emits plugin keys prettier already agrees with", async () => {
    const rendered = renderLocalPluginModule([rule("complexity"), rule("no-barrel")]);

    expect(rendered).toContain("    complexity: complexity,");
    expect(rendered).toContain('    "no-barrel": noBarrel,');

    const filepath = join(repoRoot, LOCAL_PLUGIN_OUTPUT_PATH);
    expect(await format(rendered, { ...((await resolveConfig(filepath)) ?? {}), filepath })).toBe(
      rendered,
    );
  });

  it("accepts the kebab and digit-suffixed shapes the live tree uses", () => {
    expect(() => renderLocalPluginModule([rule("e2e-prefer-role-selectors")])).not.toThrow();
    expect(() => renderLocalPluginModule([rule("no-barrel")])).not.toThrow();
  });
});

describe("registry order vs discovery order", () => {
  // Discovery sorts FILENAMES (`.js` included) and `-` (0x2D) precedes `.`
  // (0x2E), so a prefix pair arrives in an order the registry's bare-id sort
  // does not reproduce. Anything that compares registry keys against a
  // discovered sequence has to project through the registry's own order, or the
  // filesystem-completeness guarantee silently becomes "the tree must not
  // contain a prefix-pair rule id" — a shape the generator is written to allow.
  //
  // Synthetic ids on purpose: this must keep failing when the live rule set
  // happens to contain no prefix pair, which is the state that hides the bug.
  it("compares a prefix-pair rule set the way the registry orders it", async () => {
    const root = tmpRepo.makeTempRepo("local-plugin-prefix-pair-");
    for (const name of ["zz-prefix.js", "zz-prefix-extra.js"]) {
      tmpRepo.writeRepoFile(root, `${LOCAL_RULE_DIRECTORY}/${name}`, RULE_MODULE);
    }
    const discovered = await discoverLocalRules(root);

    // The divergence itself, pinned so this case keeps testing what it claims.
    expect(discovered.map((entry) => entry.id)).toEqual(["zz-prefix-extra", "zz-prefix"]);

    const registered = renderedPluginRuleKeys(renderLocalPluginModule(discovered));

    expect(registered).toEqual(["zz-prefix", "zz-prefix-extra"]);
    // ...and the projection the completeness assertion compares against is the
    // registry's order, not the discovery order it was handed.
    expect(localPluginRuleIds(discovered)).toEqual(registered);
  });
});

describe("committed registry (live tree)", () => {
  it("is byte-identical to a fresh render of the rule files on disk", async () => {
    const rules = await discoverLocalRules(repoRoot);

    expect(readFileSync(join(repoRoot, LOCAL_PLUGIN_OUTPUT_PATH), "utf8")).toBe(
      renderLocalPluginModule(rules),
    );
  });

  // localPluginRuleIds, not discovery order: the two differ for a prefix pair,
  // and this assertion is the filesystem-completeness guarantee, not an
  // ordering one (the renderer owns ordering, pinned above).
  it("registers every rule-shaped file in eslint-rules/ and nothing else", async () => {
    const discovered = await discoverLocalRules(repoRoot);
    const registered = Object.keys(await loadGeneratedPluginRules());

    expect(registered).toEqual(localPluginRuleIds(discovered));
    expect(registered.length).toBeGreaterThan(0);
  });

  it("wires each registered id to the rule object exported by its own file", async () => {
    const rules = await loadGeneratedPluginRules();

    for (const id of Object.keys(rules)) {
      expect(rules[id], `${id} rule object`).toBe(await loadRuleFileDefault(id));
    }
  });

  it("leaves the non-rule helper modules in eslint-rules/ unregistered", async () => {
    const registered = new Set(Object.keys(await loadGeneratedPluginRules()));
    const candidates = localRuleCandidateFiles(readdirSync(join(repoRoot, LOCAL_RULE_DIRECTORY)));
    const helpers = candidates
      .map((name) => name.slice(0, -".js".length))
      .filter((id) => !registered.has(id));

    // A guard against the guard: if this ever empties, shape classification has
    // stopped being exercised by the live tree and only the temp-dir cases cover it.
    expect(helpers.length).toBeGreaterThan(0);
    expect(helpers).toContain("rule-module-shape");
  });
});
