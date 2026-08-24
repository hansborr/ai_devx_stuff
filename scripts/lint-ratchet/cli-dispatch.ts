import { deriveModeHandlers, derivePreflightTiers, type Mode } from "./cli-catalog.js";
import type { CommandHandler, LintRatchetRuntimeOptions } from "./cli-handler-types.js";
import type { PreflightHandler, PreflightTier } from "./cli-handler-types.js";
import type { ParsedArgs } from "./cli-types.js";
import { PREFLIGHT_HANDLERS } from "./modes.js";

export type { LintRatchetRuntimeOptions } from "./cli-handler-types.js";

const MODE_HANDLERS: Readonly<Record<Mode, CommandHandler>> = deriveModeHandlers();
const MODE_PREFLIGHT_TIERS = derivePreflightTiers();

export interface LintRatchetDispatch {
  readonly modeHandlers: Readonly<Record<Mode, CommandHandler>>;
  readonly preflightHandlers: Readonly<Record<PreflightTier, PreflightHandler>>;
}

const DEFAULT_DISPATCH: LintRatchetDispatch = {
  modeHandlers: MODE_HANDLERS,
  preflightHandlers: PREFLIGHT_HANDLERS,
};

export async function runLintRatchetCli(
  args: ParsedArgs,
  options: LintRatchetRuntimeOptions = {},
  dispatch: LintRatchetDispatch = DEFAULT_DISPATCH,
): Promise<void> {
  await dispatch.preflightHandlers[MODE_PREFLIGHT_TIERS[args.mode]]();
  await dispatch.modeHandlers[args.mode](args, options);
}
