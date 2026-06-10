import { describe, expect, it } from "vitest";

import { DriftAiError } from "./errors.js";
import { DEFAULT_SEMGREP_CANDIDATES_TOP } from "./semgrep-advisory.js";
import { parseSemgrepCandidatesArgs } from "./semgrep-candidates-args.js";

describe("parseSemgrepCandidatesArgs", () => {
  it("defaults to no rule sources, no opt-ins, and the default top", () => {
    const parsed = parseSemgrepCandidatesArgs([]);
    expect(parsed).toMatchObject({
      roots: [],
      top: DEFAULT_SEMGREP_CANDIDATES_TOP,
      semgrepBin: null,
      ruleSourceManifestPath: null,
      cliRuleSources: [],
      allowedRuleLicenses: [],
      allowLiveRegistry: false,
      includeRuleMessages: false,
    });
    expect(parsed.base.format).toBe("text");
  });

  it("parses the --include-rule-messages opt-in", () => {
    const parsed = parseSemgrepCandidatesArgs(["--include-rule-messages"]);
    expect(parsed.includeRuleMessages).toBe(true);
  });

  it("parses roots, manifest path, binary override, and top", () => {
    const parsed = parseSemgrepCandidatesArgs([
      "--root",
      "src",
      "--root",
      "scripts",
      "--rule-source-manifest",
      "semgrep-rules.json",
      "--semgrep-bin",
      ".tools/semgrep/.venv/bin/semgrep",
      "--top",
      "5",
    ]);
    expect(parsed.roots).toEqual(["src", "scripts"]);
    expect(parsed.ruleSourceManifestPath).toBe("semgrep-rules.json");
    expect(parsed.semgrepBin).toBe(".tools/semgrep/.venv/bin/semgrep");
    expect(parsed.top).toBe(5);
  });

  it("pairs repeated --semgrep-config/--rule-license in argv order", () => {
    const parsed = parseSemgrepCandidatesArgs([
      "--semgrep-config",
      "/rules/a.yml",
      "--rule-license",
      "MIT",
      "--semgrep-config",
      "/rules/b.yml",
    ]);
    expect(parsed.cliRuleSources).toMatchObject([
      { kind: "local", config: "/rules/a.yml", license: "MIT" },
      { kind: "local", config: "/rules/b.yml", license: null },
    ]);
  });

  it("rejects --rule-license without a preceding --semgrep-config as a usage error", () => {
    expect(() => parseSemgrepCandidatesArgs(["--rule-license", "MIT"])).toThrow(DriftAiError);
  });

  it("rejects remote Semgrep configs on the local --semgrep-config path", () => {
    expect(() =>
      parseSemgrepCandidatesArgs(["--semgrep-config", "p/default", "--rule-license", "MIT"]),
    ).toThrow(/must be a local rule file or directory/u);
    expect(() =>
      parseSemgrepCandidatesArgs([
        "--semgrep-config",
        "https://example.invalid/rules.yml",
        "--rule-license",
        "MIT",
      ]),
    ).toThrow(/must be a local rule file or directory/u);
  });

  it("collects registry packs, allowed licenses, and the live-registry opt-in", () => {
    const parsed = parseSemgrepCandidatesArgs([
      "--registry-pack",
      "p/default",
      "--allow-live-registry",
      "--allow-rule-license",
      "Semgrep-Rules-License-1.0",
      "--allow-rule-license",
      "AGPL-3.0",
    ]);
    expect(parsed.cliRuleSources).toMatchObject([{ kind: "registry-pack", pack: "p/default" }]);
    expect(parsed.allowedRuleLicenses).toEqual(["Semgrep-Rules-License-1.0", "AGPL-3.0"]);
    expect(parsed.allowLiveRegistry).toBe(true);
  });

  it("rejects --registry-pack values that are not p/<pack> shaped", () => {
    expect(() => parseSemgrepCandidatesArgs(["--registry-pack", "auto"])).toThrow(
      /--registry-pack must be a Semgrep registry pack of the form p\/<pack>/u,
    );
  });

  it("rejects a value attached to --allow-live-registry", () => {
    expect(() => parseSemgrepCandidatesArgs(["--allow-live-registry=yes"])).toThrow(
      "--allow-live-registry does not accept a value.",
    );
  });

  it("accepts the universal --format/--output/--config options", () => {
    const parsed = parseSemgrepCandidatesArgs([
      "--format",
      "json",
      "--output",
      "out.json",
      "--config",
      "drift.json",
    ]);
    expect(parsed.base).toEqual({
      format: "json",
      outputPath: "out.json",
      configPath: "drift.json",
    });
  });

  it("names the subcommand in usage on --help", () => {
    expect(() => parseSemgrepCandidatesArgs(["--help"])).toThrow(/semgrep-candidates/u);
  });
});
