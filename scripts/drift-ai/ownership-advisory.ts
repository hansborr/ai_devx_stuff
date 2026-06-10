import {
  boundedHistoryAdvisoryFields,
  boundedHistoryDisclosure,
  positiveInt,
} from "./advisory-format-helpers.js";
import { buildOwnershipRows } from "./ownership-analysis.js";
export { formatOwnershipAdvisoryJson, formatOwnershipAdvisoryText } from "./ownership-format.js";
export { formatIdentity, parseIdentity } from "./ownership-identities.js";
import {
  type BuildOwnershipAdvisoryInput,
  DEFAULT_AGENT_IDENTITY_PATTERNS,
  DEFAULT_OWNERSHIP_TOP,
  OWNERSHIP_SUBCOMMAND,
  type OwnershipAdvisory,
  type OwnershipIdentity,
} from "./ownership-types.js";
export type {
  BuildOwnershipAdvisoryInput,
  MailmapIdentityResolver,
  OwnershipAdvisory,
  OwnershipAdvisoryRow,
  OwnershipChangeSplit,
  OwnershipContributor,
  OwnershipIdentity,
  OwnershipSection,
} from "./ownership-types.js";
export {
  DEFAULT_AGENT_IDENTITY_PATTERNS,
  DEFAULT_OWNERSHIP_TOP,
  OWNERSHIP_SUBCOMMAND,
} from "./ownership-types.js";
import { buildPrototypeAdvisory } from "./prototype-advisory.js";

export function buildOwnershipAdvisory(input: BuildOwnershipAdvisoryInput): OwnershipAdvisory {
  const agentIdentityPatterns = input.agentIdentityPatterns ?? DEFAULT_AGENT_IDENTITY_PATTERNS;
  const mailmap = input.mailmapIdentity ?? ((identity: OwnershipIdentity) => identity);
  const rows = buildOwnershipRows({
    records: input.history.records,
    linesAvailable: input.history.linesAvailable,
    agentIdentityPatterns,
    mailmap,
  });
  const top = positiveInt(input.top, DEFAULT_OWNERSHIP_TOP);
  const historyFields = boundedHistoryAdvisoryFields(input.history);
  const advisory = buildPrototypeAdvisory({
    subcommand: OWNERSHIP_SUBCOMMAND,
    ...historyFields,
    sections: [
      {
        candidateKind: "file ownership / DOA candidates",
        totalCandidates: rows.length,
        emptyReason: rows.length === 0 ? "no file-level history records were available." : null,
        entries: rows.slice(0, top),
      },
    ],
  });
  return {
    ...advisory,
    history: boundedHistoryDisclosure(input.history),
    agentIdentityPatterns,
  };
}
