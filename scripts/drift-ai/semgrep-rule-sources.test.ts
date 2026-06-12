import { describe, expect, it } from "vitest";

import { DriftAiError } from "./errors.js";
import { parseRuleSourceManifest } from "./semgrep-rule-manifest.js";
import {
  classifyRuleLicense,
  createCliRuleSourceCollector,
  evaluateRuleSources,
  type RuleSourceGateOptions,
  type SemgrepLocalRuleSource,
  type SemgrepRegistryRuleSource,
} from "./semgrep-rule-sources.js";

const MANIFEST_PATH = "semgrep-rules.json";

function localSource(overrides: Partial<SemgrepLocalRuleSource> = {}): SemgrepLocalRuleSource {
  return {
    kind: "local",
    config: "/rules/rules.yml",
    license: null,
    sourceUrl: null,
    commit: null,
    sha256: null,
    operatorAcceptedLicense: false,
    ...overrides,
  };
}

function registrySource(
  overrides: Partial<SemgrepRegistryRuleSource> = {},
): SemgrepRegistryRuleSource {
  return {
    kind: "registry-pack",
    pack: "p/default",
    license: null,
    operatorAcceptedLicense: false,
    ...overrides,
  };
}

const NO_OPT_INS = { allowedRuleLicenses: [], allowLiveRegistry: false } as const;

describe("classifyRuleLicense", () => {
  it("classifies the permissive license list", () => {
    for (const license of ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0"]) {
      expect(classifyRuleLicense(license)).toBe("permissive");
    }
  });

  it("classifies the Semgrep Rules License as restricted-internal-use", () => {
    expect(classifyRuleLicense("Semgrep-Rules-License-1.0")).toBe("restricted-internal-use");
  });

  it("classifies AGPL/GPL as copyleft", () => {
    expect(classifyRuleLicense("AGPL-3.0")).toBe("copyleft");
    expect(classifyRuleLicense("GPL-3.0")).toBe("copyleft");
  });

  it("matches license identifiers case-insensitively", () => {
    expect(classifyRuleLicense("mit")).toBe("permissive");
    expect(classifyRuleLicense("agpl-3.0")).toBe("copyleft");
  });

  it("classifies missing or unrecognized licenses as unknown", () => {
    expect(classifyRuleLicense(null)).toBe("unknown");
    expect(classifyRuleLicense("WTFPL")).toBe("unknown");
  });
});

describe("evaluateRuleSources license gate", () => {
  it("allows a permissive local source by default", () => {
    const [decision] = evaluateRuleSources([localSource({ license: "MIT" })], NO_OPT_INS);
    expect(decision).toMatchObject({
      license: "MIT",
      licenseClass: "permissive",
      allowed: true,
      blockedReasons: [],
    });
  });

  it("blocks an AGPL source without --allow-rule-license AGPL-3.0", () => {
    const [decision] = evaluateRuleSources([localSource({ license: "AGPL-3.0" })], NO_OPT_INS);
    expect(decision?.allowed).toBe(false);
    expect(decision?.licenseClass).toBe("copyleft");
    expect(decision?.blockedReasons.join(" ")).toContain("--allow-rule-license AGPL-3.0");
  });

  it("allows an AGPL source when --allow-rule-license AGPL-3.0 is passed", () => {
    const [decision] = evaluateRuleSources([localSource({ license: "AGPL-3.0" })], {
      allowedRuleLicenses: ["AGPL-3.0"],
      allowLiveRegistry: false,
    });
    expect(decision?.allowed).toBe(true);
  });

  it("matches --allow-rule-license values case-insensitively", () => {
    const [decision] = evaluateRuleSources([localSource({ license: "AGPL-3.0" })], {
      allowedRuleLicenses: ["agpl-3.0"],
      allowLiveRegistry: false,
    });
    expect(decision?.allowed).toBe(true);
  });

  it("blocks a Semgrep Rules License source without the explicit allow flag", () => {
    const [decision] = evaluateRuleSources([registrySource()], {
      allowedRuleLicenses: [],
      allowLiveRegistry: true,
    });
    expect(decision?.allowed).toBe(false);
    expect(decision?.licenseClass).toBe("restricted-internal-use");
    expect(decision?.blockedReasons.join(" ")).toContain(
      "--allow-rule-license Semgrep-Rules-License-1.0",
    );
  });

  it("allows a Semgrep Rules License pack with both registry and license opt-ins", () => {
    const [decision] = evaluateRuleSources([registrySource()], {
      allowedRuleLicenses: ["Semgrep-Rules-License-1.0"],
      allowLiveRegistry: true,
    });
    expect(decision?.allowed).toBe(true);
  });

  it("blocks a source with no declared license unless 'unknown' is explicitly allowed", () => {
    const blocked = evaluateRuleSources([localSource()], NO_OPT_INS);
    expect(blocked[0]?.allowed).toBe(false);
    expect(blocked[0]?.blockedReasons.join(" ")).toContain("--allow-rule-license unknown");

    const allowed = evaluateRuleSources([localSource()], {
      allowedRuleLicenses: ["unknown"],
      allowLiveRegistry: false,
    });
    expect(allowed[0]?.allowed).toBe(true);
  });

  it("blocks an unrecognized license unless that exact license is explicitly allowed", () => {
    const blocked = evaluateRuleSources([localSource({ license: "WTFPL" })], NO_OPT_INS);
    expect(blocked[0]?.allowed).toBe(false);
    expect(blocked[0]?.licenseClass).toBe("unknown");

    const allowed = evaluateRuleSources([localSource({ license: "WTFPL" })], {
      allowedRuleLicenses: ["WTFPL"],
      allowLiveRegistry: false,
    });
    expect(allowed[0]?.allowed).toBe(true);
  });

  it("does not let the 'unknown' token allow a source that declares an unrecognized license", () => {
    const [decision] = evaluateRuleSources([localSource({ license: "WTFPL" })], {
      allowedRuleLicenses: ["unknown"],
      allowLiveRegistry: false,
    });
    expect(decision?.allowed).toBe(false);
  });

  it("accepts a non-permissive license via the manifest operatorAcceptedLicense field", () => {
    const [decision] = evaluateRuleSources(
      [localSource({ license: "AGPL-3.0", operatorAcceptedLicense: true })],
      NO_OPT_INS,
    );
    expect(decision?.allowed).toBe(true);
  });

  it("quotes license opt-in hints when the license id needs shell quoting", () => {
    const [decision] = evaluateRuleSources(
      [localSource({ license: "Custom License" })],
      NO_OPT_INS,
    );
    expect(decision?.blockedReasons.join(" ")).toContain("--allow-rule-license 'Custom License'");
  });
});

describe("evaluateRuleSources registry gate", () => {
  it("blocks a registry pack without --allow-live-registry even when its license is accepted", () => {
    const [decision] = evaluateRuleSources([registrySource()], {
      allowedRuleLicenses: ["Semgrep-Rules-License-1.0"],
      allowLiveRegistry: false,
    });
    expect(decision?.allowed).toBe(false);
    expect(decision?.blockedReasons.join(" ")).toContain("--allow-live-registry");
  });

  it("does not let operatorAcceptedLicense bypass the registry gate", () => {
    const [decision] = evaluateRuleSources(
      [registrySource({ operatorAcceptedLicense: true })],
      NO_OPT_INS,
    );
    expect(decision?.allowed).toBe(false);
    expect(decision?.blockedReasons.join(" ")).toContain("--allow-live-registry");
  });

  it("never gates local sources on --allow-live-registry", () => {
    const [decision] = evaluateRuleSources([localSource({ license: "MIT" })], NO_OPT_INS);
    expect(decision?.allowed).toBe(true);
  });
});

describe("evaluateRuleSources local-config existence gate", () => {
  function withExistence(localConfigExists: (config: string) => boolean): RuleSourceGateOptions {
    return { ...NO_OPT_INS, localConfigExists };
  }

  it("blocks a permissive local source whose config path was not found", () => {
    const [decision] = evaluateRuleSources(
      [localSource({ license: "MIT" })],
      withExistence(() => false),
    );
    expect(decision?.allowed).toBe(false);
    expect(decision?.blockedReasons.join(" ")).toContain("was not found");
  });

  it("allows a permissive local source whose config path exists", () => {
    const [decision] = evaluateRuleSources(
      [localSource({ license: "MIT" })],
      withExistence((config) => config === "/rules/rules.yml"),
    );
    expect(decision?.allowed).toBe(true);
  });

  it("lists the missing-config reason ahead of the license reason", () => {
    const [decision] = evaluateRuleSources(
      [localSource()],
      withExistence(() => false),
    );
    expect(decision?.blockedReasons).toHaveLength(2);
    expect(decision?.blockedReasons[0]).toContain("was not found");
    expect(decision?.blockedReasons[1]).toContain("--allow-rule-license");
  });

  it("never existence-gates registry packs", () => {
    const [decision] = evaluateRuleSources([registrySource()], {
      allowedRuleLicenses: ["Semgrep-Rules-License-1.0"],
      allowLiveRegistry: true,
      localConfigExists: () => false,
    });
    expect(decision?.allowed).toBe(true);
  });

  it("skips existence gating when no probe is supplied (pure license/registry gate)", () => {
    const [decision] = evaluateRuleSources([localSource({ license: "MIT" })], NO_OPT_INS);
    expect(decision?.allowed).toBe(true);
  });
});

describe("evaluateRuleSources known pack defaults", () => {
  it("defaults known registry packs to the Semgrep Rules License", () => {
    for (const pack of [
      "p/default",
      "p/security-audit",
      "p/secrets",
      "p/r2c-best-practices",
      "p/typescript",
      "p/nodejs",
      "p/react",
      "p/ai-best-practices",
    ]) {
      const [decision] = evaluateRuleSources([registrySource({ pack })], NO_OPT_INS);
      expect(decision?.license).toBe("Semgrep-Rules-License-1.0");
      expect(decision?.licenseClass).toBe("restricted-internal-use");
    }
  });

  it("defaults p/trailofbits to AGPL-3.0", () => {
    const [decision] = evaluateRuleSources([registrySource({ pack: "p/trailofbits" })], NO_OPT_INS);
    expect(decision?.license).toBe("AGPL-3.0");
    expect(decision?.licenseClass).toBe("copyleft");
  });

  it("prefers the curated license over a declared one for a known pack", () => {
    // A manifest relabeling p/default as MIT must not downgrade its class past
    // the informed-consent gate: --allow-live-registry alone stays insufficient.
    const [decision] = evaluateRuleSources(
      [registrySource({ pack: "p/default", license: "MIT" })],
      { allowedRuleLicenses: [], allowLiveRegistry: true },
    );
    expect(decision?.license).toBe("Semgrep-Rules-License-1.0");
    expect(decision?.licenseClass).toBe("restricted-internal-use");
    expect(decision?.allowed).toBe(false);
    expect(decision?.blockedReasons.join(" ")).toContain("Semgrep-Rules-License-1.0");
  });

  it("classifies an unknown pack as unknown unless the manifest supplies a license", () => {
    const unknown = evaluateRuleSources([registrySource({ pack: "p/mystery" })], NO_OPT_INS);
    expect(unknown[0]?.license).toBeNull();
    expect(unknown[0]?.licenseClass).toBe("unknown");

    const declared = evaluateRuleSources(
      [registrySource({ pack: "p/mystery", license: "MIT" })],
      NO_OPT_INS,
    );
    expect(declared[0]?.license).toBe("MIT");
    expect(declared[0]?.licenseClass).toBe("permissive");
  });
});

describe("evaluateRuleSources reproducibility", () => {
  it("marks a local source pinned by commit or sha256 as reproducible", () => {
    const byCommit = evaluateRuleSources(
      [localSource({ license: "MIT", commit: "abc123" })],
      NO_OPT_INS,
    );
    expect(byCommit[0]?.reproducible).toBe(true);

    const byHash = evaluateRuleSources(
      [localSource({ license: "MIT", sha256: "deadbeef" })],
      NO_OPT_INS,
    );
    expect(byHash[0]?.reproducible).toBe(true);
  });

  it("marks an unpinned local source as not reproducible", () => {
    const [decision] = evaluateRuleSources([localSource({ license: "MIT" })], NO_OPT_INS);
    expect(decision?.reproducible).toBe(false);
  });

  it("marks live-registry sources as not reproducible", () => {
    const [decision] = evaluateRuleSources([registrySource()], {
      allowedRuleLicenses: ["Semgrep-Rules-License-1.0"],
      allowLiveRegistry: true,
    });
    expect(decision?.reproducible).toBe(false);
  });
});

describe("parseRuleSourceManifest", () => {
  it("parses the documented manifest shape with both source kinds", () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sources: [
        {
          kind: "local",
          config: "/home/alice/rules/patched-codes-semgrep-rules.yml",
          license: "MIT",
          sourceUrl: "https://github.com/patched-codes/semgrep-rules",
          commit: "abc123",
          sha256: "feedface",
        },
        {
          kind: "registry-pack",
          pack: "p/default",
          license: "Semgrep-Rules-License-1.0",
          operatorAcceptedLicense: true,
        },
      ],
    });
    expect(parseRuleSourceManifest(manifest, MANIFEST_PATH)).toEqual([
      {
        kind: "local",
        config: "/home/alice/rules/patched-codes-semgrep-rules.yml",
        license: "MIT",
        sourceUrl: "https://github.com/patched-codes/semgrep-rules",
        commit: "abc123",
        sha256: "feedface",
        operatorAcceptedLicense: false,
      },
      {
        kind: "registry-pack",
        pack: "p/default",
        license: "Semgrep-Rules-License-1.0",
        operatorAcceptedLicense: true,
      },
    ]);
  });

  it("defaults optional local-source fields", () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sources: [{ kind: "local", config: "rules.yml" }],
    });
    expect(parseRuleSourceManifest(manifest, MANIFEST_PATH)).toEqual([
      {
        kind: "local",
        config: "rules.yml",
        license: null,
        sourceUrl: null,
        commit: null,
        sha256: null,
        operatorAcceptedLicense: false,
      },
    ]);
  });

  it("rejects invalid JSON as a usage/config error", () => {
    expect(() => parseRuleSourceManifest("{nope", MANIFEST_PATH)).toThrow(DriftAiError);
    expect(() => parseRuleSourceManifest("{nope", MANIFEST_PATH)).toThrow(/not valid JSON/u);
  });

  it("rejects a non-object manifest root", () => {
    expect(() => parseRuleSourceManifest("[]", MANIFEST_PATH)).toThrow(/must be a JSON object/u);
  });

  it("rejects a missing or unsupported schemaVersion", () => {
    expect(() => parseRuleSourceManifest(JSON.stringify({ sources: [] }), MANIFEST_PATH)).toThrow(
      /schemaVersion 1/u,
    );
    expect(() =>
      parseRuleSourceManifest(JSON.stringify({ schemaVersion: 2, sources: [] }), MANIFEST_PATH),
    ).toThrow(/schemaVersion 1/u);
  });

  it("rejects a manifest without a sources array", () => {
    expect(() =>
      parseRuleSourceManifest(JSON.stringify({ schemaVersion: 1 }), MANIFEST_PATH),
    ).toThrow(/'sources' array/u);
  });

  it("rejects a source with an unknown kind", () => {
    const manifest = JSON.stringify({ schemaVersion: 1, sources: [{ kind: "remote" }] });
    expect(() => parseRuleSourceManifest(manifest, MANIFEST_PATH)).toThrow(
      /'sources\[0\]\.kind' must be 'local' or 'registry-pack'/u,
    );
  });

  it("rejects a local source without a config path", () => {
    const manifest = JSON.stringify({ schemaVersion: 1, sources: [{ kind: "local" }] });
    expect(() => parseRuleSourceManifest(manifest, MANIFEST_PATH)).toThrow(
      /'sources\[0\]\.config' must be a non-empty string/u,
    );
  });

  it("rejects remote configs in local manifest sources", () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sources: [{ kind: "local", config: "p/default", license: "MIT" }],
    });
    expect(() => parseRuleSourceManifest(manifest, MANIFEST_PATH)).toThrow(
      /must be a local rule file or directory/u,
    );
  });

  it("rejects a registry source without a pack", () => {
    const manifest = JSON.stringify({ schemaVersion: 1, sources: [{ kind: "registry-pack" }] });
    expect(() => parseRuleSourceManifest(manifest, MANIFEST_PATH)).toThrow(
      /'sources\[0\]\.pack' must be a non-empty string/u,
    );
  });

  it("rejects a registry source whose pack is not p/<pack> shaped", () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sources: [{ kind: "registry-pack", pack: "auto" }],
    });
    expect(() => parseRuleSourceManifest(manifest, MANIFEST_PATH)).toThrow(
      /'sources\[0\]\.pack' must be a Semgrep registry pack of the form p\/<pack>/u,
    );
  });

  it("rejects a known pack whose declared license conflicts with the curated default", () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sources: [{ kind: "registry-pack", pack: "p/default", license: "MIT" }],
    });
    expect(() => parseRuleSourceManifest(manifest, MANIFEST_PATH)).toThrow(
      /'sources\[0\]\.license' \(MIT\) conflicts with the known license for p\/default \(Semgrep-Rules-License-1\.0\)/u,
    );
  });

  it("accepts a known pack that declares its curated license, case-insensitively", () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sources: [
        { kind: "registry-pack", pack: "p/default", license: "semgrep-rules-license-1.0" },
        { kind: "registry-pack", pack: "p/mystery", license: "MIT" },
      ],
    });
    const sources = parseRuleSourceManifest(manifest, MANIFEST_PATH);
    expect(sources).toHaveLength(2);
  });

  it("rejects unknown source keys", () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sources: [{ kind: "local", config: "rules.yml", licence: "MIT" }],
    });
    expect(() => parseRuleSourceManifest(manifest, MANIFEST_PATH)).toThrow(
      /unknown key 'licence'/u,
    );
  });

  it("rejects a non-boolean operatorAcceptedLicense", () => {
    const manifest = JSON.stringify({
      schemaVersion: 1,
      sources: [{ kind: "local", config: "rules.yml", operatorAcceptedLicense: "yes" }],
    });
    expect(() => parseRuleSourceManifest(manifest, MANIFEST_PATH)).toThrow(
      /'sources\[0\]\.operatorAcceptedLicense' must be a boolean/u,
    );
  });

  it("names the manifest path in parse errors", () => {
    expect(() => parseRuleSourceManifest("{nope", MANIFEST_PATH)).toThrow(MANIFEST_PATH);
  });
});

describe("createCliRuleSourceCollector", () => {
  it("pairs each --rule-license with the most recent --semgrep-config", () => {
    const collector = createCliRuleSourceCollector();
    collector.addConfig("/rules/a.yml");
    collector.addLicense("MIT");
    collector.addConfig("/rules/b.yml");
    collector.addLicense("AGPL-3.0");
    expect(collector.sources()).toEqual([
      localSource({ config: "/rules/a.yml", license: "MIT" }),
      localSource({ config: "/rules/b.yml", license: "AGPL-3.0" }),
    ]);
  });

  it("leaves a config without --rule-license unlicensed (blocked by the unknown gate)", () => {
    const collector = createCliRuleSourceCollector();
    collector.addConfig("/rules/a.yml");
    expect(collector.sources()).toEqual([localSource({ config: "/rules/a.yml" })]);
  });

  it("rejects --rule-license before any --semgrep-config", () => {
    const collector = createCliRuleSourceCollector();
    expect(() => {
      collector.addLicense("MIT");
    }).toThrow(DriftAiError);
    expect(() => {
      collector.addLicense("MIT");
    }).toThrow(/--rule-license requires a preceding/u);
  });

  it("rejects a second --rule-license for the same --semgrep-config", () => {
    const collector = createCliRuleSourceCollector();
    collector.addConfig("/rules/a.yml");
    collector.addLicense("MIT");
    expect(() => {
      collector.addLicense("ISC");
    }).toThrow(/already has a --rule-license/u);
  });

  it("collects registry packs", () => {
    const collector = createCliRuleSourceCollector();
    collector.addPack("p/default");
    expect(collector.sources()).toEqual([registrySource()]);
  });

  it("rejects auto, registry-rule, URL, and local-path values on the pack path", () => {
    const collector = createCliRuleSourceCollector();
    for (const value of ["auto", "r/generic.secrets", "./rules.yml", "https://example.invalid/p"]) {
      expect(() => {
        collector.addPack(value);
      }).toThrow(/must be a Semgrep registry pack of the form p\/<pack>/u);
    }
  });

  it("rejects registry and URL configs on the local collector path", () => {
    const collector = createCliRuleSourceCollector();
    expect(() => {
      collector.addConfig("p/default");
    }).toThrow(/must be a local rule file or directory/u);
    expect(() => {
      collector.addConfig("https://example.invalid/rules.yml");
    }).toThrow(/must be a local rule file or directory/u);
  });
});
