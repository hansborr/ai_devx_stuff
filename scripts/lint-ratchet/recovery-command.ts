// Single source of truth for the lint:ratchet baseline-update recovery commands
// surfaced in diagnostics findings, the report footer, and CI. The bare form is
// correct only when there is no regression to accept; once a regression is
// present the updater refuses unless `--allow-worse --reason` is supplied (see
// decideLintRatchetUpdate in baseline-update.ts).

export const RATCHET_UPDATE_COMMAND = "bun run lint:ratchet:update";

export const RATCHET_REGRESSION_REASON_PLACEHOLDER =
  "<why accepting this baseline increase is better than forcing a low-quality fix now>";

export const RATCHET_REGRESSION_UPDATE_COMMAND = `bun run lint:ratchet:update -- --allow-worse --reason "${RATCHET_REGRESSION_REASON_PLACEHOLDER}"`;

export const REGRESSION_RECOVERY_FOOTER = `Recovery: fix the regressions above; if the new findings are intentional, run \`${RATCHET_REGRESSION_UPDATE_COMMAND}\`.`;

export function isRatchetRegressionReasonPlaceholder(reason: string): boolean {
  const trimmed = reason.trim();
  return (
    trimmed === RATCHET_REGRESSION_REASON_PLACEHOLDER || trimmed.toLowerCase().startsWith("<why")
  );
}

export function ratchetRegressionReasonFailure(reason: string | undefined): string | undefined {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length === 0) return "--allow-worse requires a non-empty --reason";
  if (isRatchetRegressionReasonPlaceholder(trimmed)) {
    return "--allow-worse requires a real --reason, not the placeholder";
  }
  return undefined;
}
