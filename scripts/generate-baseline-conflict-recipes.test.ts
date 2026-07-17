import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractDriverRecipe, spliceRecipeBlocks } from "./generate-baseline-conflict-recipes.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const driverSource = readFileSync(join(repoRoot, "scripts/git/baseline-merge-driver.sh"), "utf8");

describe("extractDriverRecipe", () => {
  it("pulls the lint-ratchet recipe body without the heredoc scaffolding", () => {
    const recipe = extractDriverRecipe(driverSource, "lint-ratchet");
    expect(recipe).toContain("lint-ratchet baseline conflict: $path is generated");
    expect(recipe).toContain("bun run lint:ratchet:update");
    // The BEGIN/END marker comments and the EOF terminator are scaffolding, not
    // recipe text, so they must not leak into the projected block.
    expect(recipe).not.toContain("BEGIN lint-ratchet-baseline-conflict-recipe");
    expect(recipe).not.toContain("END lint-ratchet-baseline-conflict-recipe");
    expect(recipe.split("\n")).not.toContain("EOF");
  });

  it("extracts each keyed baseline recipe with its own driver command", () => {
    expect(extractDriverRecipe(driverSource, "knip-unused-exports")).toContain(
      "bun scripts/sensor-knip-unused-exports.ts --update",
    );
    expect(extractDriverRecipe(driverSource, "near-duplicates")).toContain(
      "bun scripts/sensor-near-duplicates.ts --update",
    );
    expect(extractDriverRecipe(driverSource, "max-lines-exceptions")).toContain(
      "bun run lint:max-lines-exceptions:update",
    );
  });

  it("throws when the driver has no arm for the key", () => {
    expect(() => extractDriverRecipe(driverSource, "does-not-exist")).toThrow(/could not extract/);
  });

  it("throws instead of falling through to the next arm when the matched arm has no heredoc", () => {
    // Regression: the extraction must be bounded to the matched `case` arm. If
    // the first arm stops emitting a heredoc (e.g. switches to printf), it must
    // fail loudly rather than return the following arm's recipe.
    const driver = [
      "print_conflict_recovery() {",
      '  case "$driver_key" in',
      "    lint-ratchet)",
      "      printf 'recovery for %s\\n' \"$path\" >&2",
      "      ;;",
      "    knip-unused-exports)",
      "      cat >&2 <<EOF",
      "knip recipe body for $path",
      "EOF",
      "      ;;",
      "  esac",
      "}",
    ].join("\n");
    expect(() => extractDriverRecipe(driver, "lint-ratchet")).toThrow(/could not extract/);
  });

  it("throws when the arm opens a quoted heredoc that would not expand $path", () => {
    const driver = [
      "print_conflict_recovery() {",
      '  case "$driver_key" in',
      "    lint-ratchet)",
      "      cat >&2 <<'EOF'",
      "recipe body for $path",
      "EOF",
      "      ;;",
      "  esac",
      "}",
    ].join("\n");
    expect(() => extractDriverRecipe(driver, "lint-ratchet")).toThrow(/quoted heredoc/);
  });
});

describe("spliceRecipeBlocks", () => {
  const markerDoc = [
    "intro prose",
    "<!-- lint-ratchet-baseline-conflict-recipe:start -->",
    "old",
    "<!-- lint-ratchet-baseline-conflict-recipe:end -->",
    "<!-- knip-unused-exports-baseline-conflict-recipe:start -->",
    "old",
    "<!-- knip-unused-exports-baseline-conflict-recipe:end -->",
    "<!-- near-duplicates-baseline-conflict-recipe:start -->",
    "old",
    "<!-- near-duplicates-baseline-conflict-recipe:end -->",
    "<!-- max-lines-exceptions-baseline-conflict-recipe:start -->",
    "old",
    "<!-- max-lines-exceptions-baseline-conflict-recipe:end -->",
    "trailing prose",
  ].join("\n");

  it("substitutes the keyed baseline path for the driver $path placeholder", () => {
    const rendered = spliceRecipeBlocks(markerDoc, driverSource);
    expect(rendered).toContain("git add lint-ratchet.baseline.json");
    expect(rendered).toContain("git add sensor-knip-unused-exports.baseline.json");
    expect(rendered).toContain("git show :2:eslint-config/max-lines-exceptions.baseline.json");
    // The raw placeholder must never survive into the rendered doc.
    expect(rendered).not.toContain("$path");
    // Non-marked prose is preserved verbatim.
    expect(rendered).toContain("intro prose");
    expect(rendered).toContain("trailing prose");
  });

  it("renders each recipe inside a fenced text block between its markers", () => {
    const rendered = spliceRecipeBlocks(markerDoc, driverSource);
    expect(rendered).toContain(
      "<!-- knip-unused-exports-baseline-conflict-recipe:start -->\n```text\n",
    );
    expect(rendered).not.toContain("\nold\n");
  });

  it("throws when a marker pair is missing", () => {
    expect(() => spliceRecipeBlocks("no markers here", driverSource)).toThrow(
      /missing lint-ratchet recipe markers/,
    );
  });

  it("inserts `$&`/`$$` recipe text literally rather than as replacement patterns", () => {
    // Recipes are shell heredocs where `$` is natural. A string replacer would
    // treat `$&`/`$$`/`$n` in the block as String.replace special patterns; the
    // function replacer must insert them verbatim. --check shares this path, so a
    // string replacer would corrupt silently.
    const arms = ["lint-ratchet", "knip-unused-exports", "near-duplicates", "max-lines-exceptions"];
    const driver = [
      "print_conflict_recovery() {",
      '  case "$driver_key" in',
      ...arms.flatMap((key) => [
        `    ${key})`,
        "      cat >&2 <<EOF",
        key === "lint-ratchet"
          ? "matched span $& whole doc $$ tail-quote $' back $` group $1 for $path"
          : `${key} recipe $path`,
        "EOF",
        "      ;;",
      ]),
      "  esac",
      "}",
    ].join("\n");

    const rendered = spliceRecipeBlocks(markerDoc, driver);
    expect(rendered).toContain("matched span $& whole doc $$ tail-quote $' back $` group $1 for");
    expect(rendered).not.toContain("$path");
  });
});
