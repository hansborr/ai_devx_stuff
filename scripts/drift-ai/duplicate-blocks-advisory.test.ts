import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseDuplicatesReport } from "./duplicates.js";
import { defaultJscpdRunner } from "./duplicates-runner.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_ROOT = "scripts/drift-ai/fixtures/near-duplicates-v2";

describe("calibrated jscpd block advisory", () => {
  it("detects same-file and cross-file eight-statement blocks without threshold gating", () => {
    const runner = defaultJscpdRunner({
      analyzedRepoRoot: REPO_ROOT,
      jscpdBin: path.join(REPO_ROOT, "node_modules/.bin/jscpd"),
    });
    const result = runner({
      scopePath: FIXTURE_ROOT,
      minLines: 8,
      minTokens: 60,
      mode: "mild",
      ignoreGlobs: [],
    });
    if (!result.ok) throw new Error(result.error);
    const parsed = parseDuplicatesReport(result.reportJson);
    if (!parsed.ok) throw new Error(parsed.error);

    const pairs = parsed.report.duplicates.map((clone) => [
      clone.firstFile.name,
      clone.secondFile.name,
    ]);
    expect(
      pairs.some(([left, right]) => left === right && left?.endsWith("block-same-file.ts")),
    ).toBe(true);
    expect(
      pairs.some(([left, right]) => {
        const names = [left ?? "", right ?? ""].sort();
        return (
          names[0]?.endsWith("block-cross-a.ts") === true &&
          names[1]?.endsWith("block-cross-b.ts") === true
        );
      }),
    ).toBe(true);
    expect(pairs.flat().some((file) => file.endsWith("block-noise.ts"))).toBe(false);
  });
});
