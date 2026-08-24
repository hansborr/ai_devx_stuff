import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { lintRatchets } from "../lint-ratchet/lint-ratchet-config.js";
import {
  deriveLintRuleControls,
  type LintRuleControl,
  type LintRuleControlInputs,
  NORMAL_LINT_INVOCATION,
  RATCHET_LINT_INVOCATION,
  renderLintRuleControls,
} from "./generate-lint-rule-controls.js";
import { renderLocalPluginModule } from "./generate-local-plugin.js";
import { HARNESS_LINT_RULE_CONTROLS_FILENAME } from "./harness-manifest.js";
import { loadLocalRuleConfig } from "./local-rule-config.js";
import { discoverLocalRules, localRuleSourcePath } from "./local-rule-discovery.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function inputs(options: {
  ids: readonly string[];
  enabled?: readonly string[];
  ratcheted?: readonly string[];
}): LintRuleControlInputs {
  return {
    rules: options.ids.map((id) => ({ id, source: localRuleSourcePath(id) })),
    enabledRuleNames: new Set(options.enabled ?? []),
    ratchetRuleNames: new Set(options.ratcheted ?? []),
  };
}

describe("deriveLintRuleControls", () => {
  it("derives id, ruleName, and source from the rule filename", () => {
    expect(
      deriveLintRuleControls(inputs({ ids: ["no-barrel"], enabled: ["local/no-barrel"] })),
    ).toEqual([
      {
        id: "lint/local/no-barrel",
        kind: "lint-rule",
        ruleName: "local/no-barrel",
        source: "eslint-rules/no-barrel.js",
        invocation: NORMAL_LINT_INVOCATION,
      },
    ]);
  });

  it("uses the ratchet command for a rule flat config does not enable", () => {
    const [control] = deriveLintRuleControls(
      inputs({ ids: ["no-commented-out-code"], ratcheted: ["local/no-commented-out-code"] }),
    );

    expect(control?.invocation).toBe(RATCHET_LINT_INVOCATION);
  });

  it("prefers normal lint when a rule is on both activation surfaces", () => {
    const [control] = deriveLintRuleControls(
      inputs({
        ids: ["no-swallowed-errors"],
        enabled: ["local/no-swallowed-errors"],
        ratcheted: ["local/no-swallowed-errors"],
      }),
    );

    expect(control?.invocation).toBe(NORMAL_LINT_INVOCATION);
  });

  it("fails generation for a rule activated nowhere, naming it", () => {
    expect(() =>
      deriveLintRuleControls(inputs({ ids: ["orphan-rule"], enabled: ["local/other"] })),
    ).toThrow(/local\/orphan-rule/u);
  });

  it("refuses an empty control set", () => {
    expect(() => deriveLintRuleControls(inputs({ ids: [] }))).toThrow(
      /refusing to render an empty/u,
    );
  });
});

describe("renderLintRuleControls", () => {
  it("renders a self-describing include ending in a newline", () => {
    const control: LintRuleControl = {
      id: "lint/local/no-barrel",
      kind: "lint-rule",
      ruleName: "local/no-barrel",
      source: "eslint-rules/no-barrel.js",
      invocation: NORMAL_LINT_INVOCATION,
    };
    const rendered = renderLintRuleControls([control]);

    expect(rendered.endsWith("\n")).toBe(true);
    const parsed: unknown = JSON.parse(rendered);
    expect(parsed).toMatchObject({ controls: [control] });
    expect(JSON.stringify(parsed)).toContain("Do not edit by hand");
  });

  it("orders controls by rule id, the way the generated plugin registry orders its keys", () => {
    // Discovery sorts FILENAMES, and '-' (0x2D) sorts before '.' (0x2E), so a
    // prefix pair reaches both renderers as [no-barrel-strict, no-barrel].
    // renderLocalPluginModule re-sorts by bare rule id; this renderer must land
    // on the same order or the two generated artifacts disagree.
    const ids = ["no-barrel-strict", "no-barrel"];
    const controls = deriveLintRuleControls(
      inputs({ ids, enabled: ids.map((id) => `local/${id}`) }),
    );
    const parsed = JSON.parse(renderLintRuleControls(controls)) as {
      controls: readonly LintRuleControl[];
    };
    const pluginModule = renderLocalPluginModule(
      ids.map((id) => ({ id, source: localRuleSourcePath(id) })),
    );

    expect(parsed.controls.map((control) => control.id)).toEqual([
      "lint/local/no-barrel",
      "lint/local/no-barrel-strict",
    ]);
    expect(pluginModule.indexOf('"no-barrel":')).toBeLessThan(
      pluginModule.indexOf('"no-barrel-strict":'),
    );
  });
});

describe("committed lint-rule controls (live tree)", () => {
  it("is byte-identical to a fresh derivation from the live activation surfaces", async () => {
    const rules = await discoverLocalRules(repoRoot);
    const { enabledRuleNames } = await loadLocalRuleConfig(join(repoRoot, "eslint.config.js"));
    const controls = deriveLintRuleControls({
      rules,
      enabledRuleNames,
      ratchetRuleNames: new Set(lintRatchets.map((ratchet) => ratchet.ruleId)),
    });

    expect(readFileSync(join(repoRoot, HARNESS_LINT_RULE_CONTROLS_FILENAME), "utf8")).toBe(
      renderLintRuleControls(controls),
    );
  });
});
