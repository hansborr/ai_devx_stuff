// Demo registry — the one file an adopter writes by hand.
//
// The rest of scripts/lint-ratchet/ is the portable runtime, copied verbatim
// from the manifest (scripts/lint-ratchet/portable-manifest.json in the parent
// repo) and never edited. This file is deliberately empty of any host-project
// imports: it declares the ratchet types and one real ratchet. Copy it, swap in
// your own rule and file scope, and you have a working gate. See ../../README.md.

import type { LintRatchetZeroBaselineDisposition } from "./zero-baseline-types.js";

type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

// `no-new` is the only mode the runtime accepts: the copied baseline parser
// (baseline-parse.ts) rejects anything else, so a wider type here would let an
// adopter configure a mode that type-checks but fails baseline validation.
export type LintRatchetMode = "no-new";
export type LintRatchetMetric = "complexity-severity" | "effective-line-count" | "message-count";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export interface LintRatchetCoreSource {
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
  readonly repairKind: LintRatchetRepairKind;
  readonly principle: string;
  readonly allowEmpty?: boolean;
  readonly typeAwareProject?: string;
  readonly zeroBaselineDisposition?: LintRatchetZeroBaselineDisposition;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetCoreSource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

// This demo ratchets a local rule, so no third-party plugins are allow-listed.
// Adding an `eslint-plugin-*` ratchet means installing the plugin and declaring
// it here (pluginModule + ruleNamespace).
export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  [];

// One real ratchet: freeze the existing demo-local `no-console-log` findings
// under src/ so new ones fail the gate while the current two drain.
// `metric: "message-count"` counts one finding per reported violation.
export const lintRatchets = [
  {
    id: "ratchet/no-console-src",
    ruleId: "local/no-console-log",
    source: { kind: "local" },
    files: ["src/**/*.ts"],
    ignores: ["**/dist/**", "**/node_modules/**"],
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    repairKind: "manual",
    principle:
      "Freeze the accepted console.log inventory under src/ so new calls fail the gate while the existing ones drain incrementally.",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason:
        "this demo keeps local/no-console-log as a ratchet floor rather than promoting it to normal lint, to show the ratchet-only lifecycle disposition",
    },
  },
] as const satisfies readonly LintRatchetConfig[];
