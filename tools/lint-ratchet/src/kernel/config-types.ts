import type { LintRatchetZeroBaselineDisposition } from "./zero-baseline-types.js";

type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

// Two never-earning modes have been trimmed from the surface. `ratchet-down`
// (drive a floor downward over time) was advertised but never implemented — a
// copier would design against a mode that does not exist. `report-only` (collect
// a rule and emit info diagnostics without a committed floor) was implemented but
// no live registry entry ever used it, and `--propose` already covers the
// discovery use case. Both are off the public surface: `no-new` is the only mode
// a ratchet entry or committed baseline may carry. A future mode adds itself back
// here and teaches the comparison logic its semantics; the grouped baseline
// spec stays deliberately narrow (no committed baseline ever carried either
// removed mode, since registry validation always rejected them before write).
export type LintRatchetMode = "no-new";
export type LintRatchetMetric = "complexity-severity" | "effective-line-count" | "message-count";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
type LintRatchetPluginExport = "default" | "plugin";

interface LintRatchetLocalSource {
  readonly kind: "local";
}

interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

interface LintRatchetCoreSource {
  readonly kind: "core";
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource
  | LintRatchetCoreSource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly metric: LintRatchetMetric;
  // Single source of truth for the harness-controls doc "Principle" line. The
  // generated harness-controls.md re-projects this from the registry (the same
  // way lint-rule principles flow from meta.docs); ratchet entries in
  // harness.controls.json must NOT restate it. Distinct from
  // zeroBaselineDisposition.reason, which answers a different question (why this
  // disposition when the ratchet reaches zero findings).
  readonly principle: string;
  readonly allowEmpty?: boolean;
  readonly zeroBaselineDisposition?: LintRatchetZeroBaselineDisposition;
}

// Local sources use minimal-ts. Third-party and core sources may opt into
// type-aware-ts and select an explicit tsconfig; otherwise generated configs use
// the portable `projectService: true` default.
export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
      readonly typeAwareProject?: never;
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource | LintRatchetCoreSource;
      readonly parserProfile: "minimal-ts";
      readonly typeAwareProject?: never;
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource | LintRatchetCoreSource;
      readonly parserProfile: "type-aware-ts";
      readonly typeAwareProject?: string;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}
