// Generates the committed `local` ESLint plugin registry from the rule files on
// disk: eslint-config/local-plugin.generated.js.
//
// The output is a plain module with STATIC imports and no runtime discovery on
// purpose — eslint.config.js loads it synchronously on every lint run, so a
// filesystem scan, a top-level await, or config-load IO there would cost every
// invocation and break flat-config loading. Discovery happens here, at refresh
// time, and the result is committed and freshness-gated (`bun run
// lint:local-plugin:check`, also reached by `bun run harness:check`).
//
// BOOTSTRAP ORDER: this generator must run before any generator that imports
// eslint.config.js (notably scripts/harness/generate-lint-rule-controls.ts,
// which reads flat-config activation through loadLocalRuleConfig). eslint.config.js
// statically imports the module this generator emits, so a tree without it
// cannot load flat config at all. Discovery here deliberately depends only on
// the filesystem and the rule modules themselves, never on flat config.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { runDocGeneratorAsync } from "../lib/doc-generator.js";
import { type DiscoveredLocalRule, discoverLocalRules } from "./local-rule-discovery.js";

/**
 * Repo-relative path of the generated registry.
 *
 * Where this path is registered, since it lives under eslint-config/: the
 * generatedSurface record in harness.controls.json (freshness), the exclude in
 * tsconfig.eslint-js.json (whose `eslint-config/*.js` include already covers
 * it), and the coverage-map row for `eslint-config/*.js`. Deliberately NOT
 * eslint-config/config-surface-manifest.json — that manifest enumerates
 * maintained tool config files, and no eslint-config policy module (generated
 * or authored) belongs in it; see the header of eslint-config/config-surfaces.js.
 */
export const LOCAL_PLUGIN_OUTPUT_PATH = "eslint-config/local-plugin.generated.js";

/** `bun run <script>` that refreshes {@link LOCAL_PLUGIN_OUTPUT_PATH}. */
export const LOCAL_PLUGIN_REFRESH_COMMAND = "lint:local-plugin";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, LOCAL_PLUGIN_OUTPUT_PATH);

/**
 * `no-plain-error-in-trpc` -> `noPlainErrorInTrpc`. The transform only
 * camel-cases `-[a-z0-9]`, so it is total ONLY over lowercase kebab ids —
 * {@link assertBindableIds} rejects everything else before a render, because
 * filename-derived identity means a filename that cannot become an identifier
 * would otherwise be written straight into the module as one.
 */
export function localPluginImportBinding(id: string): string {
  return id.replaceAll(/-([a-z0-9])/gu, (_match, character: string) => character.toUpperCase());
}

/** Lowercase kebab-case: the only filename shape that camel-cases cleanly. */
const BINDABLE_RULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/**
 * The one binding the rendered module declares for itself.
 *
 * Rendered from this constant below, so the value the guard rejects and the
 * value the module exports cannot drift apart. `assertUniqueBindings` only sees
 * rule-vs-rule collisions and `RESERVED_BINDINGS` only sees language keywords,
 * so without this the perfectly bindable id `local-plugin` would render
 * `import localPlugin ...` above `export const localPlugin = {`.
 */
const MODULE_EXPORT_BINDING = "localPlugin";

/**
 * Reserved words a single-word rule id could otherwise become. Multi-word ids
 * camel-case to a binding with an uppercase letter, which no reserved word has,
 * so only the single-word case needs this list.
 */
const RESERVED_BINDINGS: ReadonlySet<string> = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/**
 * Reject ids that cannot become an import binding, BEFORE anything is written.
 *
 * Discovery accepts any rule-shaped `eslint-rules/*.js`, so `2fa-required.js`,
 * `no.barrel.js` or `default.js` reach the renderer as ordinary rules. Rendering
 * them emits `import 2faCheck from ...` — syntactically invalid JavaScript that
 * still matches a fresh render, so the refresh writes it and exits 0 and
 * `lint:local-plugin:check` calls it fresh. Everything that LOADS the module
 * then dies with a raw ESM SyntaxError in a generated file: every lint run,
 * because eslint.config.js imports it statically, and every generator that
 * reaches flat-config activation through it. This generator is not among them —
 * it depends only on the filesystem and the rule modules (see BOOTSTRAP ORDER
 * above), so it can never be the command that reports the defect unless it
 * refuses the id first. Failing here instead keeps the
 * diagnostic in the same family as the empty-set, unimportable-module and
 * binding-collision errors: named, and pointing at the file to rename.
 */
function assertBindableIds(rules: readonly DiscoveredLocalRule[]): void {
  for (const rule of rules) {
    if (!BINDABLE_RULE_ID_PATTERN.test(rule.id)) {
      throw new Error(
        `local rule file ${rule.source} cannot become an import binding in ${LOCAL_PLUGIN_OUTPUT_PATH}; rename it to lowercase kebab-case (letters, digits and single hyphens, starting with a letter)`,
      );
    }
    const binding = localPluginImportBinding(rule.id);
    if (RESERVED_BINDINGS.has(binding)) {
      throw new Error(
        `local rule file ${rule.source} maps to the reserved word ${binding}, which cannot become an import binding in ${LOCAL_PLUGIN_OUTPUT_PATH}; rename the file`,
      );
    }
    if (binding === MODULE_EXPORT_BINDING) {
      throw new Error(
        `local rule file ${rule.source} maps to the import binding ${binding}, which ${LOCAL_PLUGIN_OUTPUT_PATH} already declares as its own export; rename the file`,
      );
    }
  }
}

function importSpecifier(rule: DiscoveredLocalRule): string {
  return `../${rule.source}`;
}

/** A bindable rule id with no hyphen is already a valid object-key identifier. */
const IDENTIFIER_RULE_ID_PATTERN = /^[a-z][a-z0-9]*$/u;

/**
 * The plugin key as prettier would write it.
 *
 * These bytes are gated twice, by two tools that have to agree: the freshness
 * check demands exactly what this renderer emits, and `format:check` demands
 * exactly what prettier emits. `.prettierrc` sets no `quoteProps`, so prettier's
 * default `as-needed` strips the quotes off any key that is already an
 * identifier, and eslint-config/ is not in `.prettierignore`. Every live rule id
 * is hyphenated, so quoting is required today — but always quoting would make a
 * future single-word id (`eslint-rules/complexity.js`) a deadlock: prettier
 * would rewrite `"complexity":` to `complexity:` and the freshness check would
 * rewrite it back, with no tree that passes both gates.
 */
function pluginRuleKey(id: string): string {
  return IDENTIFIER_RULE_ID_PATTERN.test(id) ? id : JSON.stringify(id);
}

function assertUniqueBindings(rules: readonly DiscoveredLocalRule[]): void {
  const bindingOwners = new Map<string, string>();
  for (const rule of rules) {
    const binding = localPluginImportBinding(rule.id);
    const owner = bindingOwners.get(binding);
    if (owner !== undefined) {
      throw new Error(
        `local rule ids ${owner} and ${rule.id} both map to the import binding ${binding}; rename one rule file`,
      );
    }
    bindingOwners.set(binding, rule.id);
  }
}

/**
 * The registry's own order: by bare rule id, NOT by filename.
 *
 * Discovery hands back FILENAME order with the `.js` suffix attached
 * (local-rule-discovery.ts), and `-` (0x2D) precedes `.` (0x2E), so a prefix
 * pair like `no-barrel.js` / `no-barrel-strict.js` arrives here as
 * [`no-barrel-strict`, `no-barrel`] — the reverse of registry order. Anything
 * comparing the registry's keys against a discovered rule sequence must project
 * through this function; mapping discovery order straight to ids turns such a
 * comparison into an accidental ban on prefix-pair rule ids.
 */
export function localPluginRuleIds(rules: readonly DiscoveredLocalRule[]): readonly string[] {
  return sortByRuleId(rules).map((rule) => rule.id);
}

function sortByRuleId(rules: readonly DiscoveredLocalRule[]): readonly DiscoveredLocalRule[] {
  return rules.toSorted((left, right) => compareByCodepoint(left.id, right.id));
}

/**
 * Render the plugin module. Sorting happens here rather than being assumed of
 * the caller, so the committed bytes are a pure function of the rule id SET —
 * that is what makes the freshness check meaningful and what replaces the
 * former hand-maintained alphabetical ordering guarantee.
 */
export function renderLocalPluginModule(rules: readonly DiscoveredLocalRule[]): string {
  if (rules.length === 0) {
    throw new Error("refusing to render an empty local plugin registry");
  }
  const sorted = sortByRuleId(rules);
  assertBindableIds(sorted);
  assertUniqueBindings(sorted);
  return [
    "// @ts-check",
    "// Generated by scripts/harness/generate-local-plugin.ts. Do not edit by hand.",
    `// Add a rule by creating eslint-rules/<name>.js, then run \`bun run ${LOCAL_PLUGIN_REFRESH_COMMAND}\`.`,
    "",
    ...sorted.map(
      (rule) =>
        `import ${localPluginImportBinding(rule.id)} from ${JSON.stringify(importSpecifier(rule))};`,
    ),
    "",
    `export const ${MODULE_EXPORT_BINDING} = {`,
    "  rules: {",
    ...sorted.map((rule) => `    ${pluginRuleKey(rule.id)}: ${localPluginImportBinding(rule.id)},`),
    "  },",
    "};",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  await runDocGeneratorAsync({
    outputPath,
    refreshCommand: LOCAL_PLUGIN_REFRESH_COMMAND,
    render: async () => {
      const rules = await discoverLocalRules(repoRoot);
      return {
        rendered: renderLocalPluginModule(rules),
        wroteSuffix: ` (${String(rules.length)} local rule(s))`,
      };
    },
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
