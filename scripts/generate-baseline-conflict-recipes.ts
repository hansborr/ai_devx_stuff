// Renders the per-baseline merge-conflict recovery recipes into the merge
// runbook from their live authorities: the package renderer for lint-ratchet,
// and the `print_conflict_recovery` case blocks in
// scripts/git/baseline-merge-driver.sh for Musi's other three families. This
// generator projects them into docs/guides/lint-ratchet-merges.md between
// per-baseline markers instead of the doc re-wording each recipe by hand.
// `--check` fails on drift from either implementation authority.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderLintRatchetConflictRecovery } from "@musi/lint-ratchet/git-rail/conflict-recovery.js";

import { runDocGenerator } from "./lib/doc-generator.js";
import { musiLintRatchetWorkflowVocabulary } from "./lint-ratchet/workflow-vocabulary.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const driverPath = join(repoRoot, "scripts/git/baseline-merge-driver.sh");
const outputPath = join(repoRoot, "docs/guides/lint-ratchet-merges.md");

// Keyed by baseline: each driver key maps to the committed baseline path the
// driver would print via its `$path` placeholder. This map is the single place
// the doc/driver pairing is declared; adding a baseline driver means adding one
// entry here plus its marker pair in the runbook.
export const BASELINE_PATH_BY_DRIVER_KEY: Readonly<Record<string, string>> = {
  "lint-ratchet": "lint-ratchet.baseline.json",
  "knip-unused-exports": "sensor-knip-unused-exports.baseline.json",
  "near-duplicates": "sensor-near-duplicates.baseline.json",
  "max-lines-exceptions": "eslint-config/max-lines-exceptions.baseline.json",
};

const HEREDOC_START = "cat >&2 <<EOF";
const HEREDOC_END = "EOF";

// A quoted heredoc opener (`<<'EOF'` / `<<"EOF"`, with or without `-`) suppresses
// shell expansion, so the driver's `$path` would print literally rather than as
// the baseline filename this generator substitutes. Detecting it lets the
// extractor reject that form loudly instead of projecting a broken recipe.
const QUOTED_HEREDOC_OPENER = /<<-?\s*['"]/u;

const ARM_TERMINATORS = new Set([";;", "esac", "}"]);

/**
 * Collects the lines of one `case` arm inside `print_conflict_recovery` — from
 * the `<key>)` label up to the arm's `;;` terminator (or the `esac`/function
 * close) — or `undefined` when no such arm exists. Bounding to the arm keeps the
 * heredoc scan from falling through into the next baseline's arm.
 */
function collectArmLines(driverSource: string, driverKey: string): string[] | undefined {
  let insideFunction = false;
  let insideArm = false;
  const arm: string[] = [];
  for (const rawLine of driverSource.split("\n")) {
    const trimmed = rawLine.trim();
    if (!insideFunction) {
      if (trimmed.startsWith("print_conflict_recovery()")) insideFunction = true;
      continue;
    }
    if (!insideArm) {
      if (trimmed === `${driverKey})`) insideArm = true;
      continue;
    }
    if (ARM_TERMINATORS.has(trimmed)) return arm;
    arm.push(rawLine);
  }
  return insideArm ? arm : undefined;
}

/** Returns the unquoted `cat >&2 <<EOF` heredoc body from one arm's lines. */
function heredocBody(armLines: readonly string[], driverKey: string): string {
  let insideHeredoc = false;
  const body: string[] = [];
  for (const rawLine of armLines) {
    const trimmed = rawLine.trim();
    if (insideHeredoc) {
      if (rawLine === HEREDOC_END) return body.join("\n");
      body.push(rawLine);
      continue;
    }
    if (trimmed === HEREDOC_START) {
      insideHeredoc = true;
      continue;
    }
    if (trimmed.startsWith("cat") && QUOTED_HEREDOC_OPENER.test(trimmed)) {
      throw new Error(
        `the ${driverKey} arm uses a quoted heredoc; only the unquoted \`${HEREDOC_START}\` form supports $path substitution`,
      );
    }
  }
  throw new Error(`could not extract the ${driverKey} recovery recipe from ${driverPath}`);
}

/**
 * Extracts one driver key's recovery recipe from the driver's
 * `print_conflict_recovery` function: the body of that key's `case` arm heredoc,
 * verbatim, before `$path` substitution.
 *
 * An arm that no longer opens an unquoted `cat >&2 <<EOF` heredoc throws instead
 * of silently projecting the wrong recipe, and a quoted heredoc opener throws
 * explicitly because `$path` would not expand. Either way a driver refactor fails
 * loudly.
 */
export function extractDriverRecipe(driverSource: string, driverKey: string): string {
  const arm = collectArmLines(driverSource, driverKey);
  if (arm === undefined) {
    throw new Error(
      `could not extract the ${driverKey} recovery recipe: no matching arm in ${driverPath}`,
    );
  }
  return heredocBody(arm, driverKey);
}

function renderRecipeBlock(driverKey: string, recipe: string): string {
  return [
    `<!-- ${driverKey}-baseline-conflict-recipe:start -->`,
    "```text",
    recipe,
    "```",
    `<!-- ${driverKey}-baseline-conflict-recipe:end -->`,
  ].join("\n");
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splices each driver recipe into its marker pair in the runbook, substituting
 * the driver's `$path` placeholder for the keyed baseline path. Non-marked prose
 * is preserved exactly, so the generator only owns the recipe blocks.
 */
export function spliceRecipeBlocks(currentDoc: string, driverSource: string): string {
  let rendered = currentDoc;
  for (const [driverKey, baselinePath] of Object.entries(BASELINE_PATH_BY_DRIVER_KEY)) {
    const recipe =
      driverKey === "lint-ratchet"
        ? renderLintRatchetConflictRecovery(baselinePath, musiLintRatchetWorkflowVocabulary)
        : extractDriverRecipe(driverSource, driverKey).replaceAll("$path", baselinePath);
    const block = renderRecipeBlock(driverKey, recipe);
    const startMarker = `<!-- ${driverKey}-baseline-conflict-recipe:start -->`;
    const endMarker = `<!-- ${driverKey}-baseline-conflict-recipe:end -->`;
    const markerPattern = new RegExp(
      `${escapeForRegExp(startMarker)}[\\s\\S]*?${escapeForRegExp(endMarker)}`,
    );
    if (!markerPattern.test(rendered)) {
      throw new Error(`missing ${driverKey} recipe markers in ${outputPath}`);
    }
    // Function replacer: the recipe is a shell heredoc where `$` is natural, so a
    // string replacement would let `$&`/`$$`/`$n`/`` $` ``/`$'` be interpreted by
    // String.replace instead of inserted literally — and the --check guard shares
    // this substitution, so it would not catch the corruption.
    rendered = rendered.replace(markerPattern, () => block);
  }
  return rendered;
}

if (import.meta.main) {
  runDocGenerator({
    outputPath,
    refreshCommand: "docs:baseline-conflict-recipes",
    render: () => ({
      rendered: spliceRecipeBlocks(
        readFileSync(outputPath, "utf8"),
        readFileSync(driverPath, "utf8"),
      ),
    }),
  });
}
