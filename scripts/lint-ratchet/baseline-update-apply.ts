import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  type LintRatchetBaseline,
  type LintRatchetUpdateDecision,
  decideLintRatchetUpdate,
  parseLintRatchetBaselineStructure,
} from "../lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "../lint-ratchet-config.js";
import { ConfigError } from "../lint-ratchet-metrics.js";
import {
  appendValidatedDebtLogEntry,
  buildLintRatchetDebtLogEntry,
  type DebtLogAppendDeps,
} from "./debt-log-write.js";
import { WorseBaselineError } from "./errors.js";
import { BASELINE_FILENAME, baselinePath, DEBT_LOG_FILENAME, debtLogPath } from "./paths.js";

// Filesystem seam for the update path. Narrowed to the exact call shapes used so
// tests can inject trivial fakes; defaults forward to node:fs.
export interface RunUpdateDeps extends DebtLogAppendDeps {
  readonly writeFileSync: (path: string, data: string) => void;
}

export const defaultRunUpdateDeps: RunUpdateDeps = {
  existsSync: (path) => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  appendFileSync: (path, data) => {
    appendFileSync(path, data);
  },
  writeFileSync: (path, data) => {
    writeFileSync(path, data);
  },
};

export interface ApplyLintRatchetUpdateOptions {
  readonly allowWorse: boolean;
  readonly reason?: string;
}

export interface ApplyLintRatchetUpdateParams {
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
  if (!deps.existsSync(baselinePath)) return undefined;
  const decision = decideLintRatchetUpdate(
    parseCommittedStructure(deps.readFileSync(baselinePath, "utf8")),
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
function maybeRecordDebtLog(
  decision: LintRatchetUpdateDecision | undefined,
  options: ApplyLintRatchetUpdateOptions,
  deps: RunUpdateDeps,
): boolean {
  if (decision === undefined || !options.allowWorse || !hasAcceptedDebt(decision)) return false;
  const entry = buildLintRatchetDebtLogEntry(decision, options.reason?.trim() ?? "");
  appendValidatedDebtLogEntry(entry, debtLogPath, deps);
  return true;
}

// Owns the update-apply sequence: gate the committed baseline, return early on a
// true no-op, then (for an accepted worse update) record the debt log BEFORE the
// single final baseline write.
export function applyLintRatchetUpdate(params: ApplyLintRatchetUpdateParams): boolean {
  const deps = params.deps ?? defaultRunUpdateDeps;
  const decision = gateCommittedBaseline(deps, params);

  const currentText = deps.existsSync(baselinePath) ? deps.readFileSync(baselinePath, "utf8") : "";
  if (currentText === params.rendered) {
    console.error(
      `lint:ratchet:update OK — ${BASELINE_FILENAME} already matches ${String(params.currentFindingCount)} current finding(s).`,
    );
    return false;
  }

  const recordedDebt = maybeRecordDebtLog(decision, params.options, deps);
  deps.writeFileSync(baselinePath, params.rendered);
  console.error(
    `lint:ratchet:update OK — wrote ${BASELINE_FILENAME} with ${String(params.currentFindingCount)} current finding(s).` +
      (recordedDebt ? ` Recorded the debt acceptance in ${DEBT_LOG_FILENAME}.` : ""),
  );
  return recordedDebt;
}
