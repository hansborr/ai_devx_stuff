// Prototype advisory surface for the task-43a env/define evaluator (backlog task
// 43). It renders the evaluator's condition inventory as STALE-BRANCH review
// candidates: under an explicit, operator-supplied env/define matrix, which guard
// conditions are predicted to fold to a constant, which branch that leaves
// unreachable, and whether a static bundler/minifier would be expected to erase it.
//
// This module owns only the candidate framing. The AST walk, value evaluation, and
// branch prediction all come from the task-43a evaluator; nothing here re-derives
// expression logic. Rows route through the task-39 prototype advisory contract
// (`kind: "advisory"`, `lane: "prototype"`, no `findings`, no WARN/FIX), so a noisy
// or unresolved prediction can never be mistaken for a promoted finding.

import { plural, positiveInt } from "./advisory-format-helpers.js";
import type {
  EnvDefineAssumedValue,
  EnvDefineAssumption,
  EnvDefineBranchPrediction,
  EnvDefineConditionEvidence,
  EnvDefineConditionReadEvidence,
  EnvDefineInventory,
  EnvDefineMatrix,
  EnvDefineReadKind,
} from "./env-define-types.js";
import {
  appendPrototypeSection,
  buildPrototypeAdvisory,
  formatPrototypeAdvisoryJson,
  formatPrototypeHeader,
  type PrototypeAdvisory,
  type PrototypeCap,
  type PrototypePrerequisite,
  type PrototypeSection,
} from "./prototype-advisory.js";

export const ENV_BRANCHES_SUBCOMMAND = "env-branches";
export const DEFAULT_ENV_BRANCHES_TOP = 50;

// Bundler/minifier static-elimination expectation for a predicted-constant condition.
// Classified SYNTACTICALLY over every env/define read present in the condition (both
// operands of an `&&`/`||`, even one a short circuit makes irrelevant), so it errs
// conservative: it never labels a branch erasable that a bundler would leave standing.
//  - "static-define": every read in the condition is a define / import.meta.env value
//    that define-substituting bundlers (esbuild define, Vite define, webpack
//    DefinePlugin) inline, so the constant folds and the unreachable branch is
//    dead-code-eliminated;
//  - "env-inlining-dependent": at least one read is a process.env / Bun.env lookup, which
//    a bundler folds only when explicitly configured to inline it (esbuild define,
//    EnvironmentPlugin); otherwise the branch survives to runtime. A define that
//    short-circuits past such a read still lands here (the read is syntactically present),
//    which under-claims rather than over-claims erasure;
//  - "not-static": the branch is unresolved, so there is no constant to fold.
export type EnvBranchEraseExpectation = "static-define" | "env-inlining-dependent" | "not-static";

// The branch the prediction marks unreachable: "else" when the guard is always truthy,
// "then" when always falsy, null when unresolved. These name the guarded vs. fallback
// paths of the condition; they are not a claim about a specific if/ternary node shape.
export type EnvBranchDeadBranch = "then" | "else" | null;

export type EnvBranchReadEvidence = {
  readonly kind: EnvDefineReadKind;
  readonly key: string;
  readonly text: string;
  readonly assumedValue: EnvDefineAssumedValue | undefined;
  readonly valueSource: string | undefined;
};

export type EnvBranchCandidateRow = {
  readonly rank: number;
  readonly file: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly condition: string;
  readonly predictedBranch: EnvDefineBranchPrediction;
  readonly deadBranch: EnvBranchDeadBranch;
  readonly eraseExpectation: EnvBranchEraseExpectation;
  readonly reads: readonly EnvBranchReadEvidence[];
};

export type EnvBranchSection = PrototypeSection<EnvBranchCandidateRow>;
export type EnvBranchesAdvisory = PrototypeAdvisory<EnvBranchSection>;

export type EnvBranchesAdvisoryOptions = {
  readonly top?: number;
};

const RESOLVED_CANDIDATE_KIND = "resolved env/define branch predictions";
const UNRESOLVED_CANDIDATE_KIND = "unresolved env/define conditions";
const RESOLVED_EMPTY_REASON =
  "no env/define condition resolved to a constant branch under the matrix.";
const UNRESOLVED_EMPTY_REASON = "no unresolved env/define conditions detected.";

// Reads a typical define-substituting bundler inlines statically; a process.env /
// Bun.env read is folded only when the bundler is configured to inline env.
const STATIC_INLINE_KINDS: ReadonlySet<EnvDefineReadKind> = new Set<EnvDefineReadKind>([
  "define",
  "import.meta.env",
]);

// An env/define matrix with no usable assumption in any table. Without one, every
// condition resolves to "unknown", so the advisory discloses the missing matrix as an
// unmet prerequisite instead of emitting a wall of unresolved rows.
export function isEnvDefineMatrixEmpty(matrix: EnvDefineMatrix): boolean {
  return matrixTables(matrix).every((table) => Object.keys(table).length === 0);
}

export function buildEnvBranchesAdvisory(
  inventory: EnvDefineInventory,
  matrix: EnvDefineMatrix,
  options: EnvBranchesAdvisoryOptions = {},
): EnvBranchesAdvisory {
  const top = positiveInt(options.top, DEFAULT_ENV_BRANCHES_TOP);
  if (isEnvDefineMatrixEmpty(matrix)) return noMatrixAdvisory(top);

  const rows = inventory.conditions.map(rowForCondition);
  const resolved = rows.filter((row) => row.predictedBranch !== "unknown");
  const unresolved = rows.filter((row) => row.predictedBranch === "unknown");
  const sections = [
    section(RESOLVED_CANDIDATE_KIND, resolved, top, RESOLVED_EMPTY_REASON),
    section(UNRESOLVED_CANDIDATE_KIND, unresolved, top, UNRESOLVED_EMPTY_REASON),
  ];
  return buildPrototypeAdvisory({
    subcommand: ENV_BRANCHES_SUBCOMMAND,
    prerequisites: [matrixPrerequisite(matrix)],
    caps: [rowCap(top, sections)],
    sections,
  });
}

export function formatEnvBranchesAdvisoryJson(advisory: EnvBranchesAdvisory): string {
  return formatPrototypeAdvisoryJson(advisory);
}

export function formatEnvBranchesAdvisoryText(advisory: EnvBranchesAdvisory): string {
  const lines = formatPrototypeHeader(advisory);
  for (const advisorySection of advisory.sections) {
    lines.push("");
    appendPrototypeSection(lines, advisorySection, renderRow);
  }
  return lines.join("\n");
}

function noMatrixAdvisory(top: number): EnvBranchesAdvisory {
  return buildPrototypeAdvisory<EnvBranchSection>({
    subcommand: ENV_BRANCHES_SUBCOMMAND,
    prerequisites: [
      {
        name: "env/define matrix",
        satisfied: false,
        detail: "no env/define assumptions configured; add envDefine.* to drift-ai config",
      },
    ],
    caps: [rowCap(top, [])],
    sections: [
      emptySection(RESOLVED_CANDIDATE_KIND, "no env/define matrix configured."),
      emptySection(UNRESOLVED_CANDIDATE_KIND, "no env/define matrix configured."),
    ],
  });
}

function section(
  candidateKind: string,
  rows: readonly Omit<EnvBranchCandidateRow, "rank">[],
  top: number,
  emptyReason: string,
): EnvBranchSection {
  const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    candidateKind,
    totalCandidates: ranked.length,
    emptyReason: ranked.length === 0 ? emptyReason : null,
    entries: ranked.slice(0, top),
  };
}

function emptySection(candidateKind: string, emptyReason: string): EnvBranchSection {
  return { candidateKind, totalCandidates: 0, emptyReason, entries: [] };
}

function rowForCondition(
  condition: EnvDefineConditionEvidence,
): Omit<EnvBranchCandidateRow, "rank"> {
  return {
    file: condition.filePath,
    startLine: condition.startLine,
    startColumn: condition.startColumn,
    condition: condition.text,
    predictedBranch: condition.predictedBranch,
    deadBranch: deadBranchFor(condition.predictedBranch),
    eraseExpectation: eraseExpectationFor(condition),
    reads: condition.reads.map(readEvidence),
  };
}

function deadBranchFor(prediction: EnvDefineBranchPrediction): EnvBranchDeadBranch {
  if (prediction === "truthy") return "else";
  if (prediction === "falsy") return "then";
  return null;
}

function eraseExpectationFor(condition: EnvDefineConditionEvidence): EnvBranchEraseExpectation {
  if (condition.predictedBranch === "unknown") return "not-static";
  // A condition row always carries at least one read (the evaluator only records a
  // condition when it found an env/define read inside it), so `every` is meaningful.
  return condition.reads.every((read) => STATIC_INLINE_KINDS.has(read.kind))
    ? "static-define"
    : "env-inlining-dependent";
}

function readEvidence(read: EnvDefineConditionReadEvidence): EnvBranchReadEvidence {
  return {
    kind: read.kind,
    key: read.key,
    text: read.text,
    assumedValue: read.assumedValue,
    valueSource: read.valueSource,
  };
}

function matrixPrerequisite(matrix: EnvDefineMatrix): PrototypePrerequisite {
  const tables = matrixTables(matrix).filter((table) => Object.keys(table).length > 0);
  const assumptions = tables.reduce((total, table) => total + Object.keys(table).length, 0);
  return {
    name: "env/define matrix",
    satisfied: true,
    detail: `${assumptions} configured ${plural("assumption", assumptions)} across ${
      tables.length
    } ${plural("table", tables.length)}`,
  };
}

function rowCap(top: number, sections: readonly EnvBranchSection[]): PrototypeCap {
  const hitCount = sections.filter(
    (advisorySection) => advisorySection.totalCandidates > advisorySection.entries.length,
  ).length;
  return {
    label: "rows per section",
    limit: top,
    hit: hitCount > 0,
    detail:
      hitCount > 0
        ? `${hitCount} ${plural("section", hitCount)} had more than ${top} candidate rows`
        : null,
  };
}

function renderRow(row: EnvBranchCandidateRow): readonly string[] {
  return [
    `#${row.rank} ${row.file}:${row.startLine}:${row.startColumn} ${formatPrediction(row)}`,
    `condition: ${row.condition}`,
    ...row.reads.map(formatReadLine),
  ];
}

function formatPrediction(row: EnvBranchCandidateRow): string {
  if (row.predictedBranch === "unknown" || row.deadBranch === null) {
    return "predicted unknown (matrix insufficient; no dead branch); bundler fold not-static";
  }
  return `predicted ${row.predictedBranch} -> ${row.deadBranch}-branch unreachable; bundler fold ${row.eraseExpectation}`;
}

function formatReadLine(read: EnvBranchReadEvidence): string {
  const value =
    read.assumedValue === undefined ? "unresolved" : formatAssumedValue(read.assumedValue);
  const source = read.valueSource ?? "no matrix value";
  return `read ${read.kind} ${read.key} = ${value} (${source})`;
}

function formatAssumedValue(value: EnvDefineAssumedValue): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function matrixTables(
  matrix: EnvDefineMatrix,
): readonly Readonly<Record<string, EnvDefineAssumption>>[] {
  return [
    matrix.env,
    matrix.processEnv,
    matrix.importMetaEnv,
    matrix.bunEnv,
    matrix.defines,
  ].filter((table): table is Readonly<Record<string, EnvDefineAssumption>> => table !== undefined);
}
