import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALL_CHECKS, DEFAULT_CHECKS } from "./check-metadata.js";
import { PROTOTYPE_SUBCOMMAND_IDS } from "./prototype-subcommands.js";
import { TOP_LEVEL_SUBCOMMAND_IDS } from "./runner.js";

type HarnessControl = {
  readonly id?: unknown;
  readonly source?: unknown;
};

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "..", "..");
const HARNESS_CONTROLS_PATH = path.join(repoRoot, "harness.controls.json");

// Intentional copies, not derived lists: these are tripwires so a live registry
// change must also update harness.controls.json and this parity expectation.
const GROUPED_BY_SCOPE_CHECK_IDS = new Set<string>([
  "duplicates",
  "ghost-files",
  "comments",
  "suppressions",
]);

const OMITTED_PROTOTYPE_SUBCOMMAND_IDS = new Set<string>([
  "env-branches",
  "coverage-evidence",
  "coverage-unused-exports",
  "clone-candidates",
  "dolos-candidates",
  "semgrep-candidates",
  "ownership",
  "test-orphaning",
  "birth-size-delta",
  "class-construction",
]);

function manifestControls(): readonly HarnessControl[] {
  // type-assertion-boundary: JSON parse - narrow only the manifest field this guard needs.
  const parsed = JSON.parse(readFileSync(HARNESS_CONTROLS_PATH, "utf8")) as {
    readonly controls?: readonly HarnessControl[];
  };
  return parsed.controls ?? [];
}

function manifestControlIds(): Set<string> {
  return new Set(
    manifestControls().flatMap((control) => (typeof control.id === "string" ? [control.id] : [])),
  );
}

function manifestControlIdsMatching(
  predicate: (control: HarnessControl & { readonly id: string }) => boolean,
): Set<string> {
  return new Set(
    manifestControls().flatMap((control) => {
      if (typeof control.id !== "string") return [];
      return predicate({ ...control, id: control.id }) ? [control.id] : [];
    }),
  );
}

describe("harness controls drift:ai parity", () => {
  it("represents every live drift check as a grouped default check or dedicated control", () => {
    const expectedDedicatedControls = ALL_CHECKS.filter(
      (id) => !GROUPED_BY_SCOPE_CHECK_IDS.has(id),
    ).map((id) => `check/drift-ai-${id}`);
    const actualDedicatedControls = manifestControlIdsMatching((control) =>
      control.id.startsWith("check/drift-ai-"),
    );

    expect(GROUPED_BY_SCOPE_CHECK_IDS).toEqual(new Set(DEFAULT_CHECKS));
    expect(actualDedicatedControls).toEqual(new Set(expectedDedicatedControls));
  });

  it("represents promoted drift subcommands and explicitly omits prototype-lane advisories", () => {
    const controls = manifestControlIds();
    const expectedPromotedControls = TOP_LEVEL_SUBCOMMAND_IDS.map((id) => `drift-scope/${id}`);
    const actualPromotedControls = manifestControlIdsMatching(
      (control) =>
        control.id.startsWith("drift-scope/") &&
        typeof control.source === "string" &&
        control.source.startsWith("scripts/drift-ai/"),
    );
    expect(controls.has("drift-scope/changed")).toBe(true);
    expect(controls.has("drift-scope/current")).toBe(true);
    expect(actualPromotedControls).toEqual(new Set(expectedPromotedControls));
    expect(new Set(PROTOTYPE_SUBCOMMAND_IDS)).toEqual(OMITTED_PROTOTYPE_SUBCOMMAND_IDS);
  });
});
