import { describe, expect, it } from "vitest";

import type { CheckRunInput } from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import { currentDetectorScope } from "./duplicates.test-helper.js";
import { duplicatesCheck } from "./duplicates-check.js";
import { buildSourceExtensions } from "./scope.js";

function makeDuplicatesPluginInput(options: {
  readonly argv?: readonly string[];
  readonly binExists?: (candidate: string) => boolean;
  readonly warnStderr?: (message: string) => void;
}): CheckRunInput {
  return {
    detectorScope: currentDetectorScope([]),
    inventoryByDir: null,
    repoRoot: "/repo/target",
    suppressionDiffRef: null,
    config: DEFAULT_DRIFT_AI_CONFIG,
    roots: [],
    sourceExtensions: buildSourceExtensions([]),
    warnStderr: options.warnStderr ?? (() => undefined),
    env: {
      repoRoot: "/repo/target",
      overrides: {
        ...(options.binExists === undefined ? {} : { binExists: options.binExists }),
      },
      cli: parseArgs(["--scope", "current", "--check", "duplicates", ...(options.argv ?? [])]),
      warnStderr: options.warnStderr ?? (() => undefined),
    },
  };
}

describe("duplicates check service wiring", () => {
  it("reports the missing --jscpd-bin path instead of the checkout/target fallback", () => {
    const warnings: string[] = [];
    const outcome = duplicatesCheck.runWithSelectedConfig(
      makeDuplicatesPluginInput({
        argv: ["--jscpd-bin", "/bad/path/jscpd"],
        binExists: () => false,
        warnStderr: (message) => warnings.push(message),
      }),
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") throw new Error("expected duplicates to skip");
    expect(outcome.reason).toContain("searched /bad/path/jscpd");
    expect(outcome.reason).toContain("Pass a valid --jscpd-bin path");
    expect(outcome.reason).not.toContain("tools checkout or the target repo");
    expect(warnings).toEqual([outcome.reason]);
  });
});
