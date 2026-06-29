// @ts-check
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALL_LOCAL_RULES } from "./all-local-rules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_MULTI_STEP_MESSAGE_LENGTH = 520;
const MAX_SIMPLE_MESSAGE_LENGTH = 180;
const WHY_HOW_PATTERN = /^Why: .+ How to fix: .+/u;
// This allowlist encodes repair intent, not just grammar. Delete, Shrink, and
// Suppress are deliberately omitted because they tend to steer low-quality fixes.
const ACTION_WORD_PATTERN =
  /\b(?:Add|Consume|Delegate|Extract|Link|Move|Persist|Prefer|Remove|Rename|Replace|Resolve|Restore|Rethrow|Return|Split|Try|Update|Use|rewrite)\b/u;

// keep in sync with scripts/generate-lint-guidance.ts
const ACCEPTED_CATEGORIES = new Set(["maintainability", "architecture-fitness", "behavior"]);
const ACCEPTED_REPAIR_KINDS = new Set(["autofix", "suggestion", "codemod", "manual"]);

// Diagnostics where a single-clause policy reminder is the right shape; padding
// to Why/How would dilute the signal. Group by why-it-stays-terse, not by rule.
const EXEMPT_MESSAGE_IDS = new Set([
  // One-line policy reminders — the diagnostic IS the rule.
  "e2e-prefer-role-selectors/preferRoleSelectors",
  "no-llm-artifacts/leftoverEditNote",
  "no-llm-artifacts/todoNeedsReference",
  "no-llm-artifacts/incompleteImplementation",
  "test-file-location/wrongNaming",
  "test-file-location/missingTests",
  // Repair is the codemod command; prose would just restate it.
  "no-barrel/noBarrel",
]);

const RULE_BY_ID = new Map(ALL_LOCAL_RULES.map((entry) => [entry.id, entry.rule]));

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function messageEntriesFor(entry) {
  const messages = entry.rule.meta?.messages;
  expect(isObject(messages), `${entry.id} meta.messages`).toBe(true);
  if (!isObject(messages)) return [];
  return Object.entries(messages);
}

function unsupportedValues(field, acceptedValues) {
  const unsupported = new Set();
  for (const entry of ALL_LOCAL_RULES) {
    const value = entry.rule.meta?.docs?.[field];
    if (typeof value === "string" && !acceptedValues.has(value)) {
      unsupported.add(value);
    }
  }
  return [...unsupported].sort();
}

describe("local rule message guidance", () => {
  it("declares the full meta.docs contract", () => {
    for (const entry of ALL_LOCAL_RULES) {
      const docs = entry.rule.meta?.docs;
      expect(isObject(docs), `${entry.id} meta.docs`).toBe(true);
      if (!isObject(docs)) continue;

      expect(isNonEmptyString(docs.description), `${entry.id} meta.docs.description`).toBe(true);
      expect(isNonEmptyString(docs.principle), `${entry.id} meta.docs.principle`).toBe(true);
      expect(ACCEPTED_CATEGORIES.has(docs.category), `${entry.id} meta.docs.category`).toBe(true);

      const pairedGuide = docs.pairedGuide;
      const pairedGuideExists =
        pairedGuide === "none" ||
        (isNonEmptyString(pairedGuide) && existsSync(path.resolve(__dirname, "..", pairedGuide)));
      expect(pairedGuideExists, `${entry.id} meta.docs.pairedGuide`).toBe(true);

      expect(ACCEPTED_REPAIR_KINDS.has(docs.repairKind), `${entry.id} meta.docs.repairKind`).toBe(
        true,
      );

      const hasRepairCommand = Object.hasOwn(docs, "repairCommand");
      const isCodemod = docs.repairKind === "codemod";
      expect(hasRepairCommand, `${entry.id} meta.docs.repairCommand`).toBe(isCodemod);
      expect(
        !isCodemod || isNonEmptyString(docs.repairCommand),
        `${entry.id} meta.docs.repairCommand`,
      ).toBe(true);
    }
  });

  it("every messageId follows the Why/How-to-fix shape unless exempt", () => {
    for (const entry of ALL_LOCAL_RULES) {
      for (const [messageId, message] of messageEntriesFor(entry)) {
        const context = `${entry.id}/${messageId}`;

        expect(typeof message, context).toBe("string");
        if (typeof message !== "string") continue;

        const isExempt = EXEMPT_MESSAGE_IDS.has(context);
        const maxLen = isExempt ? MAX_SIMPLE_MESSAGE_LENGTH : MAX_MULTI_STEP_MESSAGE_LENGTH;

        expect(isNonEmptyString(message), context).toBe(true);
        expect(message.length, context).toBeLessThanOrEqual(maxLen);

        const howToFix = message.split("How to fix: ")[1] ?? "";
        expect(isExempt || WHY_HOW_PATTERN.test(message), `${context} Why/How`).toBe(true);
        expect(isExempt || ACTION_WORD_PATTERN.test(howToFix), `${context} action`).toBe(true);
        expect(isExempt || !/\n/u.test(message), `${context} newline`).toBe(true);
      }
    }
  });

  it("only uses categories/repairKinds the generator accepts", () => {
    const unsupportedCategories = unsupportedValues("category", ACCEPTED_CATEGORIES);
    const unsupportedRepairKinds = unsupportedValues("repairKind", ACCEPTED_REPAIR_KINDS);

    expect(
      unsupportedCategories,
      `unsupported categories: ${unsupportedCategories.join(", ") || "(none)"}`,
    ).toEqual([]);
    expect(
      unsupportedRepairKinds,
      `unsupported repairKinds: ${unsupportedRepairKinds.join(", ") || "(none)"}`,
    ).toEqual([]);
  });

  it("EXEMPT_MESSAGE_IDS only references real messages", () => {
    for (const exemptId of EXEMPT_MESSAGE_IDS) {
      const separatorIndex = exemptId.indexOf("/");
      const ruleId = exemptId.slice(0, separatorIndex);
      const messageId = exemptId.slice(separatorIndex + 1);
      const rule = RULE_BY_ID.get(ruleId);

      expect(rule, `${exemptId} rule`).toBeDefined();
      expect(isObject(rule?.meta?.messages), `${exemptId} meta.messages`).toBe(true);
      expect(Object.hasOwn(rule?.meta?.messages ?? {}, messageId), `${exemptId} messageId`).toBe(
        true,
      );
    }
  });
});
