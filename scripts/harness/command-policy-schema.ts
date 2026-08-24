// Typed contract for the root `commandPolicy` array in harness.controls.json:
// the ordered hard-deny rule set every agent Bash command is judged against.
//
// WHY ROOT-LEVEL, NOT A CONTROL FACET. The three existing control facets
// (`generatedSurface`, `hookWiring`, `skillWiring`) each describe how *that one
// control* is wired into the harness. This is not that: the rule set is domain
// data with several consumers — the generator that renders
// scripts/ai-hooks/policy-rules.generated.sh, the shared policy shell that
// enforces it, the Claude-native permission array it projects into, and (S1)
// the generated policy-reference table. Hanging it off the generator's control
// record would make that record double as the policy authority, so renaming or
// retiring the generator would move the policy with it. `verifySlotCatalog` set
// the root-level precedent for exactly this shape, and staying at the root also
// keeps CONTROL_FIELD_NAMES and the non-lint field walker untouched — there is
// no per-kind answer to "which control kinds may carry commandPolicy".
//
// Division of labor follows the manifest parser's recorded ruling: the root
// schema (harness-manifest-schema.ts) keeps the boundary deliberately open, and
// this module owns the interior plus the semantic invariants, aggregating every
// failure so one run reports the whole registration mistake.

import { z } from "zod";

import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";

const nonBlankString = z.string().regex(/\S/u, { message: "must be a non-empty string" });
const matcherValueString = nonBlankString.regex(/^[^\t\r\n]+$/u, {
  message: "must not contain tabs or newlines",
});
const ruleIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, { message: "must be a kebab-case rule id" });
const shellFunctionSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]*$/u, { message: "must be a shell function name" });
const GIT_COMMAND_TOKEN = "${AI_POLICY_GIT_CMD}";
const COMMAND_END_TOKEN = "$AI_POLICY_CMD_END";

/**
 * One matcher, in the order the policy evaluates it. `pattern` values are
 * extended-regex bodies exactly as the shell holds them, with
 * `${AI_POLICY_GIT_CMD}` / `$AI_POLICY_CMD_END` left symbolic so a consumer
 * expands them at match time; `literal` is a fixed substring (`grep -qF`);
 * `predicate` names a shell function that keeps its body in the policy shell.
 */
const matcherSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pattern"), pattern: matcherValueString }),
  z.strictObject({ kind: z.literal("literal"), literal: matcherValueString }),
  z.strictObject({ kind: z.literal("predicate"), predicate: shellFunctionSchema }),
]);

/**
 * The message the rule emits. `constant` is the shell variable the policy shell
 * still defines and `text` is its byte-exact value — the pair is what lets the
 * generator prove the manifest copy has not drifted from the constant it will
 * eventually replace. A predicate-emitted rule composes its own reason inside
 * the predicate and therefore carries no text here.
 */
const messageSchema = z.union([
  z.strictObject({ constant: nonBlankString, text: nonBlankString }),
  z.strictObject({ from: z.literal("predicate") }),
]);

/**
 * Claude-native projection, orthogonal to how the rule matches. Total by
 * construction: a row supplies the matcher strings it contributes to
 * `.claude/settings.json` `permissions.deny`, records why those matchers are a
 * necessarily partial but sound projection when applicable, or states why it
 * is deliberately shared-policy-only. There is no silent disposition.
 */
const nativePermissionsSchema = z.discriminatedUnion("projected", [
  z.strictObject({
    projected: z.literal(true),
    matchers: z.array(matcherValueString).min(1),
    partialReason: nonBlankString.optional(),
  }),
  z.strictObject({ projected: z.literal(false), reason: nonBlankString }),
]);

const commandPolicyRuleSchema = z.strictObject({
  id: ruleIdSchema,
  /** 1-based scan position; the first hard match wins over provisional soft matches. */
  order: z.int().positive(),
  /**
   * `hard` forbids the command. `soft` is the latent guidance class represented
   * by the decision record's `advise` verdict; no soft row is active today.
   */
  class: z.enum(["hard", "soft"]),
  /**
   * `command` verdicts depend only on the command text. `checkout` verdicts
   * additionally depend on the checkout the verdict is resolved against — its
   * branch, or repo-root state such as an override marker — which no static
   * matcher can see.
   */
  scope: z.enum(["command", "checkout"]),
  message: messageSchema,
  /** Shell function applied to the command text before matching, when the rule uses one. */
  haystackTransform: shellFunctionSchema.optional(),
  matchers: z.array(matcherSchema).min(1),
  nativePermissions: nativePermissionsSchema,
});

export type CommandPolicyRule = z.infer<typeof commandPolicyRuleSchema>;
export type CommandPolicyMatcher = CommandPolicyRule["matchers"][number];

const commandPolicySchema = z.array(commandPolicyRuleSchema).min(1);

function placeholderPositionFailure(
  pattern: string,
  token: string,
  expectedIndex: number,
  expectedPosition: string,
): string | undefined {
  const firstIndex = pattern.indexOf(token);
  if (firstIndex === -1) return undefined;
  return firstIndex === expectedIndex && pattern.lastIndexOf(token) === firstIndex
    ? undefined
    : `${token} may appear only once, at the ${expectedPosition} of a pattern`;
}

function collectRuleMatcherFailures(rule: CommandPolicyRule): readonly string[] {
  const failures: string[] = [];
  if ("from" in rule.message && rule.matchers.some((matcher) => matcher.kind !== "predicate")) {
    failures.push(
      'message.from "predicate" requires predicate-only matchers; a pattern or literal match cannot emit a reason',
    );
  }
  for (const [matcherIndex, matcher] of rule.matchers.entries()) {
    if (matcher.kind !== "pattern") continue;
    const withoutSupportedTokens = matcher.pattern
      .replaceAll(GIT_COMMAND_TOKEN, "")
      .replaceAll(COMMAND_END_TOKEN, "");
    const unsupportedPlaceholder = /\$(?:\{[^}\r\n]*\}|[A-Za-z_]\w*|[0-9@*#?!-])/u.exec(
      withoutSupportedTokens,
    )?.[0];
    const placeholderFailures = [
      placeholderPositionFailure(matcher.pattern, GIT_COMMAND_TOKEN, 0, "start"),
      placeholderPositionFailure(
        matcher.pattern,
        COMMAND_END_TOKEN,
        matcher.pattern.length - COMMAND_END_TOKEN.length,
        "end",
      ),
    ].filter((failure) => failure !== undefined);
    failures.push(
      ...placeholderFailures.map((failure) => `matcher ${String(matcherIndex + 1)}: ${failure}`),
    );
    if (unsupportedPlaceholder !== undefined) {
      failures.push(
        `matcher ${String(matcherIndex + 1)}: unsupported shell placeholder ${unsupportedPlaceholder}; only ${GIT_COMMAND_TOKEN} and ${COMMAND_END_TOKEN} are expanded by the dispatcher`,
      );
    }
  }
  return failures;
}

function collectSemanticFailures(rules: readonly CommandPolicyRule[]): readonly string[] {
  const failures: string[] = [];
  const seenIds = new Set<string>();
  const matcherOwners = new Map<string, string>();

  for (const [index, rule] of rules.entries()) {
    const position = index + 1;
    if (rule.order !== position) {
      failures.push(
        `commandPolicy[${String(index)}] ${rule.id}: order must equal its 1-based position (${String(position)}), got ${String(rule.order)}; rule order is the evaluation order, with hard matches taking precedence over soft matches`,
      );
    }
    if (seenIds.has(rule.id)) failures.push(`commandPolicy: duplicate rule id: ${rule.id}`);
    seenIds.add(rule.id);

    failures.push(
      ...collectRuleMatcherFailures(rule).map((failure) => `commandPolicy ${rule.id}: ${failure}`),
    );

    if (!rule.nativePermissions.projected) continue;
    if (rule.scope !== "command") {
      failures.push(
        `commandPolicy ${rule.id}: scope ${rule.scope} cannot be natively projected; a static matcher cannot resolve the target checkout, so record a non-projection reason instead`,
      );
    }
    if (rule.class !== "hard") {
      failures.push(
        `commandPolicy ${rule.id}: only hard rules may be natively projected; a native deny is unconditional and cannot express ${rule.class} guidance`,
      );
    }
    for (const matcher of rule.nativePermissions.matchers) {
      const owner = matcherOwners.get(matcher);
      if (owner === undefined) {
        matcherOwners.set(matcher, rule.id);
        continue;
      }
      failures.push(
        `commandPolicy: native matcher ${matcher} is claimed by both ${owner} and ${rule.id}; each deny entry must project from exactly one rule`,
      );
    }
  }
  return failures;
}

export type ParseCommandPolicyResult =
  | { readonly rules: readonly CommandPolicyRule[]; readonly failures?: undefined }
  | { readonly rules?: undefined; readonly failures: readonly string[] };

/**
 * Validate the raw root `commandPolicy` value. Returns every failure as one
 * flat list so a registration mistake surfaces in a single run, matching the
 * aggregated-diagnostics posture of the sibling facet validators.
 */
export function parseCommandPolicy(value: unknown): ParseCommandPolicyResult {
  const parsed = commandPolicySchema.safeParse(value);
  if (!parsed.success) {
    return {
      failures: parsed.error.issues.map(
        (issue) =>
          `${HARNESS_MANIFEST_FILENAME}: commandPolicy.${issue.path.map(String).join(".")}: ${issue.message}`,
      ),
    };
  }
  const failures = collectSemanticFailures(parsed.data);
  return failures.length === 0
    ? { rules: parsed.data }
    : { failures: failures.map((failure) => `${HARNESS_MANIFEST_FILENAME}: ${failure}`) };
}

/** Throwing variant of {@link parseCommandPolicy} for generator-style callers. */
export function loadCommandPolicy(value: unknown): readonly CommandPolicyRule[] {
  const result = parseCommandPolicy(value);
  if (result.failures !== undefined) {
    throw new Error(
      [`${HARNESS_MANIFEST_FILENAME} commandPolicy failed validation:`, ...result.failures].join(
        "\n- ",
      ),
    );
  }
  return result.rules;
}
