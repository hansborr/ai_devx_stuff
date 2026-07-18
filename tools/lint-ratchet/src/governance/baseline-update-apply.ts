import { appendFileSync, existsSync, readFileSync } from "node:fs";

import { writeFileAtomicallySync } from "@musi/lint-ratchet/kernel/atomic-write.js";
import {
  decideLintRatchetUpdate,
  type LintRatchetBaseline,
  type LintRatchetUpdateDecision,
  type LintRatchetUpdateOptions,
  parseLintRatchetBaselineStructure,
} from "@musi/lint-ratchet/kernel/baseline.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import {
  type LintRatchetEngineContext,
  relativeToRepoRoot,
} from "@musi/lint-ratchet/kernel/engine-context.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics.js";

import type { LintRatchetDebtLogEntry } from "./debt-log-schema.js";
import {
  appendValidatedDebtLogEntries,
  buildLintRatchetCoverageShrinkLogEntry,
  buildLintRatchetDebtLogEntry,
  buildLintRatchetMetricMigrationLogEntry,
  buildLintRatchetRetirementLogEntry,
  type DebtLogAppendDeps,
} from "./debt-log-write.js";
import { WorseBaselineError } from "./errors.js";

// Filesystem seam for the update path. Narrowed to the exact call shapes used so
// tests can inject trivial fakes; defaults forward to node:fs.
export interface RunUpdateDeps extends DebtLogAppendDeps {
  readonly writeFileAtomicallySync: (path: string, data: string) => void;
}

const defaultRunUpdateDeps: RunUpdateDeps = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  appendFileSync: (path, data) => {
    appendFileSync(path, data);
  },
  writeFileAtomicallySync: (path, data) => {
    writeFileAtomicallySync(path, data);
  },
};

export type ApplyLintRatchetUpdateOptions = LintRatchetUpdateOptions;

export interface ApplyLintRatchetUpdateParams {
  readonly context: LintRatchetEngineContext;
  readonly generated: LintRatchetBaseline;
  readonly rendered: string;
  readonly registry: readonly LintRatchetConfig[];
  readonly options: ApplyLintRatchetUpdateOptions;
  readonly currentFindingCount: number;
  readonly deps?: RunUpdateDeps;
}

function hasAcceptedDebt(decision: LintRatchetUpdateDecision): boolean {
  return decision.regressions.length > 0 || decision.orphanRemovals.length > 0;
}

function parseCommittedStructure(text: string): LintRatchetBaseline {
  const parsed = parseLintRatchetBaselineStructure(text);
  if (parsed.baseline === undefined) throw new ConfigError(parsed.failures.join("\n"));
  return parsed.baseline;
}

// Gate the committed baseline against the generated one: throw on a refused worse
// update, surface warnings, and return the decision (undefined on a first-ever
// baseline, where there is nothing to compare and nothing to log).
function gateCommittedBaseline(
  deps: RunUpdateDeps,
  params: ApplyLintRatchetUpdateParams,
): LintRatchetUpdateDecision | undefined {
  if (!deps.existsSync(params.context.baselinePath)) return undefined;
  const decision = decideLintRatchetUpdate(
    parseCommittedStructure(deps.readFileSync(params.context.baselinePath, "utf8")),
    params.generated,
    params.registry,
    params.options,
  );
  if (!decision.allowed) throw new WorseBaselineError(decision.failures.join("\n"));
  for (const warning of decision.warnings) console.error(`⚠ ${warning}`);
  return decision;
}

// Record the debt log for an accepted worse update; nothing is logged for a
// first-ever baseline, a routine tighten, or an improvement lock. Returns true
// when a required debt-log entry is appended or already present at the tail.
function debtLogEntriesForUpdate(
  decision: LintRatchetUpdateDecision | undefined,
  options: ApplyLintRatchetUpdateOptions,
): readonly LintRatchetDebtLogEntry[] {
  if (decision === undefined) return [];
  const reason = options.reason?.trim() ?? "";
  const acceptedDebt =
    options.allowWorse && hasAcceptedDebt(decision)
      ? [buildLintRatchetDebtLogEntry(decision, reason)]
      : [];
  const coverageShrinks = options.allowWorse
    ? decision.coverageShrinks.map((shrink) =>
        buildLintRatchetCoverageShrinkLogEntry(shrink, reason),
      )
    : [];
  // A metric migration is gated on its own rationale (not --allow-worse):
  // --migration-reason when given, falling back to --reason for a
  // migration-only update. Accepted-debt and coverage-shrink records keep
  // --reason — both are --allow-worse-gated debt acceptances.
  const migrationReason = options.migrationReason?.trim() ?? reason;
  const metricMigrations = decision.metricMigrations.map((migration) =>
    buildLintRatchetMetricMigrationLogEntry(migration, migrationReason),
  );
  const retirement =
    decision.retiredRatchetId === undefined
      ? []
      : [
          buildLintRatchetRetirementLogEntry(
            decision.retiredRatchetId,
            decision.retirementOptionsAttestation,
          ),
        ];
  return [...acceptedDebt, ...coverageShrinks, ...metricMigrations, ...retirement];
}

function updateIncludesAcceptedDebt(
  decision: LintRatchetUpdateDecision | undefined,
  options: ApplyLintRatchetUpdateOptions,
): boolean {
  if (decision === undefined || !options.allowWorse) return false;
  return hasAcceptedDebt(decision) || decision.coverageShrinks.length > 0;
}

// Owns the update-apply sequence: gate the committed baseline, return early on a
// true no-op, then (for an accepted worse update) record the debt log BEFORE the
// single final baseline write.
export function applyLintRatchetUpdate(params: ApplyLintRatchetUpdateParams): boolean {
  const deps = params.deps ?? defaultRunUpdateDeps;
  const { repoRoot, baselinePath, debtLogPath } = params.context;
  // Name the files the way this repo committed them so an adopter with a custom
  // baseline/debt-log filename sees their own paths, not the engine defaults.
  const baselineName = relativeToRepoRoot(repoRoot, baselinePath);
  const debtLogName = relativeToRepoRoot(repoRoot, debtLogPath);
  const decision = gateCommittedBaseline(deps, params);

  const currentText = deps.existsSync(baselinePath) ? deps.readFileSync(baselinePath, "utf8") : "";
  if (currentText === params.rendered) {
    console.error(
      `lint:ratchet:update OK — ${baselineName} already matches ${String(params.currentFindingCount)} current finding(s).`,
    );
    return false;
  }

  const debtLogEntries = debtLogEntriesForUpdate(decision, params.options);
  const appendedDebtLog = appendValidatedDebtLogEntries(debtLogEntries, debtLogPath, deps);
  const includesAcceptedDebt = updateIncludesAcceptedDebt(decision, params.options);
  const recordedDebt = appendedDebtLog && includesAcceptedDebt;
  deps.writeFileAtomicallySync(baselinePath, params.rendered);
  console.error(
    `lint:ratchet:update OK — wrote ${baselineName} with ${String(params.currentFindingCount)} current finding(s).` +
      (recordedDebt ? ` Recorded the debt acceptance in ${debtLogName}.` : ""),
  );
  if (decision?.retiredRatchetId !== undefined) {
    console.error(
      `Retired ratchet ${decision.retiredRatchetId} (was at zero findings); coverage promoted, retirement recorded in ${debtLogName}. No debt logged.`,
    );
  }
  if (decision !== undefined && decision.metricMigrations.length > 0) {
    const migrated = decision.metricMigrations.map((migration) => migration.ratchetId).join(", ");
    console.error(`Recorded metric migration for ${migrated} in ${debtLogName}. No debt logged.`);
  }
  return recordedDebt;
}
