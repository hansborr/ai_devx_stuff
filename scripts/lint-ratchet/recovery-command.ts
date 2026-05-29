// Single source of truth for the lint:ratchet baseline-update recovery commands
// surfaced in diagnostics findings, the report footer, and CI. The bare form is
// correct only when there is no regression to accept; once a regression is
// present the updater refuses unless `--allow-worse --reason` is supplied (see
// decideLintRatchetUpdate in baseline-update.ts).

export const RATCHET_UPDATE_COMMAND = "bun run lint:ratchet:update";

export const RATCHET_REGRESSION_UPDATE_COMMAND =
  'bun run lint:ratchet:update -- --allow-worse --reason "<why>"';

export const REGRESSION_RECOVERY_FOOTER = `Recovery: fix the regressions above; if the new findings are intentional, run \`${RATCHET_REGRESSION_UPDATE_COMMAND}\`.`;
