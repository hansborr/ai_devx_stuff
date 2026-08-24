// @ts-check
//
// Shared real-repository lint harness for the eslint-rules config suites.
//
// Ten suites in this directory assert repository lint POLICY — which rules are
// enabled where, at what severity, with which options — rather than a rule's
// behaviour. Each one used to open by reconstructing the same block: derive
// `repoRoot` (in two different flavours), build an `ESLint` pinned to the real
// `eslint.config.js`, then redeclare the same small queries over it. That made
// any change to how the repository config is resolved — a config-file rename,
// an `ESLint` constructor option, a flat-config API move — a ten-file lockstep
// edit, where a missed file silently kept asserting against a different
// harness. This is the config half of what `rule-tester.js` did for the
// RuleTester half.
//
// This is NOT a performance change. Vitest isolates modules per suite file, so
// every suite still constructs its own `ESLint` and still pays the one-time
// ~0.9s flat-config normalization documented in
// `eslint-config-resolution-timeout.js`. The win is the single point of edit.
//
// Suite-specific queries stay in their suites: only the harness block and the
// queries that recurred across suites live here. `restricted-syntax-builder`
// is deliberately not a consumer — its `ESLint` is synthetic
// (`overrideConfigFile: true`), not the repository harness.
//
// This module is intentionally NOT a `*.test.js` file, so the eslint-rules
// vitest project (include: ["*.test.js"]) does not collect it as a suite. It
// also imports nothing from `eslint.config.js` or the generated local-plugin
// registry, so local-rule discovery (scripts/harness/local-rule-discovery.ts),
// which imports every non-test module here, stays independent of its own
// output.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

/**
 * This directory. Exported for the suites that address a file sitting NEXT to
 * them (a fixture, a snapshot): routing such a path through `repoRoot` would
 * hard-code `eslint-rules/` into a reference that a directory rename should
 * carry along untouched.
 */
export const eslintRulesDir = dirname(fileURLToPath(import.meta.url));

/** Repository root — the one canonical derivation for every config suite. */
export const repoRoot = resolve(eslintRulesDir, "..");

/**
 * `ESLint` pinned to the REAL repository flat config, so the suites verify the
 * wiring (which config objects match which files) instead of reconstructing
 * rules inline. Exported for the few suites that need the instance itself
 * (`isPathIgnored`, `lintFiles`) rather than one of the queries below.
 */
export const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, "eslint.config.js"),
});

/**
 * The resolved config for a file, unprojected — the counterpart to `configFor`
 * below, which narrows the same object down to `{ rules }`. The annotation
 * covers only `rules` because that is all any suite reads today; a suite that
 * needs `plugins` or `languageOptions` widens it here rather than casting at
 * its own call site.
 *
 * Paths may be repo-relative or absolute:
 * `resolve` returns an absolute argument unchanged, so both spellings that the
 * suites already used keep resolving identically. The path need not exist —
 * `calculateConfigForFile` resolves policy for a hypothetical path too, which
 * is how the suites pin the policy a not-yet-written file would inherit.
 *
 * @param {string} path
 * @returns {Promise<{ rules?: Record<string, unknown> }>}
 */
export async function resolvedConfigFor(path) {
  return eslint.calculateConfigForFile(resolve(repoRoot, path));
}

/**
 * The `{ rules }` projection of the resolved config: the shape the severity and
 * option queries below read, narrowed so a suite cannot accidentally assert
 * over unrelated resolved-config fields.
 *
 * @param {string} path
 * @returns {Promise<{ rules?: Record<string, unknown> }>}
 */
export async function configFor(path) {
  const config = await resolvedConfigFor(path);
  return { rules: config.rules };
}

/**
 * Resolved severity for a rule, normalizing the two shapes flat config emits:
 * a bare severity, or `[severity, ...options]`. `undefined` means the rule is
 * not configured for that file at all — distinct from `0` (explicitly off).
 *
 * @param {{ rules?: Record<string, unknown> }} config
 * @param {string} ruleId
 */
export function severityOf(config, ruleId) {
  const entry = config.rules?.[ruleId];
  if (Array.isArray(entry)) return entry[0];
  return entry;
}

/**
 * Lint a snippet AS IF it were the given file, so the resolved config for that
 * path decides which rules run. Paths may be repo-relative or absolute.
 *
 * @param {string} path
 * @param {string} code
 */
export async function lintTextFor(path, code) {
  return eslint.lintText(code, { filePath: resolve(repoRoot, path) });
}

/**
 * The messages one rule produced across every lint result — the filter that
 * turns a whole-file lint into an assertion about a single policy.
 *
 * @param {Awaited<ReturnType<typeof lintTextFor>>} results
 * @param {string} ruleId
 * @returns {import("eslint").Linter.LintMessage[]}
 */
export function messagesFor(results, ruleId) {
  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === ruleId),
  );
}
