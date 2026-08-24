// Shared vocabulary of the registration explain view: the versioned report
// envelope, the explicitly typed selector, the per-relation match record, and
// the injectable authority surfaces. The query model that populates these
// lives in registration-explain-matchers.ts, the public entry points in
// registration-explain.ts, the renderers in registration-explain-render.ts,
// and the CLI argument grammar in registration-explain-cli.ts.

import type { FixtureClosureEntry } from "./generated-surface-dependencies.js";
import type { GeneratedSurfaceRecord } from "./generated-surfaces.js";
import type { HarnessManifest } from "./harness-manifest-schema.js";

/** Version of the JSON envelope; bump on any breaking shape change. */
export const EXPLAIN_FORMAT_VERSION = 1;

export type ExplainSelectorKind = "path" | "control" | "script";

export interface ExplainSelector {
  readonly kind: ExplainSelectorKind;
  readonly value: string;
}

export interface ExplainControlSummary {
  readonly id: string;
  readonly kind: string;
  /** Required nonblank manifest fields; present on every parsed control. */
  readonly source: string;
  readonly invocation: string;
  readonly script?: string;
  readonly pairedGuide?: string;
}

export interface ExplainGeneratedSummary {
  readonly checkScript: string;
  readonly refreshScript: string;
  readonly triggerPaths: readonly string[];
  readonly outputPaths: readonly string[];
  readonly fixturePaths: readonly string[];
}

export interface ExplainHookSummary {
  readonly event?: string;
  readonly surface?: string;
  readonly body?: string;
}

export interface ExplainSlotSummary {
  readonly consumer: string;
  readonly name: string;
  readonly script: string;
  readonly dynamic?: string;
  readonly condition?: string;
}

export interface ExplainSmokeSelection {
  readonly test: string;
  readonly subject?: string;
}

interface ExplainPackageScript {
  readonly name: string;
  readonly command: string;
}

/**
 * One reported relation. Scope note for JSON consumers, by field:
 * `smokeSelections` is control-identity-scoped — it appears only on match
 * kinds whose `matched` value is the owning control's identity
 * (control-source, control-id, control-invocation), never on
 * control-paired-guide, hook-body, or hook-harness-command matches.
 * `hook` follows the same rule plus the two hook-path kinds it describes
 * (hook-body, hook-harness-command). `generated` is record-scoped: beyond the
 * control-identity kinds it also rides on every generated-* match (trigger,
 * output, fixture-extra, fixture-dependency, check-script, refresh-script,
 * classified-script), whose `matched` value is the path or script entry that
 * produced the match. `verifySlots` rides on the control-identity kinds and
 * the four generated path kinds (trigger, output, fixture-extra,
 * fixture-dependency); script-name selections report slot joins as separate
 * verify-slot matches instead.
 */
export interface ExplainMatch {
  readonly reason: string;
  /** The declared identifier or path entry that produced this match. */
  readonly matched: string;
  readonly control?: ExplainControlSummary;
  readonly packageScript?: ExplainPackageScript;
  readonly generated?: ExplainGeneratedSummary;
  readonly hook?: ExplainHookSummary;
  readonly slot?: ExplainSlotSummary;
  readonly verifySlots?: readonly ExplainSlotSummary[];
  readonly smoke?: ExplainSmokeSelection;
  readonly smokeSelections?: readonly ExplainSmokeSelection[];
}

export interface ExplainReport {
  readonly explainVersion: typeof EXPLAIN_FORMAT_VERSION;
  readonly selector: ExplainSelector;
  /** An empty array is authoritative: the live state declares no relation. */
  readonly matches: readonly ExplainMatch[];
}

/**
 * The walked smoke-fixture copy closure, injectable so fixtures can drive the
 * model: per-owner import-closure entries plus the paths a fixture synthesizes
 * itself (which therefore satisfy closure edges without being copied).
 */
export interface ExplainFixtureClosure {
  readonly entries: readonly FixtureClosureEntry[];
  readonly synthesizedPaths: readonly string[];
}

/** Path-policy authorities, injectable so fixtures can drive the model. */
export interface ExplainPathPolicy {
  readonly smokeSubjects: Readonly<Record<string, readonly string[]>>;
  readonly smokeTestNames: readonly string[];
  readonly metadataFreshnessTestName: string;
  readonly isSmokeTestPath: (path: string) => boolean;
}

export interface ExplainAuthorities {
  readonly manifest: HarnessManifest;
  readonly scripts: ReadonlyMap<string, string>;
  readonly generatedSurfaces: readonly GeneratedSurfaceRecord[];
  readonly pathPolicy: ExplainPathPolicy;
  readonly fixtureClosure: ExplainFixtureClosure;
}
