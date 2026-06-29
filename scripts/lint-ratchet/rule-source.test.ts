import { describe, expect, it } from "vitest";

import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import { localRuleName, thirdPartySupportFor } from "./rule-source.js";

describe("localRuleName", () => {
  it("strips the local namespace from local rule ids", () => {
    expect(localRuleName("local/type-assertion-boundary")).toBe("type-assertion-boundary");
  });

  it("throws when the rule id does not use the local namespace", () => {
    expect(() => localRuleName("vitest/expect-expect")).toThrow(/must start with local\//u);
  });
});

describe("thirdPartySupportFor", () => {
  it("throws when the third-party plugin namespace is not allowlisted", () => {
    const ratchet = {
      id: "ratchet/not-allowlisted",
      ruleId: "not-allowlisted/example-rule",
      source: { kind: "third-party", pluginModule: "eslint-plugin-not-allowlisted" },
      parserProfile: "minimal-ts",
      files: ["scripts/**/*.ts"],
      ignores: [],
      ruleOptions: [],
      mode: "no-new",
      target: 0,
      metric: "message-count",
      repairKind: "manual",
      principle: "Exercise the lint-ratchet third-party allowlist miss branch.",
    } satisfies LintRatchetConfig;

    expect(() => thirdPartySupportFor(ratchet)).toThrow(/is not allowlisted/u);
  });
});
