// Renders the committed command-policy fragment `scripts/ai-hooks/policy.sh`
// sources, and freshness-checks the Claude-native `permissions.deny` array the
// same rules project into.
//
// `bun run harness:command-policy` writes; `--check` (aliased
// `harness:command-policy:check`, which `harness:check` runs through the
// record's generatedSurface facet) compares. Both modes validate the native
// deny projection and every shell function named by a rule before rendering.
// Those bodies live across the command-policy shell module set -- the
// `policy.sh` facade plus the bounded modules it sources -- so the scan covers
// all of them; the manifest schema owns rule-structure validation and the
// freshness check owns the committed fragment bytes.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runDocGenerator } from "../lib/doc-generator.js";
import {
  collectNativeDenyParityFailures,
  renderCommandPolicyFragment,
} from "./command-policy-projection.js";
import { type CommandPolicyRule, loadCommandPolicy } from "./command-policy-schema.js";
import { loadTypedHarnessManifest } from "./harness-manifest-loader.js";
import {
  AI_HOOKS_COMMAND_POLICY_SHELL_PATHS,
  CLAUDE_SETTINGS_PATH,
  GENERATED_COMMAND_POLICY_PATH,
} from "./harness-paths.js";

const REFRESH_COMMAND = "harness:command-policy";
const SHELL_FUNCTION_DEFINITION_PATTERN = /^([a-z_][a-z0-9_]*)\(\)[ \t]*\{/gmu;

const COMMAND_POLICY_SHELL_LABEL = AI_HOOKS_COMMAND_POLICY_SHELL_PATHS.join(", ");

/**
 * Every manifest-named shell function that the command-policy shell module set
 * must define. The bodies live in the facade or in one of the bounded modules
 * it sources; a name defined in none of them is the failure this reports.
 */
export function collectCommandPolicyShellFailures(
  rules: readonly CommandPolicyRule[],
  shellModuleTexts: readonly string[],
): readonly string[] {
  const definitions = new Set<string>();
  const failures: string[] = [];
  for (const shellModuleText of shellModuleTexts) {
    for (const match of shellModuleText.matchAll(SHELL_FUNCTION_DEFINITION_PATTERN)) {
      const functionName = match[1];
      if (functionName !== undefined) definitions.add(functionName);
    }
  }
  for (const rule of rules) {
    if (rule.haystackTransform !== undefined && !definitions.has(rule.haystackTransform)) {
      failures.push(
        `${rule.id} haystack transform ${rule.haystackTransform} is not defined in ${COMMAND_POLICY_SHELL_LABEL}`,
      );
    }
    for (const matcher of rule.matchers) {
      if (matcher.kind === "predicate" && !definitions.has(matcher.predicate)) {
        failures.push(
          `${rule.id} predicate ${matcher.predicate} is not defined in ${COMMAND_POLICY_SHELL_LABEL}`,
        );
      }
    }
  }
  return failures;
}

function render(
  repoRoot: string,
): { readonly rendered: string; readonly wroteSuffix: string } | undefined {
  const manifest = loadTypedHarnessManifest(repoRoot);
  const rules = loadCommandPolicy(manifest.commandPolicy);
  const failures = [
    ...collectNativeDenyParityFailures({
      rules,
      settingsJsonText: readFileSync(join(repoRoot, CLAUDE_SETTINGS_PATH), "utf8"),
      settingsPath: CLAUDE_SETTINGS_PATH,
      refreshCommand: REFRESH_COMMAND,
    }),
    ...collectCommandPolicyShellFailures(
      rules,
      AI_HOOKS_COMMAND_POLICY_SHELL_PATHS.map((shellPath) =>
        readFileSync(join(repoRoot, shellPath), "utf8"),
      ),
    ),
  ];
  if (failures.length > 0) {
    // Reported here and short-circuited (the documented runDocGenerator
    // contract) so a drifted rule set never renders a fragment that looks
    // fresh: the hooks source these bytes on every agent Bash call.
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
    return undefined;
  }
  return {
    rendered: renderCommandPolicyFragment(rules),
    wroteSuffix: ` (${String(rules.length)} command policy rule(s))`,
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  runDocGenerator({
    outputPath: join(repoRoot, GENERATED_COMMAND_POLICY_PATH),
    refreshCommand: REFRESH_COMMAND,
    render: () => render(repoRoot),
  });
}
