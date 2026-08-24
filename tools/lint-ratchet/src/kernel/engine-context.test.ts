import { describe, expect, it } from "vitest";

import type { LintRatchetEngineBinding } from "./engine-context.js";
import {
  cacheRootFor,
  configRootFor,
  DEFAULT_CACHE_DIRECTORY,
  DEFAULT_LOCAL_RULES_DIRECTORY,
  localRulesRootFor,
} from "./engine-context.js";

const binding: LintRatchetEngineBinding = {
  repoRoot: "/repo",
  thirdPartyPluginAllowlist: [],
};

describe("engine layout bindings", () => {
  it("resolves the existing local-rule and cache layout by default", () => {
    expect(DEFAULT_LOCAL_RULES_DIRECTORY).toBe("eslint-rules");
    expect(DEFAULT_CACHE_DIRECTORY).toBe("node_modules/.cache/eslint-ratchet");
    expect(localRulesRootFor(binding)).toBe("/repo/eslint-rules");
    expect(cacheRootFor(binding)).toBe("/repo/node_modules/.cache/eslint-ratchet");
    expect(configRootFor(binding)).toBe("/repo/node_modules/.cache/eslint-ratchet/configs");
  });

  it("resolves adopter-provided directories beneath the repository root", () => {
    const overridden: LintRatchetEngineBinding = {
      ...binding,
      localRulesDirectory: "build/lint-rules",
      cacheDirectory: ".cache/custom-ratchet",
    };

    expect(localRulesRootFor(overridden)).toBe("/repo/build/lint-rules");
    expect(cacheRootFor(overridden)).toBe("/repo/.cache/custom-ratchet");
    expect(configRootFor(overridden)).toBe("/repo/.cache/custom-ratchet/configs");
  });
});
