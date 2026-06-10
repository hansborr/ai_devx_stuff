// Rule-source declarations, license classification, and the operator opt-in gate
// for the `semgrep-candidates` prototype subcommand (semgrep plan, slice 1).
//
// Semgrep rules are externally supplied and license-classed: permissive sources run
// by default, everything else (Semgrep Rules License, copyleft, unknown) needs an
// explicit operator opt-in, and live registry packs additionally need
// `--allow-live-registry` because they fetch mutable network-hosted rules. The gate
// produces DATA (per-source allow/block decisions with reasons), not exceptions: a
// valid-but-blocked source becomes an unmet `semgrep rule source` prerequisite in
// the advisory (exit 0). Only a malformed manifest (`semgrep-rule-manifest.ts`) or
// an invalid CLI pairing is a usage/config error — DriftAiError, which
// `runPrototypeCommand` maps to exit 2.

import { DriftAiError } from "./errors.js";

export type RuleLicenseClass = "permissive" | "restricted-internal-use" | "copyleft" | "unknown";

// An operator-managed local rule config (a file or directory Semgrep can take as
// `--config`). Remote configs/registry entries must use a gated source kind.
// `commit`/`sha256` pin the source: calibration runs are only comparable across
// runs when every source is pinned (see plan decision 3).
export type SemgrepLocalRuleSource = {
  readonly kind: "local";
  readonly config: string;
  readonly license: string | null;
  readonly sourceUrl: string | null;
  readonly commit: string | null;
  readonly sha256: string | null;
  readonly operatorAcceptedLicense: boolean;
};

// A live Semgrep registry pack (`p/...`). Mutable and network-hosted, so it is
// exploration-only: never reproducible, and gated behind `--allow-live-registry`.
export type SemgrepRegistryRuleSource = {
  readonly kind: "registry-pack";
  readonly pack: string;
  readonly license: string | null;
  readonly operatorAcceptedLicense: boolean;
};

export type SemgrepRuleSource = SemgrepLocalRuleSource | SemgrepRegistryRuleSource;

export const SEMGREP_RULES_LICENSE = "Semgrep-Rules-License-1.0";

// License classes per the plan's table. Identifiers match case-insensitively so an
// operator typing `mit` or `agpl-3.0` lands in the intended class; anything not
// listed is `unknown`, which fails safe (blocked without an explicit opt-in).
const PERMISSIVE_LICENSES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0"];
const RESTRICTED_INTERNAL_USE_LICENSES = [SEMGREP_RULES_LICENSE];
const COPYLEFT_LICENSES = ["AGPL-3.0", "GPL-3.0"];

const LICENSE_CLASS_BY_ID: ReadonlyMap<string, RuleLicenseClass> = new Map([
  ...PERMISSIVE_LICENSES.map((id): [string, RuleLicenseClass] => [normalize(id), "permissive"]),
  ...RESTRICTED_INTERNAL_USE_LICENSES.map((id): [string, RuleLicenseClass] => [
    normalize(id),
    "restricted-internal-use",
  ]),
  ...COPYLEFT_LICENSES.map((id): [string, RuleLicenseClass] => [normalize(id), "copyleft"]),
]);

// Curated registry-pack licenses (plan decision 3). For listed packs the curated
// license always wins: a manifest relabeling `p/default` as MIT must not
// downgrade its class past the informed-consent gate (the manifest parser
// additionally rejects such a conflict as a manifest defect). Only an unlisted
// pack takes its license from the manifest; consent for a known restricted pack
// goes through `operatorAcceptedLicense` or `--allow-rule-license`.
const KNOWN_PACK_LICENSES: ReadonlyMap<string, string> = new Map([
  ["p/default", SEMGREP_RULES_LICENSE],
  ["p/security-audit", SEMGREP_RULES_LICENSE],
  ["p/secrets", SEMGREP_RULES_LICENSE],
  ["p/r2c-best-practices", SEMGREP_RULES_LICENSE],
  ["p/typescript", SEMGREP_RULES_LICENSE],
  ["p/nodejs", SEMGREP_RULES_LICENSE],
  ["p/react", SEMGREP_RULES_LICENSE],
  ["p/ai-best-practices", SEMGREP_RULES_LICENSE],
  ["p/trailofbits", "AGPL-3.0"],
]);

// The `--allow-rule-license` token that opts in sources with NO declared license.
// It deliberately does NOT match a source declaring an unrecognized license string;
// that source needs its exact license allowed so the opt-in stays informed.
export const UNKNOWN_LICENSE_ALLOW_TOKEN = "unknown";

export function readLocalRuleConfig(value: string, sourceName: string): string {
  const config = value.trim();
  if (config.length === 0) throw new DriftAiError(`${sourceName} requires a local path.`);
  const remoteKind = remoteSemgrepConfigKind(config);
  if (remoteKind !== null) {
    throw new DriftAiError(
      `${sourceName} must be a local rule file or directory, not a ${remoteKind}; ` +
        "use --registry-pack for registry packs or a local checked-out rule config.",
    );
  }
  return config;
}

// Registry packs must keep the documented `p/<pack>` shape: any other value
// (`auto`, `r/...` rules, URLs, local paths) would ride the registry-pack label
// straight into `--config` and bypass the local-config rejection above.
export function readRegistryPack(value: string, sourceName: string): string {
  const pack = value.trim();
  if (!/^p\/.+$/u.test(pack)) {
    throw new DriftAiError(
      `${sourceName} must be a Semgrep registry pack of the form p/<pack> (got '${pack}').`,
    );
  }
  return pack;
}

export function classifyRuleLicense(license: string | null): RuleLicenseClass {
  if (license === null) return "unknown";
  return LICENSE_CLASS_BY_ID.get(normalize(license)) ?? "unknown";
}

export type RuleSourceGateOptions = {
  // `--allow-rule-license` values (license ids, or `unknown` for undeclared).
  readonly allowedRuleLicenses: readonly string[];
  // `--allow-live-registry`.
  readonly allowLiveRegistry: boolean;
  // Local-config existence probe, already bound to the repo root by the caller
  // (the command owns file IO). Omitted skips existence gating, for pure
  // license/registry-gate callers like unit tests.
  readonly localConfigExists?: (config: string) => boolean;
};

export type RuleSourceDecision = {
  readonly source: SemgrepRuleSource;
  // Effective license: the source's declaration, else the known-pack default.
  readonly license: string | null;
  readonly licenseClass: RuleLicenseClass;
  // Pinned local sources (commit and/or sha256) are reproducible; live registry
  // packs and unpinned local sources are not. Slice 3 stamps this into provenance.
  readonly reproducible: boolean;
  readonly allowed: boolean;
  readonly blockedReasons: readonly string[];
};

// Apply the license and registry gates to every declared source. Blocked sources
// are returned with reasons, never thrown: the caller renders them as unmet
// prerequisites so the run still exits 0 under the prototype advisory contract.
export function evaluateRuleSources(
  sources: readonly SemgrepRuleSource[],
  options: RuleSourceGateOptions,
): readonly RuleSourceDecision[] {
  const allowedLicenses = new Set(options.allowedRuleLicenses.map(normalize));
  return sources.map((source) => {
    const license = effectiveLicense(source);
    const licenseClass = classifyRuleLicense(license);
    const blockedReasons = [
      ...missingLocalConfigReasons(source, options.localConfigExists),
      ...licenseBlockReasons(source, license, licenseClass, allowedLicenses),
      ...registryBlockReasons(source, options.allowLiveRegistry),
    ];
    return {
      source,
      license,
      licenseClass,
      reproducible: isReproducible(source),
      allowed: blockedReasons.length === 0,
      blockedReasons,
    };
  });
}

function effectiveLicense(source: SemgrepRuleSource): string | null {
  if (source.kind === "registry-pack") {
    return KNOWN_PACK_LICENSES.get(source.pack) ?? source.license;
  }
  return source.license;
}

// The curated license a declared registry-pack license contradicts, or null
// when the pack is unlisted or the declaration matches (case-insensitively).
// The manifest parser rejects conflicts so a mislabeled manifest fails loudly
// instead of silently classifying under the curated license anyway.
export function conflictingKnownPackLicense(pack: string, license: string): string | null {
  const known = KNOWN_PACK_LICENSES.get(pack);
  if (known === undefined || normalize(known) === normalize(license)) return null;
  return known;
}

// A declared local config that is not on disk can never supply rules, and
// forwarding it would fail the whole semgrep run for every other source; gated
// here it reads as an unmet prerequisite (the documented contract), not a late
// run failure that the advisory misattributes to the engine.
function missingLocalConfigReasons(
  source: SemgrepRuleSource,
  localConfigExists: ((config: string) => boolean) | undefined,
): string[] {
  if (source.kind !== "local" || localConfigExists === undefined) return [];
  if (localConfigExists(source.config)) return [];
  return ["local rule config path was not found (relative paths resolve from the repo root)"];
}

function licenseBlockReasons(
  source: SemgrepRuleSource,
  license: string | null,
  licenseClass: RuleLicenseClass,
  allowedLicenses: ReadonlySet<string>,
): string[] {
  if (licenseClass === "permissive") return [];
  if (source.operatorAcceptedLicense) return [];
  const allowToken = license ?? UNKNOWN_LICENSE_ALLOW_TOKEN;
  if (license !== null && allowedLicenses.has(normalize(license))) return [];
  if (license === null && allowedLicenses.has(UNKNOWN_LICENSE_ALLOW_TOKEN)) return [];
  const described = license === null ? "no declared rule license" : `rule license ${license}`;
  return [
    `${described} (${licenseClass} class) is blocked by default; ` +
      `pass --allow-rule-license ${shellQuote(allowToken)} to opt in`,
  ];
}

function registryBlockReasons(source: SemgrepRuleSource, allowLiveRegistry: boolean): string[] {
  if (source.kind !== "registry-pack" || allowLiveRegistry) return [];
  return [
    `live registry pack '${source.pack}' fetches mutable network-hosted rules; ` +
      "pass --allow-live-registry to opt in",
  ];
}

function isReproducible(source: SemgrepRuleSource): boolean {
  return source.kind === "local" && (source.commit !== null || source.sha256 !== null);
}

export type CliRuleSourceCollector = {
  // `--semgrep-config <path>`: starts a new local source.
  readonly addConfig: (config: string) => void;
  // `--rule-license <license>`: licenses the most recent `--semgrep-config`.
  readonly addLicense: (license: string) => void;
  // `--registry-pack <pack>`: adds a live registry source.
  readonly addPack: (pack: string) => void;
  readonly sources: () => readonly SemgrepRuleSource[];
};

// Accumulate CLI-declared rule sources in argv order so each `--rule-license`
// pairs with the `--semgrep-config` it follows. Mispairings are usage errors
// (DriftAiError -> exit 2); a config left unlicensed parses fine and then fails
// the unknown-license gate, which keeps "forgot the license" visible as a blocked
// source rather than a hard CLI failure.
export function createCliRuleSourceCollector(): CliRuleSourceCollector {
  const collected: SemgrepRuleSource[] = [];
  let openConfig: { config: string; license: string | null } | null = null;

  const flushOpenConfig = (): void => {
    if (openConfig === null) return;
    collected.push({
      kind: "local",
      config: openConfig.config,
      license: openConfig.license,
      sourceUrl: null,
      commit: null,
      sha256: null,
      operatorAcceptedLicense: false,
    });
    openConfig = null;
  };

  return {
    addConfig: (config) => {
      flushOpenConfig();
      openConfig = { config: readLocalRuleConfig(config, "--semgrep-config"), license: null };
    },
    addLicense: (license) => {
      if (openConfig === null) {
        throw new DriftAiError("--rule-license requires a preceding --semgrep-config.");
      }
      if (openConfig.license !== null) {
        throw new DriftAiError(
          `--semgrep-config ${openConfig.config} already has a --rule-license.`,
        );
      }
      openConfig = { config: openConfig.config, license };
    },
    addPack: (pack) => {
      flushOpenConfig();
      collected.push({
        kind: "registry-pack",
        pack: readRegistryPack(pack, "--registry-pack"),
        license: null,
        operatorAcceptedLicense: false,
      });
    },
    sources: () => {
      flushOpenConfig();
      return [...collected];
    },
  };
}

function normalize(license: string): string {
  return license.trim().toLowerCase();
}

function remoteSemgrepConfigKind(config: string): string | null {
  if (config.toLowerCase() === "auto") return "Semgrep registry auto config";
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(config)) return "remote URL";
  if (/^(?:p|r)\/.+/u.test(config)) return "Semgrep registry entry";
  return null;
}

function shellQuote(value: string): string {
  if (/^[\w./:@+-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, "'\\''")}'`;
}
