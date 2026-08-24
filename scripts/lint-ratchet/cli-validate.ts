import { COMMAND_CATALOG } from "./cli-catalog.js";
import { UsageError } from "./cli-errors.js";
import type { ParsedArgs, ParsedArgsState } from "./cli-types.js";

// The mutual-exclusion / cross-field validation layer for the ratchet CLI. The
// token walker in cli.ts fills a ParsedArgsState; these checks enforce the
// relationships between fields (mode-scoping, required companions) and then
// assemble the immutable ParsedArgs, dropping absent optionals.

function validateCatalogState(state: ParsedArgsState): void {
  for (const { mode, options, validate } of COMMAND_CATALOG) {
    for (const option of options) {
      const value = state[option.stateKey];
      const present = typeof value === "boolean" ? value : value !== undefined;
      if (present && state.mode !== mode) throw new UsageError(option.scopeMessage);
    }
    validate(state);
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
    ...(state.proposePluginModule === undefined
      ? {}
      : { proposePluginModule: state.proposePluginModule }),
    ...(state.proposePluginExport === undefined
      ? {}
      : { proposePluginExport: state.proposePluginExport }),
    ...(state.proposeParserProfile === undefined
      ? {}
      : { proposeParserProfile: state.proposeParserProfile }),
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
  validateCatalogState(state);
  return assembleParsedArgs(state);
}
