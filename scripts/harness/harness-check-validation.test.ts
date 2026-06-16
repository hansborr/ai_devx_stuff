import { describe, expect, it } from "vitest";

import {
  checkScriptParity,
  type ControlFailures,
  type ManifestCheckContext,
} from "./harness-check-validation.js";

function makeContext(scripts: ReadonlyMap<string, string>): {
  context: ManifestCheckContext;
  failures: Map<string, ControlFailures>;
} {
  const failures = new Map<string, ControlFailures>();
  return { context: { repoRoot: "/repo", scripts, failures }, failures };
}

describe("checkScriptParity", () => {
  const controlPrefix = /^(sensor|docs|harness):/u;

  it("passes when every control-prefixed script is declared or exempt", () => {
    const scripts = new Map([
      ["sensor:declared", "bun run x"],
      ["docs:exempt", "bun run y"],
      ["build", "bun run z"],
    ]);
    const { context, failures } = makeContext(scripts);

    checkScriptParity(
      controlPrefix,
      new Set(["docs:exempt"]),
      new Set(["sensor:declared"]),
      context,
    );

    expect(failures.size).toBe(0);
  });

  it("names the offending script and both remedies plus the regen command", () => {
    const scripts = new Map([["docs:lint-coverage-map:audit", "bun run scripts/x.ts"]]);
    const { context, failures } = makeContext(scripts);

    checkScriptParity(controlPrefix, new Set(), new Set(), context);

    const parityBucket = failures.get("(parity)");
    expect(parityBucket).toBeDefined();
    const message = parityBucket?.failures.join("\n") ?? "";
    // Names the script.
    expect(message).toContain('"docs:lint-coverage-map:audit"');
    // Remedy 1: declare a control entry + regenerate the docs.
    expect(message).toContain("harness.controls.json");
    expect(message).toContain("bun run docs:harness-controls");
    // Remedy 2: mark it operational via EXEMPT_SCRIPTS.
    expect(message).toContain("EXEMPT_SCRIPTS");
    expect(message).toContain("scripts/harness-check.ts");
  });
});
