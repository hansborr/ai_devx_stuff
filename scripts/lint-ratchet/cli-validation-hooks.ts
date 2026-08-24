import { ratchetRegressionReasonFailure } from "@musi/lint-ratchet/kernel/recovery-command.js";

import { UsageError } from "./cli-errors.js";
import type { CommandHandlerArgs } from "./cli-handler-types.js";

export function validateNoCrossFields(_state: CommandHandlerArgs): void {}

export function validateUpdateCrossFields(state: CommandHandlerArgs): void {
  const { allowWorse, reason, retireRatchetId, acceptDifferentOptions } = state;
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

export function validateProposeCrossFields(state: CommandHandlerArgs): void {
  if (state.mode === "propose") {
    if (
      state.proposeRuleId === undefined ||
      state.proposeFiles === undefined ||
      state.proposeFiles.length === 0
    ) {
      throw new UsageError("--propose requires <ruleId> <glob...>");
    }
  } else if (
    state.proposeRuleId !== undefined ||
    state.proposeFiles !== undefined ||
    state.proposePluginModule !== undefined ||
    state.proposePluginExport !== undefined ||
    state.proposeParserProfile !== undefined
  ) {
    throw new UsageError("--propose is only valid in propose mode");
  }
}

export function validateEditCheckTargetsCrossFields(state: CommandHandlerArgs): void {
  if (state.mode === "edit-check-targets") {
    if (state.editCheckTargets === undefined || state.editCheckTargets.length === 0) {
      throw new UsageError("--edit-check-targets requires at least one path");
    }
  } else if (state.editCheckTargets !== undefined) {
    throw new UsageError("--edit-check-targets is only valid in edit-check-targets mode");
  }
}

export function validateEditCheckCrossFields(state: CommandHandlerArgs): void {
  if (state.mode === "edit-check" && state.targetsFile === undefined) {
    throw new UsageError("--edit-check requires --targets-file");
  }
}

export function validateEditRatchetCoverageCrossFields(state: CommandHandlerArgs): void {
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
