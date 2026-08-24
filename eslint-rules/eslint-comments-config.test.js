// @ts-check

import { describe, expect, it } from "vitest";

import { ratchetRestrictedDisableRuleIds } from "../eslint-config/ratchet-restricted-disable-rules.generated.js";
import { restrictedDisableRuleIds } from "../eslint-config/rule-groups.js";
import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";
import { configFor, lintTextFor, severityOf } from "./repo-config-harness.js";

/** @param {{ rules?: Record<string, unknown> }} config @returns {string[]} */
function restrictedDisableOptions(config) {
  const entry = config.rules?.["eslint-comments/no-restricted-disable"];
  if (!Array.isArray(entry)) return [];
  return entry.slice(1).filter((value) => typeof value === "string");
}

describe("eslint-comments restricted disable fence", () => {
  it(
    "resolves on ESLint config files and local-rule tests",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "eslint.config.js",
        "eslint-config/base-configs.js",
        "eslint-rules/security-primitives-config.test.js",
      ]) {
        const config = await configFor(file);
        const restrictedOptions = restrictedDisableOptions(config);

        expect(severityOf(config, "eslint-comments/no-restricted-disable"), file).toBe(2);
        for (const ruleId of ["no-eval", "no-implied-eval", "no-new-func"]) {
          expect(restrictedOptions, `${file} must restrict ${ruleId}`).toContain(ruleId);
        }
      }
    },
  );

  it(
    "resolves every ratcheted rule id plus the manual hard-fence rules",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/server/src/services/auth-service.ts");
      const restrictedOptions = restrictedDisableOptions(config);

      expect(severityOf(config, "eslint-comments/no-restricted-disable")).toBe(2);
      expect(restrictedOptions).toStrictEqual(restrictedDisableRuleIds);
      for (const ruleId of ratchetRestrictedDisableRuleIds) {
        expect(restrictedOptions, ruleId).toContain(ruleId);
      }
      for (const ruleId of [
        "local/concurrency-guard",
        "local/no-broadcast-in-transaction",
        "local/no-outer-client-in-transaction",
        "@typescript-eslint/no-implied-eval",
        "no-eval",
        "no-implied-eval",
        "no-new-func",
        "no-restricted-properties",
        "no-restricted-syntax",
      ]) {
        expect(restrictedOptions, ruleId).toContain(ruleId);
      }
    },
  );

  it(
    "reports inline disables for generated ratchet rule ids that normal lint also enables",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const [result] = await lintTextFor(
        "packages/server/src/services/auth-service.ts",
        [
          "// eslint-disable-next-line no-restricted-syntax -- fixture must be fenced",
          "process.exit(1);",
          "",
        ].join("\n"),
      );

      expect(
        result?.messages.some(
          (message) => message.ruleId === "eslint-comments/no-restricted-disable",
        ),
      ).toBe(true);
    },
  );

  it(
    "reports inline disables for manual hard-fence rule ids",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const [result] = await lintTextFor(
        "packages/server/src/services/auth-service.ts",
        [
          "// eslint-disable-next-line local/concurrency-guard -- fixture must be fenced",
          "export const value = 1;",
          "",
        ].join("\n"),
      );

      expect(
        result?.messages.some(
          (message) => message.ruleId === "eslint-comments/no-restricted-disable",
        ),
      ).toBe(true);
    },
  );

  it(
    "reports inline disables for the typed implied-eval fence",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const [result] = await lintTextFor(
        "packages/server/src/services/auth-service.ts",
        [
          "declare const handler: string;",
          "// eslint-disable-next-line @typescript-eslint/no-implied-eval -- fixture must be fenced",
          "globalThis.setTimeout(handler, 10);",
          "",
        ].join("\n"),
      );

      expect(
        result?.messages.some(
          (message) => message.ruleId === "eslint-comments/no-restricted-disable",
        ),
      ).toBe(true);
    },
  );

  it(
    "reports eval-family disables on config and local-rule test surfaces",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of ["eslint.config.js", "eslint-rules/security-primitives-config.test.js"]) {
        const [result] = await lintTextFor(
          file,
          [
            "// eslint-disable-next-line no-eval -- fixture must be fenced",
            'eval("2 + 2");',
            "",
          ].join("\n"),
        );

        expect(
          result?.messages.some(
            (message) => message.ruleId === "eslint-comments/no-restricted-disable",
          ),
          file,
        ).toBe(true);
      }
    },
  );
});
