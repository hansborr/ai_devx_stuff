// Filesystem discovery of the local ESLint rule set: the single derivation
// both generated registration surfaces read from.
//
// Rule identity and module path already exist on disk as `eslint-rules/<id>.js`,
// so neither the plugin registry (generate-local-plugin.ts) nor the lint-rule
// manifest controls (generate-lint-rule-controls.ts) need a hand-authored
// catalog. Classification is by export SHAPE, not by an allowlist: helper
// modules (`ast-helpers.js`, `rule-tester.js`, the effect-misuse analyzers, this
// directory's other support files) live beside the rules and must stay
// unregistered without anyone maintaining a deny list. `*.test.js` files are
// excluded before any import so a suite is never loaded here.
//
// The classifier itself lives in eslint-rules/rule-module-shape.js; see that
// file's header for why it imports nothing.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { ruleFromModule } from "../../eslint-rules/rule-module-shape.js";
import { compareByCodepoint } from "../lib/codepoint-compare.js";

/** Repo-relative directory holding every local rule module and its helpers. */
export const LOCAL_RULE_DIRECTORY = "eslint-rules";

const RULE_FILE_SUFFIX = ".js";
const RULE_TEST_FILE_SUFFIX = ".test.js";

/** One discovered rule: `id` is the bare rule name, `source` its repo path. */
export interface DiscoveredLocalRule {
  /** Bare rule name, e.g. `no-barrel` — the `local/<id>` suffix and plugin key. */
  readonly id: string;
  /** Repo-relative module path, e.g. `eslint-rules/no-barrel.js`. */
  readonly source: string;
}

/**
 * The candidate module files in `eslint-rules/`, codepoint-sorted. Sorting here
 * (not at the call site) is what makes every downstream generated artifact
 * byte-stable regardless of `readdirSync` order.
 */
export function localRuleCandidateFiles(entryNames: readonly string[]): readonly string[] {
  return entryNames
    .filter((name) => name.endsWith(RULE_FILE_SUFFIX) && !name.endsWith(RULE_TEST_FILE_SUFFIX))
    .toSorted(compareByCodepoint);
}

/**
 * Import one candidate module, re-throwing with the bootstrap rule attached.
 * The failure mode worth naming: a NON-test helper in `eslint-rules/` that
 * imports the generated registry makes discovery depend on its own output, so
 * a tree missing the generated file can never regenerate it.
 */
async function importCandidate(absolutePath: string, name: string): Promise<unknown> {
  try {
    return await import(pathToFileURL(absolutePath).href);
  } catch (cause) {
    throw new Error(
      `Failed to import ${LOCAL_RULE_DIRECTORY}/${name} while discovering local rules. Modules in ${LOCAL_RULE_DIRECTORY}/ that are not *.test.js must be importable without the generated plugin registry; move any dependency on it into a *.test.js file.`,
      { cause },
    );
  }
}

/** Repo-relative source path for a discovered rule id. */
export function localRuleSourcePath(id: string): string {
  return `${LOCAL_RULE_DIRECTORY}/${id}${RULE_FILE_SUFFIX}`;
}

/**
 * Import every candidate module under `<repoRoot>/eslint-rules` and keep the
 * ones carrying the ESLint rule export shape. Throws when the directory holds
 * no rule at all: an empty derivation would silently render an empty plugin and
 * an empty control set, and both would pass every downstream freshness check.
 */
export async function discoverLocalRules(
  repoRoot: string,
): Promise<readonly DiscoveredLocalRule[]> {
  const directory = join(repoRoot, LOCAL_RULE_DIRECTORY);
  const rules: DiscoveredLocalRule[] = [];
  for (const name of localRuleCandidateFiles(readdirSync(directory))) {
    const module: unknown = await importCandidate(join(directory, name), name);
    if (ruleFromModule(module) === undefined) continue;
    const id = name.slice(0, -RULE_FILE_SUFFIX.length);
    rules.push({ id, source: localRuleSourcePath(id) });
  }
  if (rules.length === 0) {
    throw new Error(
      `No ESLint rule modules found under ${LOCAL_RULE_DIRECTORY}/; refusing to render an empty local rule registration`,
    );
  }
  return rules;
}
