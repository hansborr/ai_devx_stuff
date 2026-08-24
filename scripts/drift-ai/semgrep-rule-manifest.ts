// Parser for the `--rule-source-manifest` document of the `semgrep-candidates`
// prototype subcommand (semgrep plan, slice 1). The manifest is the structured way
// to declare several rule sources at once, with per-source license and pinning
// metadata; the parsed sources flow into the license/registry gate in
// `semgrep-rule-sources.ts`. The strict-key arrays below are compiler-proven
// against those source-arm types. This bespoke parser remains intentional:
// every defect here (invalid JSON, wrong schema version, malformed source) is a
// path-aware usage/config error whose tested contract is DriftAiError, which
// `runPrototypeCommand` maps to exit 2 — unlike a valid-but-blocked source, which
// stays an unmet prerequisite at exit 0.

import { isRecord } from "../lib/records.js";
import type { UnknownRecord } from "./config-readers.js";
import { DriftAiError } from "./errors.js";
import {
  conflictingKnownPackLicense,
  readLocalRuleConfig,
  readRegistryPack,
  type SemgrepLocalRuleSource,
  type SemgrepRegistryRuleSource,
  type SemgrepRuleSource,
} from "./semgrep-rule-sources.js";

const MANIFEST_SCHEMA_VERSION = 1;
const LOCAL_SOURCE_KEY_SET = {
  kind: true,
  config: true,
  license: true,
  sourceUrl: true,
  commit: true,
  sha256: true,
  operatorAcceptedLicense: true,
} as const satisfies Record<keyof SemgrepLocalRuleSource, true>;
const LOCAL_SOURCE_KEYS = Object.keys(
  LOCAL_SOURCE_KEY_SET,
) as (keyof typeof LOCAL_SOURCE_KEY_SET)[]; // type-assertion-boundary: interop - Object.keys widens known object keys to string[]

const REGISTRY_SOURCE_KEY_SET = {
  kind: true,
  pack: true,
  license: true,
  operatorAcceptedLicense: true,
} as const satisfies Record<keyof SemgrepRegistryRuleSource, true>;
const REGISTRY_SOURCE_KEYS = Object.keys(
  REGISTRY_SOURCE_KEY_SET,
) as (keyof typeof REGISTRY_SOURCE_KEY_SET)[]; // type-assertion-boundary: interop - Object.keys widens known object keys to string[]

// Parse a `--rule-source-manifest` document (already read from disk; the command
// owns file IO).
export function parseRuleSourceManifest(
  jsonText: string,
  manifestPath: string,
): readonly SemgrepRuleSource[] {
  const root = parseManifestJson(jsonText, manifestPath);
  if (root.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw manifestError(
      manifestPath,
      `requires schemaVersion ${MANIFEST_SCHEMA_VERSION} (got ${JSON.stringify(root.schemaVersion)})`,
    );
  }
  const sources = root.sources;
  if (!Array.isArray(sources)) {
    throw manifestError(manifestPath, "requires a 'sources' array");
  }
  return sources.map((raw, index) => parseManifestSource(raw, index, manifestPath));
}

function parseManifestJson(jsonText: string, manifestPath: string): UnknownRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw manifestError(manifestPath, `is not valid JSON: ${detail}`);
  }
  if (!isRecord(parsed)) throw manifestError(manifestPath, "must be a JSON object");
  return parsed;
}

function parseManifestSource(raw: unknown, index: number, manifestPath: string): SemgrepRuleSource {
  const keyPath = `sources[${index}]`;
  if (!isRecord(raw)) throw manifestError(manifestPath, `'${keyPath}' must be an object`);
  if (raw.kind === "local") return parseLocalSource(raw, keyPath, manifestPath);
  if (raw.kind === "registry-pack") return parseRegistrySource(raw, keyPath, manifestPath);
  throw manifestError(manifestPath, `'${keyPath}.kind' must be 'local' or 'registry-pack'`);
}

function parseLocalSource(
  raw: UnknownRecord,
  keyPath: string,
  manifestPath: string,
): SemgrepLocalRuleSource {
  assertManifestKeys(raw, LOCAL_SOURCE_KEYS, keyPath, manifestPath);
  return {
    kind: "local",
    config: readManifestLocalRuleConfig(raw, keyPath, manifestPath),
    license: readOptionalString(raw, "license", keyPath, manifestPath),
    sourceUrl: readOptionalString(raw, "sourceUrl", keyPath, manifestPath),
    commit: readOptionalString(raw, "commit", keyPath, manifestPath),
    sha256: readOptionalString(raw, "sha256", keyPath, manifestPath),
    operatorAcceptedLicense: readOptionalBoolean(
      raw,
      "operatorAcceptedLicense",
      keyPath,
      manifestPath,
    ),
  };
}

function readManifestLocalRuleConfig(
  raw: UnknownRecord,
  keyPath: string,
  manifestPath: string,
): string {
  const config = readRequiredString(raw, "config", keyPath, manifestPath);
  try {
    return readLocalRuleConfig(config, `'${keyPath}.config'`);
  } catch (err) {
    if (err instanceof DriftAiError) {
      throw manifestError(manifestPath, trimSentencePeriod(err.message));
    }
    throw err;
  }
}

function parseRegistrySource(
  raw: UnknownRecord,
  keyPath: string,
  manifestPath: string,
): SemgrepRegistryRuleSource {
  assertManifestKeys(raw, REGISTRY_SOURCE_KEYS, keyPath, manifestPath);
  const pack = readManifestRegistryPack(raw, keyPath, manifestPath);
  return {
    kind: "registry-pack",
    pack,
    license: readManifestPackLicense(raw, pack, keyPath, manifestPath),
    operatorAcceptedLicense: readOptionalBoolean(
      raw,
      "operatorAcceptedLicense",
      keyPath,
      manifestPath,
    ),
  };
}

// A declared license that contradicts the curated known-pack license is a
// manifest defect, not an override: the gate classifies known packs under the
// curated license either way, so accepting the relabel would only let a
// mislabeled manifest read as consent. Consent belongs in
// `operatorAcceptedLicense` or `--allow-rule-license`.
function readManifestPackLicense(
  raw: UnknownRecord,
  pack: string,
  keyPath: string,
  manifestPath: string,
): string | null {
  const license = readOptionalString(raw, "license", keyPath, manifestPath);
  if (license === null) return null;
  const known = conflictingKnownPackLicense(pack, license);
  if (known !== null) {
    throw manifestError(
      manifestPath,
      `'${keyPath}.license' (${license}) conflicts with the known license for ${pack} ` +
        `(${known}); omit the license, or accept the known license via ` +
        "operatorAcceptedLicense or --allow-rule-license",
    );
  }
  return license;
}

// Same wrapping as readManifestLocalRuleConfig: the shared shape check throws a
// CLI-worded DriftAiError, re-thrown here with the manifest path and key path.
function readManifestRegistryPack(
  raw: UnknownRecord,
  keyPath: string,
  manifestPath: string,
): string {
  const pack = readRequiredString(raw, "pack", keyPath, manifestPath);
  try {
    return readRegistryPack(pack, `'${keyPath}.pack'`);
  } catch (err) {
    if (err instanceof DriftAiError) {
      throw manifestError(manifestPath, trimSentencePeriod(err.message));
    }
    throw err;
  }
}

function assertManifestKeys(
  raw: UnknownRecord,
  allowed: readonly string[],
  keyPath: string,
  manifestPath: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(raw)) {
    if (!allowedSet.has(key)) {
      throw manifestError(manifestPath, `'${keyPath}' has unknown key '${key}'`);
    }
  }
}

function readRequiredString(
  raw: UnknownRecord,
  key: string,
  keyPath: string,
  manifestPath: string,
): string {
  const value = raw[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw manifestError(manifestPath, `'${keyPath}.${key}' must be a non-empty string`);
  }
  return value;
}

function readOptionalString(
  raw: UnknownRecord,
  key: string,
  keyPath: string,
  manifestPath: string,
): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw manifestError(manifestPath, `'${keyPath}.${key}' must be a non-empty string`);
  }
  return value;
}

function readOptionalBoolean(
  raw: UnknownRecord,
  key: string,
  keyPath: string,
  manifestPath: string,
): boolean {
  const value = raw[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw manifestError(manifestPath, `'${keyPath}.${key}' must be a boolean`);
  }
  return value;
}

function manifestError(manifestPath: string, problem: string): DriftAiError {
  return new DriftAiError(`semgrep rule-source manifest '${manifestPath}' ${problem}.`);
}

function trimSentencePeriod(value: string): string {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}
