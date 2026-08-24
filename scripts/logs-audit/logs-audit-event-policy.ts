// Script-local business-event taxonomy. The auditor remains an outside-in
// consumer of emitted JSONL: shared policy supplies outcome vocabulary only,
// while family classification and audit behavior stay here.

import {
  AUTHZ_OUTCOMES,
  BROADCAST_OUTCOMES,
  MUTATION_OUTCOMES,
} from "../../packages/shared/src/logging-policy.js";

type BusinessEventFamily = "authz" | "socket.broadcast" | "mutation/default";
type ActorPolicy = "required" | "when-present" | "ignored";

export interface BusinessEventFamilyPolicy {
  readonly family: BusinessEventFamily;
  readonly matches: (event: string) => boolean;
  readonly allowedOutcomes: ReadonlySet<string>;
  readonly outcomeMessage: string;
  readonly actorPolicy: ActorPolicy;
  readonly reasonRequiredOutcome: string | undefined;
  readonly requiredStableFields: readonly string[];
}

const BUSINESS_EVENT_FAMILY_POLICIES = [
  {
    family: "authz",
    matches: (event: string) => event.startsWith("authz."),
    allowedOutcomes: new Set<string>(AUTHZ_OUTCOMES),
    outcomeMessage: "authz outcome must be allow or deny",
    actorPolicy: "required",
    reasonRequiredOutcome: "deny",
    requiredStableFields: [],
  },
  {
    family: "socket.broadcast",
    matches: (event: string) => event === "socket.broadcast",
    allowedOutcomes: new Set<string>(BROADCAST_OUTCOMES),
    outcomeMessage: "socket.broadcast outcome must be success or skipped",
    actorPolicy: "ignored",
    reasonRequiredOutcome: "skipped",
    requiredStableFields: ["socketEvent"],
  },
  {
    family: "mutation/default",
    matches: () => true,
    allowedOutcomes: new Set<string>(MUTATION_OUTCOMES),
    outcomeMessage: "mutation outcome must be success or failure",
    actorPolicy: "when-present",
    reasonRequiredOutcome: "failure",
    requiredStableFields: [],
  },
] satisfies readonly BusinessEventFamilyPolicy[];

export function isBusinessEvent(event: unknown): event is string {
  return typeof event === "string" && !event.startsWith("script.");
}

export function businessEventFamilyPolicy(event: string): BusinessEventFamilyPolicy {
  const policy = BUSINESS_EVENT_FAMILY_POLICIES.find((candidate) => candidate.matches(event));
  if (policy === undefined) {
    throw new Error("mutation/default business-event policy must match every event");
  }
  return policy;
}
