import { describe, expect, it } from "vitest";

import { businessEventFamilyPolicy } from "./logs-audit-event-policy.js";

describe("business-event family policy", () => {
  it.each([
    ["authz.character.read", "required"],
    ["socket.broadcast", "ignored"],
    ["character.update", "when-present"],
  ] as const)("assigns %s the %s actor policy", (event, actorPolicy) => {
    expect(businessEventFamilyPolicy(event).actorPolicy).toBe(actorPolicy);
  });
});
