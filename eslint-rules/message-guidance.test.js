// @ts-check
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import concurrencyGuardRule from "./concurrency-guard.js";
import e2ePreferRoleSelectorsRule from "./e2e-prefer-role-selectors.js";
import maxLinesRule from "./max-lines.js";
import noAsyncArrayCallbacksRule from "./no-async-array-callbacks.js";
import noBarrelRule from "./no-barrel.js";
import noBroadcastInTransactionRule from "./no-broadcast-in-transaction.js";
import noExplicitAnyRule from "./no-explicit-any.js";
import noLlmArtifactsRule from "./no-llm-artifacts.js";
import noSwallowedErrorsRule from "./no-swallowed-errors.js";
import socketRegistryBroadcastsRule from "./socket-registry-broadcasts.js";
import strictSharedSchemasRule from "./strict-shared-schemas.js";
import strictTrpcInputRule from "./strict-trpc-input.js";
import structuredLoggingRule from "./structured-logging.js";
import testFileLocationRule from "./test-file-location.js";
import typeAssertionBoundaryRule from "./type-assertion-boundary.js";
import trpcRequireOutputSchemaRule from "./trpc-require-output-schema.js";
import trpcSharedInputSchemaRule from "./trpc-shared-input-schema.js";
import trpcSharedOutputSchemaRule from "./trpc-shared-output-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_MULTI_STEP_MESSAGE_LENGTH = 520;
const MAX_SIMPLE_MESSAGE_LENGTH = 180;
const WHY_HOW_PATTERN = /^Why: .+ How to fix: .+/u;
const ACTION_WORD_PATTERN =
  /\b(?:Add|Consume|Delegate|Link|Move|Persist|Prefer|Remove|Rename|Replace|Resolve|Restore|Rethrow|Return|Try|Update|Use|rewrite)\b/u;

// keep in sync with scripts/generate-lint-guidance.ts
const ACCEPTED_CATEGORIES = new Set(["maintainability", "architecture-fitness", "behavior"]);
const ACCEPTED_REPAIR_KINDS = new Set(["autofix", "suggestion", "codemod", "manual"]);

const ALL_LOCAL_RULES = [
  { id: "concurrency-guard", rule: concurrencyGuardRule },
  { id: "e2e-prefer-role-selectors", rule: e2ePreferRoleSelectorsRule },
  { id: "max-lines", rule: maxLinesRule },
  { id: "no-async-array-callbacks", rule: noAsyncArrayCallbacksRule },
  { id: "no-barrel", rule: noBarrelRule },
  { id: "no-broadcast-in-transaction", rule: noBroadcastInTransactionRule },
  { id: "no-explicit-any", rule: noExplicitAnyRule },
  { id: "no-llm-artifacts", rule: noLlmArtifactsRule },
  { id: "no-swallowed-errors", rule: noSwallowedErrorsRule },
  { id: "socket-registry-broadcasts", rule: socketRegistryBroadcastsRule },
  { id: "strict-shared-schemas", rule: strictSharedSchemasRule },
  { id: "strict-trpc-input", rule: strictTrpcInputRule },
  { id: "structured-logging", rule: structuredLoggingRule },
  { id: "test-file-location", rule: testFileLocationRule },
  { id: "type-assertion-boundary", rule: typeAssertionBoundaryRule },
  { id: "trpc-require-output-schema", rule: trpcRequireOutputSchemaRule },
  { id: "trpc-shared-input-schema", rule: trpcSharedInputSchemaRule },
  { id: "trpc-shared-output-schema", rule: trpcSharedOutputSchemaRule },
];

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
  // Existing cause-and-fix diagnostics whose narrative wording predates the
  // Why/How convention. Rewriting them is a separate sweep tracked outside
  // PR 1's scope; keep terse rather than mechanically re-shaping.
  "no-async-array-callbacks/droppedPromise",
  "no-async-array-callbacks/asyncPredicate",
  "no-async-array-callbacks/asyncReduce",
  "no-async-array-callbacks/asyncMap",
  "no-swallowed-errors/swallowedError",
  "socket-registry-broadcasts/noDirectEmit",
  "strict-shared-schemas/needsExplicit",
  "strict-trpc-input/needsStrict",
  "trpc-require-output-schema/missingOutput",
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
      if (docs.repairKind === "codemod") {
        expect(hasRepairCommand, `${entry.id} meta.docs.repairCommand`).toBe(true);
        expect(isNonEmptyString(docs.repairCommand), `${entry.id} meta.docs.repairCommand`).toBe(
          true,
        );
      } else {
        expect(hasRepairCommand, `${entry.id} meta.docs.repairCommand`).toBe(false);
      }
    }
  });

  it("every messageId follows the Why/How-to-fix shape unless exempt", () => {
    for (const entry of ALL_LOCAL_RULES) {
      for (const [messageId, message] of messageEntriesFor(entry)) {
        const context = `${entry.id}/${messageId}`;

        expect(typeof message, context).toBe("string");
        if (typeof message !== "string") continue;

        if (EXEMPT_MESSAGE_IDS.has(context)) {
          expect(isNonEmptyString(message), context).toBe(true);
          expect(message.length, context).toBeLessThanOrEqual(MAX_SIMPLE_MESSAGE_LENGTH);
          continue;
        }

        const howToFix = message.split("How to fix: ")[1] ?? "";

        expect(message, context).toMatch(WHY_HOW_PATTERN);
        expect(howToFix, context).toMatch(ACTION_WORD_PATTERN);
        expect(message, context).not.toMatch(/\n/u);
        expect(message.length, context).toBeLessThanOrEqual(MAX_MULTI_STEP_MESSAGE_LENGTH);
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
