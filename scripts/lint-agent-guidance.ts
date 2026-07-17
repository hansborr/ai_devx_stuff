import type { RuleDocRepairKind } from "./lib/lint-rule-docs.js";

export interface LintAgentGuidanceOverlay {
  readonly why: string;
  readonly howToFix: string;
  readonly example?: {
    readonly before: string;
    readonly after: string;
  };
  readonly repairKind: RuleDocRepairKind;
  readonly repairCommand?: string;
}

export interface LintAgentRuleGuidanceOverlay {
  readonly default?: LintAgentGuidanceOverlay;
  readonly messages?: ReadonlyMap<string, LintAgentGuidanceOverlay>;
}

const COMPLEXITY_EXAMPLE = {
  before:
    "function pick(n: number): number { return n===0?0:n===1?1:n===2?2:n===3?3:n===4?4:n===5?5:n===6?6:n===7?7:n===8?8:n===9?9:n; }",
  after: "function pick(n: number, choices: readonly number[]): number { return choices[n] ?? n; }",
} as const;

const MAX_DEPTH_EXAMPLE = {
  before: "if (a) { if (b) { if (c) { if (d) run(); } } }",
  after: "if (!a || !b || !c || !d) return; run();",
} as const;

const MAX_PARAMS_EXAMPLE = {
  before:
    "function create(id: string, name: string, ownerId: string, flags: number, slug: string): void {}",
  after:
    "function create(input: { id: string; name: string; ownerId: string; flags: number; slug: string }): void {}",
} as const;

const MAX_LINES_BEFORE = [
  "export function publishCampaign(): void {",
  ...Array.from({ length: 101 }, (_, index) => `  publishStep(${String(index)});`),
  "}",
].join("\n");
const MAX_LINES_AFTER = [
  "export function publishCampaign(): void {",
  ...Array.from({ length: 51 }, (_, index) => `  prepareStep(${String(index)});`),
  "}",
  "export function persistCampaign(): void {",
  ...Array.from({ length: 50 }, (_, index) => `  persistStep(${String(index)});`),
  "}",
].join("\n");

export const LINT_AGENT_GUIDANCE_OVERLAYS: ReadonlyMap<string, LintAgentRuleGuidanceOverlay> =
  new Map([
    [
      "complexity",
      {
        default: {
          why: "Complex branching makes behavior harder to verify and safe changes harder to isolate.",
          howToFix: `Extract cohesive decisions into named helpers, then use guard clauses or early returns to reduce independent branches. Before: \`${COMPLEXITY_EXAMPLE.before}\`. After: \`${COMPLEXITY_EXAMPLE.after}\`.`,
          example: COMPLEXITY_EXAMPLE,
          repairKind: "manual",
        },
      },
    ],
    [
      "max-lines-per-function",
      {
        default: {
          why: "Long functions hide distinct responsibilities and make reviews and tests harder to focus.",
          howToFix:
            "Extract cohesive responsibilities into named helpers while preserving readable control flow and meaningful intermediate names. Before: one 101-step `publishCampaign` function. After: a 51-step `publishCampaign` function and a 50-step `persistCampaign` function, each below 100 effective lines.",
          example: {
            before: MAX_LINES_BEFORE,
            after: MAX_LINES_AFTER,
          },
          repairKind: "manual",
        },
      },
    ],
    [
      "max-depth",
      {
        default: {
          why: "Deeply nested control flow hides exit conditions and makes edge cases harder to reason about.",
          howToFix: `Use guard clauses or early returns, then extract nested branches into focused helpers. Before: \`${MAX_DEPTH_EXAMPLE.before}\`. After: \`${MAX_DEPTH_EXAMPLE.after}\`.`,
          example: MAX_DEPTH_EXAMPLE,
          repairKind: "manual",
        },
      },
    ],
    [
      "max-params",
      {
        default: {
          why: "Wide parameter lists obscure a function's inputs and make call sites easy to misuse.",
          howToFix: `Replace separate cohesive inputs with a named object, or split the function into narrower operations. Before: \`${MAX_PARAMS_EXAMPLE.before}\`. After: \`${MAX_PARAMS_EXAMPLE.after}\`.`,
          example: MAX_PARAMS_EXAMPLE,
          repairKind: "manual",
        },
      },
    ],
    [
      "react-hooks/rules-of-hooks",
      {
        default: {
          why: "Stable hook ordering is required for React to associate state and effects with the correct component render.",
          howToFix:
            "Move hooks to the top level of a React component or custom hook, and call them unconditionally in the same order.",
          repairKind: "manual",
        },
      },
    ],
    [
      "react-hooks/exhaustive-deps",
      {
        default: {
          why: "Incomplete hook dependencies can capture stale values or skip synchronization when an input changes.",
          howToFix:
            "Add every referenced reactive value to the dependency list, or restructure the hook so the value is no longer captured.",
          repairKind: "manual",
        },
      },
    ],
  ]);

export function lintAgentGuidanceOverlayFor(
  ruleId: string,
  messageId: string | undefined,
  overlays: ReadonlyMap<string, LintAgentRuleGuidanceOverlay> = LINT_AGENT_GUIDANCE_OVERLAYS,
): LintAgentGuidanceOverlay | undefined {
  const overlay = overlays.get(ruleId);
  if (overlay === undefined) return undefined;
  if (messageId !== undefined) {
    const messageOverlay = overlay.messages?.get(messageId);
    if (messageOverlay !== undefined) return messageOverlay;
  }
  return overlay.default;
}
