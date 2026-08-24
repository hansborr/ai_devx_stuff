// Generates harness.controls.lint-rules.generated.json: every
// `kind: "lint-rule"` control in the harness manifest.
//
// Nothing on a lint-rule control is authored information. Identity and source
// path are the rule filename (eslint-rules/<name>.js); the enforcement command
// is whichever activation surface actually runs the rule — flat-config
// enablement, read back out of eslint.config.js by loadLocalRuleConfig, or the
// ratchet registry's `ruleId` set. Re-typing all four into the manifest is what
// let `lint/local/no-plain-error-in-trpc` keep claiming `bun run lint:ratchet`
// long after the rule was promoted to normal lint.
//
// Ownership seam: this generator emits an INCLUDE rather than rewriting the
// hand-authored manifest in place. harness.controls.json keeps every other
// control kind (including this generator's own record), the include owns lint
// rules exclusively, and scripts/harness/harness-manifest.ts joins them for
// every reader. No generator has to reformat or risk clobbering 2,800 lines of
// hand-authored controls.
//
// BOOTSTRAP ORDER: run `bun run lint:local-plugin` first. Activation discovery
// here imports eslint.config.js, which statically imports the generated plugin
// registry, so a tree whose registry is missing or stale derives the wrong
// answer (or none at all).

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { runDocGeneratorAsync } from "../lib/doc-generator.js";
import { lintRatchets } from "../lint-ratchet/lint-ratchet-config.js";
import { HARNESS_LINT_RULE_CONTROLS_FILENAME } from "./harness-manifest.js";
import { loadLocalRuleConfig } from "./local-rule-config.js";
import { type DiscoveredLocalRule, discoverLocalRules } from "./local-rule-discovery.js";

/** `bun run <script>` that refreshes the include. */
export const LINT_RULE_CONTROLS_REFRESH_COMMAND = "harness:lint-rule-controls";

/** Enforcement command for a rule enabled in flat config. */
export const NORMAL_LINT_INVOCATION = "bun run lint";
/** Enforcement command for a rule that only the ratchet runs. */
export const RATCHET_LINT_INVOCATION = "bun run lint:ratchet";

const JSON_INDENT = 2;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, HARNESS_LINT_RULE_CONTROLS_FILENAME);

export interface LintRuleControl {
  readonly id: string;
  readonly kind: "lint-rule";
  readonly ruleName: string;
  readonly source: string;
  readonly invocation: string;
}

export interface LintRuleControlInputs {
  readonly rules: readonly DiscoveredLocalRule[];
  /** `local/*` names enabled somewhere in flat config, from loadLocalRuleConfig. */
  readonly enabledRuleNames: ReadonlySet<string>;
  /** `local/*` names any lint ratchet declares as its `ruleId`. */
  readonly ratchetRuleNames: ReadonlySet<string>;
}

function invocationFor(ruleName: string, inputs: LintRuleControlInputs): string | undefined {
  // Normal lint wins when a rule is on both surfaces: it is the enforcement
  // floor, so it is the command that actually blocks a merge on the rule.
  if (inputs.enabledRuleNames.has(ruleName)) return NORMAL_LINT_INVOCATION;
  return inputs.ratchetRuleNames.has(ruleName) ? RATCHET_LINT_INVOCATION : undefined;
}

/**
 * Derive one control per discovered rule. A rule activated on neither surface
 * fails generation instead of being registered with a command that would not
 * run it — the authoring-time version of a drift check that used to fire late.
 */
export function deriveLintRuleControls(inputs: LintRuleControlInputs): readonly LintRuleControl[] {
  const controls: LintRuleControl[] = [];
  const unactivated: string[] = [];
  for (const rule of inputs.rules) {
    const ruleName = `local/${rule.id}`;
    const invocation = invocationFor(ruleName, inputs);
    if (invocation === undefined) {
      unactivated.push(ruleName);
      continue;
    }
    controls.push({
      id: `lint/${ruleName}`,
      kind: "lint-rule",
      ruleName,
      source: rule.source,
      invocation,
    });
  }
  if (unactivated.length > 0) {
    throw new Error(
      `local rule(s) activated by neither eslint.config.js nor the lint ratchet registry: ${unactivated.join(", ")}. Enable the rule in flat config, or register a ratchet for it, before regenerating.`,
    );
  }
  if (controls.length === 0) {
    throw new Error("refusing to render an empty lint-rule control set");
  }
  return controls;
}

/**
 * Render the committed include, control ids codepoint-sorted.
 *
 * Sorting happens HERE rather than being inherited from discovery, for the same
 * reason renderLocalPluginModule sorts: the committed bytes must be a pure
 * function of the rule id SET, and the two generated artifacts must agree on
 * order. Discovery sorts filenames *with* the `.js` suffix
 * (local-rule-discovery.ts), where `-` (0x2D) precedes `.` (0x2E) — so a prefix
 * pair like `no-barrel.js` / `no-barrel-strict.js` arrives here in an order the
 * plugin registry's id sort would not reproduce.
 */
export function renderLintRuleControls(controls: readonly LintRuleControl[]): string {
  const sorted = controls.toSorted((left, right) => compareByCodepoint(left.id, right.id));
  return `${JSON.stringify(
    {
      $comment:
        "Generated by scripts/harness/generate-lint-rule-controls.ts. Do not edit by hand; run `bun run harness:lint-rule-controls`. This include owns every kind=lint-rule control; harness.controls.json owns every other kind, and scripts/harness/harness-manifest.ts merges the two for every reader.",
      controls: sorted,
    },
    null,
    JSON_INDENT,
  )}\n`;
}

async function collect(): Promise<readonly LintRuleControl[]> {
  // Sequential on purpose: discovery must not race flat-config loading, which
  // pulls in the generated plugin registry the same rule files feed.
  const rules = await discoverLocalRules(repoRoot);
  const localRuleConfig = await loadLocalRuleConfig(join(repoRoot, "eslint.config.js"));
  return deriveLintRuleControls({
    rules,
    enabledRuleNames: localRuleConfig.enabledRuleNames,
    ratchetRuleNames: new Set(lintRatchets.map((ratchet) => ratchet.ruleId)),
  });
}

async function main(): Promise<void> {
  await runDocGeneratorAsync({
    outputPath,
    refreshCommand: LINT_RULE_CONTROLS_REFRESH_COMMAND,
    render: async () => {
      const controls = await collect();
      return {
        rendered: renderLintRuleControls(controls),
        wroteSuffix: ` (${String(controls.length)} lint-rule control(s))`,
      };
    },
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
