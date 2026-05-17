// @ts-check
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
import trpcRequireOutputSchemaRule from "./trpc-require-output-schema.js";
import trpcSharedInputSchemaRule from "./trpc-shared-input-schema.js";
import trpcSharedOutputSchemaRule from "./trpc-shared-output-schema.js";

const MAX_MULTI_STEP_MESSAGE_LENGTH = 520;
const MAX_SIMPLE_MESSAGE_LENGTH = 180;
const WHY_HOW_PATTERN = /^Why: .+ How to fix: .+/u;
const ACTION_WORD_PATTERN =
  /\b(?:Add|Consume|Delegate|Link|Move|Persist|Prefer|Remove|Rename|Replace|Resolve|Restore|Rethrow|Return|Try|Use)\b/u;

const MULTI_STEP_REPAIR_PROMPTS = [
  {
    name: "concurrency-guard/noDirectWrite",
    rule: concurrencyGuardRule,
    messageId: "noDirectWrite",
  },
  {
    name: "max-lines/exceed",
    rule: maxLinesRule,
    messageId: "exceed",
  },
  {
    name: "no-broadcast-in-transaction/noBroadcastInTransaction",
    rule: noBroadcastInTransactionRule,
    messageId: "noBroadcastInTransaction",
  },
  {
    name: "no-explicit-any/noAny",
    rule: noExplicitAnyRule,
    messageId: "noAny",
  },
  {
    name: "structured-logging/noTemplate",
    rule: structuredLoggingRule,
    messageId: "noTemplate",
  },
  {
    name: "structured-logging/noConcat",
    rule: structuredLoggingRule,
    messageId: "noConcat",
  },
  {
    name: "structured-logging/noDynamic",
    rule: structuredLoggingRule,
    messageId: "noDynamic",
  },
  {
    name: "structured-logging/noConsole",
    rule: structuredLoggingRule,
    messageId: "noConsole",
  },
  {
    name: "structured-logging/noScriptLoggerImport",
    rule: structuredLoggingRule,
    messageId: "noScriptLoggerImport",
  },
  {
    name: "trpc-shared-input-schema/needsSharedInput",
    rule: trpcSharedInputSchemaRule,
    messageId: "needsSharedInput",
  },
  {
    name: "trpc-shared-output-schema/needsSharedOutput",
    rule: trpcSharedOutputSchemaRule,
    messageId: "needsSharedOutput",
  },
];

const SIMPLE_POLICY_MESSAGES = [
  {
    name: "e2e-prefer-role-selectors/preferRoleSelectors",
    rule: e2ePreferRoleSelectorsRule,
    messageId: "preferRoleSelectors",
  },
  {
    name: "no-barrel/noBarrel",
    rule: noBarrelRule,
    messageId: "noBarrel",
  },
  {
    name: "no-llm-artifacts/leftoverEditNote",
    rule: noLlmArtifactsRule,
    messageId: "leftoverEditNote",
  },
  {
    name: "no-llm-artifacts/todoNeedsReference",
    rule: noLlmArtifactsRule,
    messageId: "todoNeedsReference",
  },
  {
    name: "no-llm-artifacts/incompleteImplementation",
    rule: noLlmArtifactsRule,
    messageId: "incompleteImplementation",
  },
  {
    name: "no-swallowed-errors/swallowedError",
    rule: noSwallowedErrorsRule,
    messageId: "swallowedError",
  },
  {
    name: "no-async-array-callbacks/droppedPromise",
    rule: noAsyncArrayCallbacksRule,
    messageId: "droppedPromise",
  },
  {
    name: "no-async-array-callbacks/asyncPredicate",
    rule: noAsyncArrayCallbacksRule,
    messageId: "asyncPredicate",
  },
  {
    name: "no-async-array-callbacks/asyncReduce",
    rule: noAsyncArrayCallbacksRule,
    messageId: "asyncReduce",
  },
  {
    name: "no-async-array-callbacks/asyncMap",
    rule: noAsyncArrayCallbacksRule,
    messageId: "asyncMap",
  },
  {
    name: "socket-registry-broadcasts/noDirectEmit",
    rule: socketRegistryBroadcastsRule,
    messageId: "noDirectEmit",
  },
  {
    name: "strict-shared-schemas/needsExplicit",
    rule: strictSharedSchemasRule,
    messageId: "needsExplicit",
  },
  {
    name: "strict-trpc-input/needsStrict",
    rule: strictTrpcInputRule,
    messageId: "needsStrict",
  },
  {
    name: "test-file-location/wrongNaming",
    rule: testFileLocationRule,
    messageId: "wrongNaming",
  },
  {
    name: "test-file-location/missingTests",
    rule: testFileLocationRule,
    messageId: "missingTests",
  },
  {
    name: "trpc-require-output-schema/missingOutput",
    rule: trpcRequireOutputSchemaRule,
    messageId: "missingOutput",
  },
];

function messageFor(entry) {
  const message = entry.rule.meta.messages[entry.messageId];
  if (typeof message !== "string") {
    throw new TypeError(`${entry.name} is missing a string message`);
  }
  return message;
}

describe("local rule message guidance", () => {
  it("keeps sampled multi-step repair prompts concise and structured", () => {
    for (const entry of MULTI_STEP_REPAIR_PROMPTS) {
      const message = messageFor(entry);
      const howToFix = message.split("How to fix: ")[1] ?? "";

      expect(message, entry.name).toMatch(WHY_HOW_PATTERN);
      expect(howToFix, entry.name).toMatch(ACTION_WORD_PATTERN);
      expect(message, entry.name).not.toMatch(/\n/u);
      expect(message.length, entry.name).toBeLessThanOrEqual(MAX_MULTI_STEP_MESSAGE_LENGTH);
    }
  });

  it("allows simple policy diagnostics to stay one-line and direct", () => {
    for (const entry of SIMPLE_POLICY_MESSAGES) {
      const message = messageFor(entry);

      expect(message, entry.name).toMatch(ACTION_WORD_PATTERN);
      expect(message, entry.name).not.toMatch(/\n/u);
      expect(message.length, entry.name).toBeLessThanOrEqual(MAX_SIMPLE_MESSAGE_LENGTH);
    }
  });
});
