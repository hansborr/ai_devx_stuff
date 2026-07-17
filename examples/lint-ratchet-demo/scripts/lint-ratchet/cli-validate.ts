import { UsageError } from "./cli-errors.js";
import { hasDebtAccountingOptions, type ParsedArgs, type ParsedArgsState } from "./cli-types.js";
import { ratchetRegressionReasonFailure } from "./recovery-command.js";

// The mutual-exclusion / cross-field validation layer for the ratchet CLI. The
// token walker in cli.ts fills a ParsedArgsState; these checks enforce the
// relationships between fields (mode-scoping, required companions) and then
// assemble the immutable ParsedArgs, dropping absent optionals.

function assertUpdateOnlyFlag(present: boolean, mode: ParsedArgs["mode"], flag: string): void {
  if (present && mode !== "update") throw new UsageError(`${flag} is only valid with --update`);
}

function assertUpdateArgs(state: ParsedArgsState): void {
  const { mode, allowWorse, reason, retireRatchetId, acceptDifferentOptions } = state;
  assertUpdateOnlyFlag(allowWorse, mode, "--allow-worse");
  assertUpdateOnlyFlag(reason !== undefined, mode, "--reason");
  assertUpdateOnlyFlag(state.migrationReason !== undefined, mode, "--migration-reason");
  assertUpdateOnlyFlag(retireRatchetId !== undefined, mode, "--retire-ratchet");
  assertUpdateOnlyFlag(acceptDifferentOptions === true, mode, "--accept-different-options");
  // Retirement (proven promotion) and --allow-worse (accepted debt) are opposite
  // dispositions of a removed ratchet; forcing the operator to pick one keeps a
  // proven retirement from also writing a debt-log acceptance.
  if (retireRatchetId !== undefined && allowWorse) {
    throw new UsageError("--retire-ratchet and --allow-worse are mutually exclusive");
  }
  if (acceptDifferentOptions === true && retireRatchetId === undefined) {
    throw new UsageError("--accept-different-options requires --retire-ratchet <id>");
  }
  if (acceptDifferentOptions === true && reason === undefined) {
    throw new UsageError("--accept-different-options requires --reason <why>");
  }
  if (allowWorse) {
    const failure = ratchetRegressionReasonFailure(reason);
    if (failure !== undefined) throw new UsageError(failure);
  }
}

function assertDebtAccountingArgs(state: ParsedArgsState): void {
  if (!hasDebtAccountingOptions(state) || state.mode === "check-debt-accounting") return;
  throw new UsageError("--staged and --base-ref are only valid with --check-debt-accounting");
}

function assertProposeArgs(state: ParsedArgsState): void {
  if (state.mode === "propose") {
    if (
      state.proposeRuleId === undefined ||
      state.proposeFiles === undefined ||
      state.proposeFiles.length === 0
    ) {
      throw new UsageError("--propose requires <ruleId> <glob...>");
    }
  } else if (state.proposeRuleId !== undefined || state.proposeFiles !== undefined) {
    throw new UsageError("--propose is only valid in propose mode");
  }
}

function assertSummaryArgs(state: ParsedArgsState): void {
  if (state.summaryByDirectoryDepth !== undefined && state.mode !== "summary") {
    throw new UsageError("--by-directory is only valid with --summary");
  }
}

function assertTrendArgs(state: ParsedArgsState): void {
  if (state.trendSince !== undefined && state.mode !== "trend") {
    throw new UsageError("--since is only valid with --trend");
  }
  if (state.trendMax !== undefined && state.mode !== "trend") {
    throw new UsageError("--max is only valid with --trend");
  }
  if (state.trendAll !== undefined && state.mode !== "trend") {
    throw new UsageError("--all is only valid with --trend");
  }
}

function assertEditCheckArgs(state: ParsedArgsState): void {
  if (state.mode === "edit-check-targets") {
    if (state.editCheckTargets === undefined || state.editCheckTargets.length === 0) {
      throw new UsageError("--edit-check-targets requires at least one path");
    }
  } else if (state.editCheckTargets !== undefined) {
    throw new UsageError("--edit-check-targets is only valid in edit-check-targets mode");
  }
  if (state.mode === "edit-check") {
    if (state.targetsFile === undefined)
      throw new UsageError("--edit-check requires --targets-file");
  } else if (state.targetsFile !== undefined) {
    throw new UsageError("--targets-file is only valid with --edit-check");
  }
}

function assertEditRatchetCoverageArgs(state: ParsedArgsState): void {
  if (state.mode === "edit-ratchet-coverage") {
    if (
      state.editRatchetCoveragePaths === undefined ||
      state.editRatchetCoveragePaths.length === 0
    ) {
      throw new UsageError("--edit-ratchet-coverage requires at least one path");
    }
  } else if (state.editRatchetCoveragePaths !== undefined) {
    throw new UsageError("--edit-ratchet-coverage is only valid in edit-ratchet-coverage mode");
  }
}

function reasonArgs(state: ParsedArgsState): Partial<ParsedArgs> {
  return {
    ...(state.reason === undefined ? {} : { reason: state.reason }),
    ...(state.migrationReason === undefined ? {} : { migrationReason: state.migrationReason }),
  };
}

function trendArgs(state: ParsedArgsState): Partial<ParsedArgs> {
  return {
    ...(state.trendSince === undefined ? {} : { trendSince: state.trendSince }),
    ...(state.trendMax === undefined ? {} : { trendMax: state.trendMax }),
    ...(state.trendAll === undefined ? {} : { trendAll: state.trendAll }),
  };
}

function proposeArgs(state: ParsedArgsState): Partial<ParsedArgs> {
  return {
    ...(state.proposeRuleId === undefined ? {} : { proposeRuleId: state.proposeRuleId }),
    ...(state.proposeFiles === undefined ? {} : { proposeFiles: state.proposeFiles }),
    ...(state.proposeIgnores === undefined ? {} : { proposeIgnores: state.proposeIgnores }),
    ...(state.proposeMetric === undefined ? {} : { proposeMetric: state.proposeMetric }),
    ...(state.proposeRuleOptionsJson === undefined
      ? {}
      : { proposeRuleOptionsJson: state.proposeRuleOptionsJson }),
  };
}

function assembleParsedArgs(state: ParsedArgsState): ParsedArgs {
  return {
    mode: state.mode,
    allowWorse: state.allowWorse,
    ...reasonArgs(state),
    ...(state.retireRatchetId === undefined ? {} : { retireRatchetId: state.retireRatchetId }),
    ...(state.acceptDifferentOptions === undefined
      ? {}
      : { acceptDifferentOptions: state.acceptDifferentOptions }),
    ...(state.debtAccountingStaged === undefined
      ? {}
      : { debtAccountingStaged: state.debtAccountingStaged }),
    ...(state.debtAccountingBaseRef === undefined
      ? {}
      : { debtAccountingBaseRef: state.debtAccountingBaseRef }),
    ...(state.summaryByDirectoryDepth === undefined
      ? {}
      : { summaryByDirectoryDepth: state.summaryByDirectoryDepth }),
    ...trendArgs(state),
    ...proposeArgs(state),
    ...(state.editCheckTargets === undefined ? {} : { editCheckTargets: state.editCheckTargets }),
    ...(state.targetsFile === undefined ? {} : { targetsFile: state.targetsFile }),
    ...(state.editRatchetCoveragePaths === undefined
      ? {}
      : { editRatchetCoveragePaths: state.editRatchetCoveragePaths }),
  };
}

// Run every cross-field rule, then assemble the immutable result.
export function validateAndBuild(state: ParsedArgsState): ParsedArgs {
  assertUpdateArgs(state);
  assertDebtAccountingArgs(state);
  assertProposeArgs(state);
  assertSummaryArgs(state);
  assertTrendArgs(state);
  assertEditCheckArgs(state);
  assertEditRatchetCoverageArgs(state);
  return assembleParsedArgs(state);
}
