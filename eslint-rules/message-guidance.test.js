// @ts-check
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Linter } from "eslint";
import ts from "typescript";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

import { localPlugin } from "../eslint-config/local-plugin.generated.js";
import { LINT_AGENT_GUIDANCE_OVERLAYS } from "../scripts/lint-agent-guidance.js";
import noExplicitAny from "./no-explicit-any.js";
import typeAssertionBoundary from "./type-assertion-boundary.js";

// Derived from the generated registry rather than the rule files on disk, so
// this meta-contract suite always checks the rule set lint actually runs.
// Completeness of that registry versus the filesystem is owned by
// scripts/harness/generate-local-plugin.ts and its freshness gate.
const ALL_LOCAL_RULES = Object.entries(localPlugin.rules).map(([id, rule]) => ({ id, rule }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_ESLINT_RULES_GUIDE = readFileSync(
  path.resolve(__dirname, "../docs/guides/local-eslint-rules.md"),
  "utf8",
);
const MAX_MULTI_STEP_MESSAGE_LENGTH = 520;
const MAX_SIMPLE_MESSAGE_LENGTH = 180;
const MAX_RULES_PER_PAIRED_GUIDE_WITHOUT_ALLOWLIST = 3;
const WHY_HOW_PATTERN = /^Why: .+ How to fix: .+/u;
const INLINE_GUIDE_POINTER_PATTERN = /\bSee (?<path>(?:docs\/[A-Za-z0-9_./-]+|DESIGN)\.md)\b/giu;
// This allowlist encodes repair intent, not just grammar. Delete, Shrink, and
// Suppress are deliberately omitted because they tend to steer low-quality fixes.
const ACTION_WORD_PATTERN =
  /\b(?:Add|Consume|Delegate|Extract|Link|Move|Persist|Prefer|Remove|Rename|Replace|Resolve|Restore|Rethrow|Return|Split|Try|Update|Use|rewrite)\b/u;
const GAMING_REPAIR_PATTERN = /\b(?:disable|ignore|suppress)\b/iu;
const BEFORE_AFTER_OVERLAY_RULE_IDS = new Set([
  "complexity",
  "max-depth",
  "max-lines-per-function",
  "max-params",
]);

const STRUCTURAL_EXAMPLE_RULE_CONFIGS = new Map([
  ["complexity", ["error", { max: 10 }]],
  ["max-depth", ["error", { max: 3 }]],
  ["max-lines-per-function", ["error", { max: 100, skipBlankLines: true, skipComments: true }]],
  ["max-params", ["error", { max: 4 }]],
]);

function typeEscapeFixtureSource(snippet) {
  return [
    "interface CampaignSummary { id: string }",
    "declare const input: CampaignSummary;",
    "declare const campaignSummarySchema: { parse(value: unknown): CampaignSummary };",
    snippet,
  ].join("\n");
}

const TYPE_ESCAPE_FIX_FIXTURES = [
  {
    context: "no-explicit-any/noAny unknown repair",
    before: typeEscapeFixtureSource("const payload: any = input;"),
    after: typeEscapeFixtureSource("const payload: unknown = input;"),
    expectedBefore: ["local/no-explicit-any"],
  },
  {
    context: "no-explicit-any/noAny shared type repair",
    before: typeEscapeFixtureSource("const payload: any = input;"),
    after: typeEscapeFixtureSource("const payload: CampaignSummary = input;"),
    expectedBefore: ["local/no-explicit-any"],
  },
  {
    context: "no-explicit-any/noAny local type repair",
    before: typeEscapeFixtureSource("const payload: any = input;"),
    after: typeEscapeFixtureSource("const payload: { id: string } = input;"),
    expectedBefore: ["local/no-explicit-any"],
  },
  {
    context: "no-explicit-any/noAny justified boundary repair",
    before: typeEscapeFixtureSource("const payload: any = input;"),
    after: typeEscapeFixtureSource(
      [
        "// eslint-disable-next-line local/no-explicit-any -- framework callback payload is intentionally untyped",
        "const payload: any = input;",
      ].join("\n"),
    ),
    expectedBefore: ["local/no-explicit-any"],
  },
  {
    context: "type-assertion-boundary/missingBoundary typed-source repair",
    before: typeEscapeFixtureSource("const payload = input as CampaignSummary;"),
    after: typeEscapeFixtureSource("const payload = campaignSummarySchema.parse(input);"),
    expectedBefore: ["local/type-assertion-boundary"],
  },
  {
    context: "type-assertion-boundary/missingBoundary marker repair",
    before: typeEscapeFixtureSource("const payload = input as CampaignSummary;"),
    after: typeEscapeFixtureSource(
      "const payload = input as CampaignSummary; // type-assertion-boundary: framework - callback input is validated by the framework schema",
    ),
    expectedBefore: ["local/type-assertion-boundary"],
  },
  {
    context: "type-assertion-boundary/invalidCategory marker repair",
    before: typeEscapeFixtureSource(
      "const payload = input as CampaignSummary; // type-assertion-boundary: convenience - callback input",
    ),
    after: typeEscapeFixtureSource(
      "const payload = input as CampaignSummary; // type-assertion-boundary: framework - callback input is validated by the framework schema",
    ),
    expectedBefore: ["local/type-assertion-boundary"],
  },
  {
    context: "type-assertion-boundary/emptyReason marker repair",
    before: typeEscapeFixtureSource(
      "const payload = input as CampaignSummary; // type-assertion-boundary: framework -",
    ),
    after: typeEscapeFixtureSource(
      "const payload = input as CampaignSummary; // type-assertion-boundary: framework - callback input is validated by the framework schema",
    ),
    expectedBefore: ["local/type-assertion-boundary"],
  },
];

const TYPE_ESCAPE_CLUSTER_CONFIG = [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: {
      local: {
        rules: {
          "no-explicit-any": noExplicitAny,
          "type-assertion-boundary": typeAssertionBoundary,
        },
      },
    },
    rules: {
      "local/no-explicit-any": "error",
      "local/type-assertion-boundary": "error",
    },
  },
];

function standaloneCompileDiagnostics(source, filename) {
  const options = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (requestedFilename, languageVersion, onError, shouldCreateNewSourceFile) =>
    requestedFilename === filename
      ? ts.createSourceFile(filename, source, languageVersion, true)
      : originalGetSourceFile(
          requestedFilename,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        );
  const program = ts.createProgram({ rootNames: [filename], options, host });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === filename)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

// keep in sync with scripts/generate-lint-guidance.ts
const ACCEPTED_CATEGORIES = new Set(["maintainability", "architecture-fitness", "behavior"]);
const ACCEPTED_REPAIR_KINDS = new Set(["autofix", "suggestion", "codemod", "manual"]);

// Diagnostics where a single-clause policy reminder is the right shape; padding
// to Why/How would dilute the signal. Group by why-it-stays-terse, not by rule.
const EXEMPT_MESSAGE_IDS = new Set([
  // One-line policy reminders — the diagnostic IS the rule.
  "e2e-prefer-role-selectors/preferRoleSelectors",
  "no-commented-out-code/commentedOutCode",
  "no-llm-artifacts/leftoverEditNote",
  "no-llm-artifacts/todoNeedsReference",
  "no-llm-artifacts/incompleteImplementation",
  "test-file-location/wrongNaming",
  "test-file-location/missingTests",
  // Repair is the codemod command; prose would just restate it.
  "no-barrel/noBarrel",
]);

const INLINE_GUIDE_POINTER_EXEMPT_RULES = new Map([
  [
    "max-lines",
    "The diagnostic carries the complete size-policy repair, while the local-rule guide documents the metadata contract.",
  ],
  [
    "no-arbitrary-tailwind-value",
    "The message names the sanctioned @theme-token repair; DESIGN.md is the design authority, not a step-by-step lint guide.",
  ],
  [
    "no-barrel",
    "The terse policy message names the codemod, so an added guide pointer would duplicate the repair surface.",
  ],
  [
    "no-commented-out-code",
    "The commented-out-code policy is self-contained and names both deletion and prose rewrite repairs directly.",
  ],
  [
    "no-explicit-any",
    "The diagnostic keeps the exact type taxonomy and disable syntax inline for plain lint output.",
  ],
  [
    "no-llm-artifacts",
    "The artifact-policy diagnostics are self-contained and each names the accepted repair shape directly.",
  ],
  [
    "no-swallowed-errors",
    "The message lists the complete local repair choices; the paired guide is broad local-rule context.",
  ],
  [
    "socket-listener-cleanup",
    "The messages name the React effect/subscription cleanup pattern directly; the guide is broader client workflow context.",
  ],
  [
    "type-assertion-boundary",
    "The diagnostic carries exact marker syntax and categories inline so casts can be repaired from plain lint output.",
  ],
  [
    "structured-logging",
    "The diagnostics list the complete logging repair patterns; the paired guide is broad local-rule context.",
  ],
]);

const INLINE_GUIDE_POINTER_EXEMPT_MESSAGE_IDS = new Map([
  [
    "strict-shared-schemas/zodAlias",
    "This diagnostic is about the local Zod identifier contract, not the tRPC procedure workflow.",
  ],
]);

const SHARED_PAIRED_GUIDE_ALLOWLIST = new Map([
  [
    "docs/guides/add-trpc-procedure.md",
    "The tRPC procedure guide intentionally owns input, output, and strict-schema contract rules together.",
  ],
  [
    "docs/guides/local-eslint-rules.md",
    "The local-rule guide intentionally groups repository lint-rule metadata and self-contained local policy messages.",
  ],
]);

const SELF_CONTAINED_MESSAGE_DRIFT_TOKENS = [
  {
    context: "max-lines/exceed",
    tokens: [
      "eslint-config/max-lines-exceptions.baseline.json",
      "Do not compress lines or inline useful helpers just to satisfy the metric",
    ],
  },
  {
    context: "no-explicit-any/noAny",
    tokens: [
      "unknown",
      "shared type",
      "local type",
      "// eslint-disable-next-line local/no-explicit-any -- <why this boundary is intentionally untyped>",
    ],
  },
  {
    context: "type-assertion-boundary/missingBoundary",
    tokens: [
      "// type-assertion-boundary: <category> - <reason>",
      "framework",
      "json",
      "prisma",
      "test",
      "interop",
    ],
  },
];

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

function inlineGuidePointers(message) {
  return [...message.matchAll(INLINE_GUIDE_POINTER_PATTERN)]
    .map((match) => match.groups?.path)
    .filter(isNonEmptyString);
}

function messageForContext(context) {
  const separatorIndex = context.indexOf("/");
  const ruleId = context.slice(0, separatorIndex);
  const messageId = context.slice(separatorIndex + 1);
  const message = RULE_BY_ID.get(ruleId)?.meta?.messages?.[messageId];

  expect(typeof message, `${context} message`).toBe("string");
  return typeof message === "string" ? message : "";
}

function ruleIdsByPairedGuide() {
  /** @type {Map<string, string[]>} */
  const ruleIdsByGuide = new Map();
  for (const entry of ALL_LOCAL_RULES) {
    const pairedGuide = entry.rule.meta?.docs?.pairedGuide;
    if (pairedGuide === undefined || pairedGuide === "none") continue;
    ruleIdsByGuide.set(pairedGuide, [...(ruleIdsByGuide.get(pairedGuide) ?? []), entry.id]);
  }
  return ruleIdsByGuide;
}

describe("local rule message guidance", () => {
  it("discovers local rules before checking their meta-contract", () => {
    expect(ALL_LOCAL_RULES, "local plugin rule registry").not.toHaveLength(0);
  });

  it("keeps Before/After snippets in high-traffic agent overlays", () => {
    const linter = new Linter();
    const filename = "packages/server/src/services/structural-guidance-example.ts";

    for (const ruleId of BEFORE_AFTER_OVERLAY_RULE_IDS) {
      const overlay = LINT_AGENT_GUIDANCE_OVERLAYS.get(ruleId)?.default;
      const howToFix = overlay?.howToFix ?? "";
      const beforeIndex = howToFix.indexOf("Before:");
      const afterIndex = howToFix.indexOf("After:");

      expect(beforeIndex, `${ruleId} Before`).toBeGreaterThanOrEqual(0);
      expect(afterIndex, `${ruleId} After`).toBeGreaterThan(beforeIndex);

      const example = overlay?.example;
      expect(example, `${ruleId} executable example`).toBeDefined();
      if (example === undefined) continue;
      expect(
        example.before.includes("\n") || howToFix.includes(`Before: \`${example.before}\`.`),
        `${ruleId} exact Before example`,
      ).toBe(true);
      expect(
        example.after.includes("\n") || howToFix.includes(`After: \`${example.after}\`.`),
        `${ruleId} exact After example`,
      ).toBe(true);
      const ruleConfig = STRUCTURAL_EXAMPLE_RULE_CONFIGS.get(ruleId);
      expect(ruleConfig, `${ruleId} test config`).toBeDefined();
      if (ruleConfig === undefined) continue;
      const config = [
        {
          files: ["**/*.ts"],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
              allowReturnOutsideFunction: true,
              ecmaVersion: 2022,
              sourceType: "module",
            },
          },
          rules: { [ruleId]: ruleConfig },
        },
      ];
      const beforeMessages = linter.verify(example.before, config, { filename });
      const afterMessages = linter.verify(example.after, config, { filename });

      expect(
        beforeMessages.some((message) => message.ruleId === ruleId),
        `${ruleId} violation`,
      ).toBe(true);
      expect(afterMessages, `${ruleId} repaired example`).toEqual([]);
    }
  });

  it("keeps curated type-escape repairs compilable and clean under two sibling rules", () => {
    const linter = new Linter();
    const filename = "packages/server/src/services/message-guidance-fixture.ts";

    for (const fixture of TYPE_ESCAPE_FIX_FIXTURES) {
      const beforeRuleIds = linter
        .verify(fixture.before, TYPE_ESCAPE_CLUSTER_CONFIG, { filename })
        .map((message) => message.ruleId);
      const afterMessages = linter.verify(fixture.after, TYPE_ESCAPE_CLUSTER_CONFIG, {
        filename,
      });

      expect(beforeRuleIds, `${fixture.context} source finding`).toEqual(fixture.expectedBefore);
      expect(afterMessages, `${fixture.context} introduced finding`).toEqual([]);
      expect(
        standaloneCompileDiagnostics(fixture.before, filename),
        `${fixture.context} before compile`,
      ).toEqual([]);
      expect(
        standaloneCompileDiagnostics(fixture.after, filename),
        `${fixture.context} after compile`,
      ).toEqual([]);
    }
  });

  it("keeps lint-agent overlays under the local-rule guidance contract", () => {
    for (const [ruleId, overlaySet] of LINT_AGENT_GUIDANCE_OVERLAYS) {
      const entries = [
        ...(overlaySet.default === undefined ? [] : [["default", overlaySet.default]]),
        ...(overlaySet.messages ?? []),
      ];

      expect(entries.length, `${ruleId} overlay entries`).toBeGreaterThan(0);
      for (const [messageId, overlay] of entries) {
        const context = `${ruleId}/${messageId}`;
        const rendered = `Why: ${overlay.why} How to fix: ${overlay.howToFix}`;

        expect(isNonEmptyString(overlay.why), `${context} why`).toBe(true);
        expect(isNonEmptyString(overlay.howToFix), `${context} howToFix`).toBe(true);
        expect(rendered.length, context).toBeLessThanOrEqual(MAX_MULTI_STEP_MESSAGE_LENGTH);
        expect(WHY_HOW_PATTERN.test(rendered), `${context} Why/How`).toBe(true);
        expect(ACTION_WORD_PATTERN.test(overlay.howToFix), `${context} action`).toBe(true);
        expect(GAMING_REPAIR_PATTERN.test(overlay.howToFix), `${context} anti-gaming`).toBe(false);
        expect(/\n/u.test(rendered), `${context} newline`).toBe(false);
        expect(ACCEPTED_REPAIR_KINDS.has(overlay.repairKind), `${context} repairKind`).toBe(true);

        const hasRepairCommand = Object.hasOwn(overlay, "repairCommand");
        const isCodemod = overlay.repairKind === "codemod";
        expect(hasRepairCommand, `${context} repairCommand`).toBe(isCodemod);
        expect(
          !isCodemod || isNonEmptyString(overlay.repairCommand),
          `${context} repairCommand`,
        ).toBe(true);
      }
    }
  });

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

  it("keeps inline guide pointers aligned with pairedGuide metadata", () => {
    for (const entry of ALL_LOCAL_RULES) {
      for (const [messageId, message] of messageEntriesFor(entry)) {
        const context = `${entry.id}/${messageId}`;
        if (typeof message !== "string") continue;

        const inlinePointers = [...new Set(inlineGuidePointers(message))];
        if (inlinePointers.length === 0) continue;

        expect(inlinePointers, `${context} inline guide pointer must match pairedGuide`).toEqual([
          entry.rule.meta?.docs?.pairedGuide,
        ]);
      }
    }
  });

  it("requires pairedGuide diagnostics to inline a pointer or name an exemption", () => {
    for (const entry of ALL_LOCAL_RULES) {
      const pairedGuide = entry.rule.meta?.docs?.pairedGuide;
      if (pairedGuide === undefined || pairedGuide === "none") continue;

      for (const [messageId, message] of messageEntriesFor(entry)) {
        const context = `${entry.id}/${messageId}`;
        if (typeof message !== "string") continue;

        const hasInlinePointer = inlineGuidePointers(message).includes(pairedGuide);
        const isExempt =
          INLINE_GUIDE_POINTER_EXEMPT_RULES.has(entry.id) ||
          INLINE_GUIDE_POINTER_EXEMPT_MESSAGE_IDS.has(context);

        expect(
          hasInlinePointer || isExempt,
          `${context} must inline "See ${pairedGuide}." or carry an explicit exemption`,
        ).toBe(true);
      }
    }
  });

  it("requires an allowlist entry for heavily shared paired guides", () => {
    for (const [pairedGuide, ruleIds] of ruleIdsByPairedGuide()) {
      expect(
        ruleIds.length <= MAX_RULES_PER_PAIRED_GUIDE_WITHOUT_ALLOWLIST ||
          SHARED_PAIRED_GUIDE_ALLOWLIST.has(pairedGuide),
        `${pairedGuide} backs ${ruleIds.length} rules: ${ruleIds.join(", ")}`,
      ).toBe(true);
    }
  });

  it("keeps self-contained long diagnostics aligned with the local-rule guide", () => {
    for (const { context, tokens } of SELF_CONTAINED_MESSAGE_DRIFT_TOKENS) {
      const message = messageForContext(context);

      for (const token of tokens) {
        expect(message, `${context} message token: ${token}`).toContain(token);
        expect(LOCAL_ESLINT_RULES_GUIDE, `${context} guide token: ${token}`).toContain(token);
      }
    }
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

  it("inline guide pointer exemptions only reference real paired-guide rules and messages", () => {
    for (const [ruleId, reason] of INLINE_GUIDE_POINTER_EXEMPT_RULES) {
      const rule = RULE_BY_ID.get(ruleId);

      expect(rule, `${ruleId} rule`).toBeDefined();
      expect(isNonEmptyString(reason), `${ruleId} exemption reason`).toBe(true);
      expect(rule?.meta?.docs?.pairedGuide, `${ruleId} pairedGuide`).not.toBe("none");
    }

    for (const [exemptId, reason] of INLINE_GUIDE_POINTER_EXEMPT_MESSAGE_IDS) {
      const separatorIndex = exemptId.indexOf("/");
      const ruleId = exemptId.slice(0, separatorIndex);
      const messageId = exemptId.slice(separatorIndex + 1);
      const rule = RULE_BY_ID.get(ruleId);

      expect(rule, `${exemptId} rule`).toBeDefined();
      expect(isNonEmptyString(reason), `${exemptId} exemption reason`).toBe(true);
      expect(rule?.meta?.docs?.pairedGuide, `${exemptId} pairedGuide`).not.toBe("none");
      expect(isObject(rule?.meta?.messages), `${exemptId} meta.messages`).toBe(true);
      expect(Object.hasOwn(rule?.meta?.messages ?? {}, messageId), `${exemptId} messageId`).toBe(
        true,
      );
    }
  });

  it("shared paired-guide allowlist only names heavily shared guides", () => {
    const ruleIdsByGuide = ruleIdsByPairedGuide();

    for (const [pairedGuide, reason] of SHARED_PAIRED_GUIDE_ALLOWLIST) {
      const ruleIds = ruleIdsByGuide.get(pairedGuide) ?? [];

      expect(isNonEmptyString(reason), `${pairedGuide} allowlist reason`).toBe(true);
      expect(
        ruleIds.length,
        `${pairedGuide} allowlist entry should be removed once it no longer exceeds the cap`,
      ).toBeGreaterThan(MAX_RULES_PER_PAIRED_GUIDE_WITHOUT_ALLOWLIST);
    }
  });

  it("recognizes lowercase inline guide pointers in parity checks", () => {
    expect(inlineGuidePointers("why/how text; see docs/guides/local-eslint-rules.md.")).toEqual([
      "docs/guides/local-eslint-rules.md",
    ]);
  });
});
