import type { ParsedArgs, ParsedArgsState } from "./cli-types.js";

function trendArgs(state: ParsedArgsState): Partial<ParsedArgs> {
  return {
    ...(state.trendSince === undefined ? {} : { trendSince: state.trendSince }),
    ...(state.trendMax === undefined ? {} : { trendMax: state.trendMax }),
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

export function buildParsedArgs(state: ParsedArgsState): ParsedArgs {
  return {
    mode: state.mode,
    allowWorse: state.allowWorse,
    ...(state.reason === undefined ? {} : { reason: state.reason }),
    ...(state.retireRatchetId === undefined ? {} : { retireRatchetId: state.retireRatchetId }),
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
