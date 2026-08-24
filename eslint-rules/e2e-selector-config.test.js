// @ts-check

import { describe, expect, it } from "vitest";

import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";
import { configFor, severityOf } from "./repo-config-harness.js";

describe("e2e selector lint config", () => {
  it(
    "keeps selector rules enabled on clean e2e files",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("e2e/auth-refresh.spec.ts");

      expect(severityOf(config, "local/e2e-prefer-role-selectors")).toBe(2);
      expect(severityOf(config, "playwright/no-nth-methods")).toBe(2);
      expect(severityOf(config, "playwright/prefer-native-locators")).toBe(2);
      expect(severityOf(config, "playwright/no-raw-locators")).toBeUndefined();
    },
  );

  // The selector debt drain (lint-followups-2026-06 leaves 03a-03f) removed
  // every debt-file override set, so formerly ratcheted files must get the
  // same unconditional error severities as born-clean files.
  for (const drainedFile of [
    "e2e/helpers/auth.setup.ts",
    "e2e/campaign-chat.spec.ts",
    "e2e/homebrew-sharing.spec.ts",
    "e2e/navigation-errors.spec.ts",
  ]) {
    it(
      `keeps selector rules at error on drained debt file ${drainedFile}`,
      { timeout: resolvedConfigTestTimeoutMs },
      async () => {
        const config = await configFor(drainedFile);

        expect(severityOf(config, "local/e2e-prefer-role-selectors")).toBe(2);
        expect(severityOf(config, "playwright/no-nth-methods")).toBe(2);
        expect(severityOf(config, "playwright/prefer-native-locators")).toBe(2);
      },
    );
  }
});
