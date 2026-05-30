import { describe, expect, it } from "vitest";

import {
  type CheckOutcome,
  type CheckRunContext,
  type CheckRunInput,
  defineCheckPlugin,
} from "./check-plugin.js";
import { parseArgs } from "./cli-args.js";
import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import { buildSourceExtensions } from "./scope.js";

type EmptyConfig = Record<string, never>;
type EmptyServices = Record<string, never>;

function makeCtx(): CheckRunInput {
  return {
    detectorScope: { scopeMode: "current", files: [] },
    inventoryByDir: null,
    repoRoot: "/repo/target",
    suppressionDiffRef: null,
    config: DEFAULT_DRIFT_AI_CONFIG,
    roots: [],
    sourceExtensions: buildSourceExtensions([]),
    warnStderr: () => undefined,
    env: {
      repoRoot: "/repo/target",
      overrides: {},
      cli: parseArgs(["--scope", "current"]),
    },
  };
}

function defineTestPlugin(
  overrides: Partial<{
    resolveServices: (env: CheckRunInput["env"]) => EmptyServices;
    preflight: (ctx: CheckRunContext<EmptyServices>, config: EmptyConfig) => string | undefined;
    run: (ctx: CheckRunContext<EmptyServices>, config: EmptyConfig) => CheckOutcome;
  }> = {},
) {
  return defineCheckPlugin<EmptyConfig, EmptyServices, "comments">({
    id: "comments",
    usage: "comments",
    defaultConfig: {},
    parseConfig: () => ({}),
    selectConfig: () => ({}),
    resolveServices: overrides.resolveServices ?? (() => ({})),
    ...(overrides.preflight === undefined ? {} : { preflight: overrides.preflight }),
    run: overrides.run ?? (() => ({ status: "ran", findings: [] })),
  });
}

describe("defineCheckPlugin.runWithSelectedConfig", () => {
  it("propagates unexpected run exceptions instead of masking them as a skip", () => {
    const plugin = defineTestPlugin({
      run: () => {
        throw new Error("detector bug");
      },
    });
    // A thrown error is an unexpected detector bug, not an expected absence: it
    // must surface, not be swallowed into a `skipped` outcome.
    expect(() => plugin.runWithSelectedConfig(makeCtx())).toThrow("detector bug");
  });

  it("returns the run outcome when run succeeds", () => {
    const plugin = defineTestPlugin({
      run: () => ({
        status: "ran",
        findings: [{ check: "comments", file: "src/a.ts", message: "flagged" }],
      }),
    });
    const outcome = plugin.runWithSelectedConfig(makeCtx());
    expect(outcome.status).toBe("ran");
    if (outcome.status === "ran") expect(outcome.findings).toHaveLength(1);
  });

  it("still honors preflight skips without invoking run", () => {
    let ran = false;
    const plugin = defineTestPlugin({
      preflight: () => "preflight said skip",
      run: () => {
        ran = true;
        return { status: "ran", findings: [] };
      },
    });
    const outcome = plugin.runWithSelectedConfig(makeCtx());
    expect(outcome.status).toBe("skipped");
    if (outcome.status === "skipped") expect(outcome.reason).toBe("preflight said skip");
    expect(ran).toBe(false);
  });

  it("resolves services only when the check runs (deferred until dispatch)", () => {
    let resolveCount = 0;
    const plugin = defineTestPlugin({
      resolveServices: () => {
        resolveCount += 1;
        return {};
      },
    });
    // Holding the plugin does not resolve services; only dispatching does. This is
    // why an unselected check (never dispatched by buildReport) pays nothing.
    expect(resolveCount).toBe(0);
    plugin.runWithSelectedConfig(makeCtx());
    expect(resolveCount).toBe(1);
  });
});
