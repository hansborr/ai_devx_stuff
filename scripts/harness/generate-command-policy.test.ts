import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  collectNativeDenyParityFailures,
  renderCommandPolicyFragment,
} from "./command-policy-projection.js";
import { type CommandPolicyRule, parseCommandPolicy } from "./command-policy-schema.js";
import { collectCommandPolicyShellFailures } from "./generate-command-policy.js";
import { loadGeneratedSurfaces } from "./generated-surfaces-loader.js";
import { loadTypedHarnessManifest } from "./harness-manifest-loader.js";
import {
  AI_HOOKS_COMMAND_POLICY_SHELL_PATHS,
  AI_HOOKS_POLICY_PATH,
  CLAUDE_SETTINGS_PATH,
  GENERATED_COMMAND_POLICY_PATH,
} from "./harness-paths.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");

const settingsJsonText = read(CLAUDE_SETTINGS_PATH);
const policyShellTexts = AI_HOOKS_COMMAND_POLICY_SHELL_PATHS.map(read);

function liveRules(): readonly CommandPolicyRule[] {
  const parsed = parseCommandPolicy(loadTypedHarnessManifest(repoRoot).commandPolicy);
  expect(parsed.failures).toBeUndefined();
  return parsed.rules ?? [];
}

const rules = liveRules();

/** A minimal well-formed rule set, for the negative cases below. */
function fixtureRules(): Record<string, unknown>[] {
  return [
    {
      id: "first-rule",
      order: 1,
      class: "hard",
      scope: "command",
      message: { constant: "AI_POLICY_FIRST", text: "First." },
      matchers: [{ kind: "pattern", pattern: "first$AI_POLICY_CMD_END" }],
      nativePermissions: { projected: true, matchers: ["Bash(first *)"] },
    },
    {
      id: "second-rule",
      order: 2,
      class: "hard",
      scope: "checkout",
      message: { from: "predicate" },
      matchers: [{ kind: "predicate", predicate: "ai_policy_second" }],
      nativePermissions: { projected: false, reason: "Checkout-scoped." },
    },
  ];
}

function parsedFixtureRules(): readonly CommandPolicyRule[] {
  const parsed = parseCommandPolicy(fixtureRules());
  expect(parsed.failures).toBeUndefined();
  return parsed.rules ?? [];
}

describe("live command policy", () => {
  it("keeps the native deny projection valid", () => {
    expect(
      collectNativeDenyParityFailures({
        rules,
        settingsJsonText,
        settingsPath: CLAUDE_SETTINGS_PATH,
        refreshCommand: "harness:command-policy",
      }),
    ).toStrictEqual([]);
  });

  it("keeps every named predicate and haystack transform defined in the shell module set", () => {
    expect(collectCommandPolicyShellFailures(rules, policyShellTexts)).toStrictEqual([]);
  });

  it("resolves a predicate whose body lives in a sourced module, not the facade", () => {
    const rows = fixtureRules();
    rows[0] = {
      ...rows[0],
      matchers: [{ kind: "predicate", predicate: "ai_policy_has_dangerous_git_reset" }],
    };
    const parsed = parseCommandPolicy([rows[0]]);
    expect(collectCommandPolicyShellFailures(parsed.rules ?? [], policyShellTexts)).toStrictEqual(
      [],
    );
    // Pins the half that makes the case meaningful: the body really has left
    // the facade, so a scan narrowed back to policy.sh alone would fail here.
    expect(read(AI_HOOKS_POLICY_PATH)).not.toContain("ai_policy_has_dangerous_git_reset() {");
  });

  it("keeps the scanned shell module set and the facet's triggerPaths in step", () => {
    // The two lists are maintained by hand in different files. If a module is
    // added to the scan but not to triggerPaths it silently stops stale-warning
    // the generated fragment; if it is added to triggerPaths but not to the
    // scan, a predicate that moves into it fails generation for no visible
    // reason. Neither is derivable from what policy.sh actually sources, so pin
    // them to each other instead.
    const record = loadGeneratedSurfaces(repoRoot).find(
      (candidate) => candidate.id === "check/command-policy-generator",
    );
    expect(record).toBeDefined();
    const shellTriggerPaths = (record?.triggerPaths ?? []).filter(
      (path) => path.startsWith("scripts/ai-hooks/") && path.endsWith(".sh"),
    );
    expect([...shellTriggerPaths].sort()).toStrictEqual(
      [...AI_HOOKS_COMMAND_POLICY_SHELL_PATHS].sort(),
    );
  });

  it("documents every current native projection as partial", () => {
    expect(
      rules
        .filter(
          (rule) =>
            rule.nativePermissions.projected && rule.nativePermissions.partialReason === undefined,
        )
        .map((rule) => rule.id),
    ).toStrictEqual([]);
  });

  it("renders rule order into the fragment as the manifest declares it", () => {
    const fragment = renderCommandPolicyFragment(rules);
    const ids = /^declare -ga AI_POLICY_RULE_IDS=\((.*)\)$/mu.exec(fragment)?.[1];
    expect(ids?.split(" ")).toStrictEqual(rules.map((rule) => `'${rule.id}'`));
    expect(fragment).toContain(`declare -g AI_POLICY_RULES_COMPLETE=${String(rules.length)}`);
  });

  it("renders each rule's message byte-identically into its public alias and rule map", () => {
    const fragment = renderCommandPolicyFragment(rules);
    for (const rule of rules) {
      if (!("constant" in rule.message)) continue;
      expect(fragment).toContain(
        `declare -g ${rule.message.constant}='${rule.message.text.replaceAll("'", "'\\''")}'`,
      );
      expect(fragment).toContain(
        `AI_POLICY_RULE_MESSAGE['${rule.id}']='${rule.message.text.replaceAll("'", "'\\''")}'`,
      );
    }
  });

  it("keeps the committed fragment fresh", () => {
    expect(read(GENERATED_COMMAND_POLICY_PATH)).toBe(renderCommandPolicyFragment(rules));
  });
});

describe("commandPolicy schema", () => {
  it.each([
    ["${AI_POLICY_GIT_CMD}", "before${AI_POLICY_GIT_CMD}commit"],
    ["$AI_POLICY_CMD_END", "commit$AI_POLICY_CMD_ENDafter"],
  ])("rejects a symbolic pattern token outside its supported position", (token, pattern) => {
    const rows = fixtureRules();
    rows[0] = {
      ...rows[0],
      matchers: [{ kind: "pattern", pattern }],
    };
    expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
      `${token} may appear only once`,
    );
  });

  it.each(["$AI_POLICY_OTHER", "${AI_POLICY_OTHER}", "$1"])(
    "rejects unsupported symbolic pattern token %s",
    (token) => {
      const rows = fixtureRules();
      rows[0] = {
        ...rows[0],
        matchers: [{ kind: "pattern", pattern: `first${token}$AI_POLICY_CMD_END` }],
      };
      expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
        `unsupported shell placeholder ${token}`,
      );
    },
  );

  it.each([
    ["pattern", { kind: "pattern", pattern: "first\tsecond" }],
    ["literal", { kind: "literal", literal: "first\nsecond" }],
  ])("rejects a %s matcher value that breaks the generated record framing", (_kind, matcher) => {
    const rows = fixtureRules();
    rows[0] = { ...rows[0], matchers: [matcher] };
    expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
      "must not contain tabs or newlines",
    );
  });

  it("rejects a predicate-owned message on a row with a non-predicate matcher", () => {
    const rows = fixtureRules();
    rows[0] = {
      ...rows[0],
      message: { from: "predicate" },
    };
    expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
      'message.from "predicate" requires predicate-only matchers',
    );
  });

  it("rejects an order that does not match its position", () => {
    const rows = fixtureRules();
    rows[1] = { ...rows[1], order: 5 };
    expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
      "order must equal its 1-based position (2), got 5",
    );
  });

  it("rejects a duplicate rule id", () => {
    const rows = fixtureRules();
    rows[1] = { ...rows[1], id: "first-rule" };
    expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
      "duplicate rule id: first-rule",
    );
  });

  it("rejects native projection of a checkout-scoped rule", () => {
    const rows = fixtureRules();
    rows[1] = {
      ...rows[1],
      nativePermissions: { projected: true, matchers: ["Bash(second *)"] },
    };
    expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
      "scope checkout cannot be natively projected",
    );
  });

  it("rejects native projection of a soft rule", () => {
    const rows = fixtureRules();
    rows[0] = { ...rows[0], class: "soft" };
    expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
      "only hard rules may be natively projected",
    );
  });

  it("accepts a projected rule whose necessarily partial coverage is documented", () => {
    const rows = fixtureRules();
    rows[0] = {
      ...rows[0],
      nativePermissions: {
        projected: true,
        matchers: ["Bash(first *)"],
        partialReason: "The native matcher language cannot express every shared-policy case.",
      },
    };
    expect(parseCommandPolicy(rows).failures).toBeUndefined();
  });

  it("rejects one native matcher claimed by two rules", () => {
    const rows = fixtureRules();
    rows[1] = {
      ...rows[1],
      scope: "command",
      nativePermissions: { projected: true, matchers: ["Bash(first *)"] },
    };
    expect(parseCommandPolicy(rows).failures?.join("\n")).toContain(
      "native matcher Bash(first *) is claimed by both first-rule and second-rule",
    );
  });

  it("rejects a row with neither projected matchers nor a reason", () => {
    const rows = fixtureRules();
    rows[0] = { ...rows[0], nativePermissions: { projected: true } };
    expect(parseCommandPolicy(rows).failures).toBeDefined();
  });

  it("rejects an unknown field as a registration typo", () => {
    const rows = fixtureRules();
    rows[0] = { ...rows[0], severity: "high" };
    expect(parseCommandPolicy(rows).failures).toBeDefined();
  });
});

describe("native deny parity", () => {
  const options = {
    rules: parsedFixtureRules(),
    settingsPath: CLAUDE_SETTINGS_PATH,
    refreshCommand: "harness:command-policy",
  };
  const settings = (deny: readonly string[]): string =>
    JSON.stringify({ permissions: { deny } }, null, 2);

  it("accepts the exact projection", () => {
    expect(
      collectNativeDenyParityFailures({
        ...options,
        settingsJsonText: settings(["Bash(first *)"]),
      }),
    ).toStrictEqual([]);
  });

  it("reports an entry no rule projects", () => {
    expect(
      collectNativeDenyParityFailures({
        ...options,
        settingsJsonText: settings(["Bash(first *)", "Bash(stray *)"]),
      }).join("\n"),
    ).toContain("entries no commandPolicy rule projects: Bash(stray *)");
  });

  it("reports a projected entry that is not denied", () => {
    expect(
      collectNativeDenyParityFailures({ ...options, settingsJsonText: settings([]) }).join("\n"),
    ).toContain("projected entries not denied: Bash(first *)");
  });

  it("reports a reordering as drift, since the array is an ordered projection", () => {
    const twoRules = parseCommandPolicy([
      ...fixtureRules().slice(0, 1),
      {
        id: "third-rule",
        order: 2,
        class: "hard",
        scope: "command",
        message: { from: "predicate" },
        matchers: [{ kind: "predicate", predicate: "ai_policy_third" }],
        nativePermissions: { projected: true, matchers: ["Bash(third *)"] },
      },
    ]);
    expect(
      collectNativeDenyParityFailures({
        ...options,
        rules: twoRules.rules ?? [],
        settingsJsonText: settings(["Bash(third *)", "Bash(first *)"]),
      }).join("\n"),
    ).toContain("the entries agree but their order does not");
  });

  it("reports a settings file with no deny array", () => {
    expect(
      collectNativeDenyParityFailures({ ...options, settingsJsonText: "{}" }).join("\n"),
    ).toContain("must declare permissions.deny as an array of strings");
  });
});

describe("policy shell references", () => {
  it("rejects an unknown predicate before generating the shell fragment", () => {
    const rows = fixtureRules();
    rows[0] = {
      ...rows[0],
      matchers: [{ kind: "predicate", predicate: "ai_policy_missing_predicate" }],
    };
    const parsed = parseCommandPolicy(rows);
    expect(
      collectCommandPolicyShellFailures(parsed.rules ?? [], policyShellTexts).join("\n"),
    ).toContain("first-rule predicate ai_policy_missing_predicate is not defined");
  });

  it("rejects an unknown haystack transform before generating the shell fragment", () => {
    const rows = fixtureRules();
    rows[0] = { ...rows[0], haystackTransform: "ai_policy_missing_transform" };
    const parsed = parseCommandPolicy(rows);
    expect(
      collectCommandPolicyShellFailures(parsed.rules ?? [], policyShellTexts).join("\n"),
    ).toContain("first-rule haystack transform ai_policy_missing_transform is not defined");
  });
});

describe("fragment rendering", () => {
  it("single-quotes values so pattern variable references stay symbolic", () => {
    const fragment = renderCommandPolicyFragment(parsedFixtureRules());
    expect(fragment).toContain(
      "AI_POLICY_RULE_MATCHERS['first-rule']='pattern\tfirst$AI_POLICY_CMD_END'",
    );
  });

  it("omits the message key for a predicate-emitted rule and the matcher key for a non-projection", () => {
    const fragment = renderCommandPolicyFragment(parsedFixtureRules());
    expect(fragment).not.toContain("AI_POLICY_RULE_MESSAGE['second-rule']");
    expect(fragment).not.toContain("AI_POLICY_RULE_NATIVE_MATCHERS['second-rule']");
    expect(fragment).toContain("AI_POLICY_RULE_NATIVE_EXCLUSION['second-rule']='Checkout-scoped.'");
  });

  it("escapes single quotes in a message", () => {
    const parsed = parseCommandPolicy([
      {
        ...fixtureRules()[0],
        message: { constant: "AI_POLICY_FIRST", text: "Use 'git diff' instead." },
      },
    ]);
    expect(renderCommandPolicyFragment(parsed.rules ?? [])).toContain(
      "AI_POLICY_RULE_MESSAGE['first-rule']='Use '\\''git diff'\\'' instead.'",
    );
  });
});
