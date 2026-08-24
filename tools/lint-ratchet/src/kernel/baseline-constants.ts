const LINT_RATCHET_BASELINE_LEGACY_VERSION = 1 as const;
// eslint-disable-next-line no-magic-numbers -- schema version is the wire-format literal
const LINT_RATCHET_BASELINE_ANNOTATED_VERSION = 2 as const;

export const LINT_RATCHET_BASELINE_WRITE_VERSION = LINT_RATCHET_BASELINE_ANNOTATED_VERSION;
export const LINT_RATCHET_BASELINE_ACCEPTED_VERSIONS = [
  LINT_RATCHET_BASELINE_LEGACY_VERSION,
  LINT_RATCHET_BASELINE_ANNOTATED_VERSION,
] as const;
export type LintRatchetBaselineVersion = (typeof LINT_RATCHET_BASELINE_ACCEPTED_VERSIONS)[number];

export interface LintRatchetBaselineVersionPolicy {
  readonly writeVersion: LintRatchetBaselineVersion;
  readonly acceptedVersions: readonly LintRatchetBaselineVersion[];
}

export function createLintRatchetBaselineVersionPolicy(
  writeVersion: LintRatchetBaselineVersion,
): LintRatchetBaselineVersionPolicy {
  return {
    writeVersion,
    acceptedVersions: LINT_RATCHET_BASELINE_ACCEPTED_VERSIONS,
  };
}

export const LINT_RATCHET_BASELINE_VERSION_POLICY = createLintRatchetBaselineVersionPolicy(
  LINT_RATCHET_BASELINE_WRITE_VERSION,
);

export function lintRatchetBaselineRegenerateForVersion(
  version: LintRatchetBaselineVersion,
  updateCommand: string,
): string | undefined {
  return version === LINT_RATCHET_BASELINE_ANNOTATED_VERSION ? updateCommand : undefined;
}

export const LINT_RATCHET_CONFIG_HASH_PREFIX = "sha256:" as const;
