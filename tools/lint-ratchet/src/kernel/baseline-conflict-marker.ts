import type { BaselineConflictMarkerRemediation } from "./group-baseline.js";

const GIT_CONFLICT_MARKER_PATTERN = /^<{7} /mu;

export function baselineConflictMarkerTripwire(
  text: string,
  remediation: BaselineConflictMarkerRemediation | undefined,
): string | undefined {
  if (remediation === undefined || !GIT_CONFLICT_MARKER_PATTERN.test(text)) return undefined;
  const resolution =
    remediation.reconcileEntries === true
      ? `then reconcile entries from both sides and normalize with \`${remediation.updateCommand}\`; ` +
        "never hand-merge conflict markers in this file."
      : `then resolve by regenerating with \`${remediation.updateCommand}\`; ` +
        "never hand-merge this file.";
  return (
    `${remediation.baselineFile} is generated; Git conflict markers mean its semantic merge driver was not installed. ` +
    `Run \`${remediation.installerCommand}\`, restore a parseable side with ` +
    `\`bun run baseline:restore-stage -- --ours ${remediation.baselineFile}\` ` +
    `(always use stage 2/\`--ours\`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), ${resolution} ` +
    "Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression."
  );
}
