import { describe, expect, it } from "vitest";

import {
  deriveHeadOptions,
  deriveInlineValueFlags,
  deriveModeLookup,
  derivePreflightTiers,
  deriveStringFlagMessages,
  deriveTerminalLookup,
} from "./cli-catalog.js";

describe("lint-ratchet command catalog", () => {
  it("owns every mode and its parser projections", () => {
    expect([...deriveModeLookup()]).toEqual([
      ["update", "update"],
      ["check-baseline", "check-baseline"],
      ["check-debt-accounting", "check-debt-accounting"],
      ["check-registry", "check-registry"],
      ["summary", "summary"],
      ["trend", "trend"],
      ["zero-baseline", "zero-baseline"],
      ["report", "report"],
      ["debt-log", "debt-log"],
      ["edit-check", "edit-check"],
    ]);
    expect([...deriveTerminalLookup()].map(([flag, { mode }]) => [flag, mode])).toEqual([
      ["--propose", "propose"],
      ["--edit-check-targets", "edit-check-targets"],
      ["--edit-ratchet-coverage", "edit-ratchet-coverage"],
    ]);
    expect(deriveHeadOptions()).toEqual({
      update: { type: "boolean" },
      "check-baseline": { type: "boolean" },
      "check-debt-accounting": { type: "boolean" },
      "check-registry": { type: "boolean" },
      summary: { type: "boolean" },
      trend: { type: "boolean" },
      "zero-baseline": { type: "boolean" },
      report: { type: "boolean" },
      "debt-log": { type: "boolean" },
      "edit-check": { type: "boolean" },
      "allow-worse": { type: "boolean" },
      reason: { type: "string" },
      "migration-reason": { type: "string" },
      "retire-ratchet": { type: "string" },
      "accept-different-options": { type: "boolean" },
      staged: { type: "boolean" },
      "base-ref": { type: "string" },
      "by-directory": { type: "boolean" },
      since: { type: "string" },
      max: { type: "string" },
      all: { type: "boolean" },
      "targets-file": { type: "string" },
    });
    expect([...deriveInlineValueFlags()]).toEqual(["reason", "migration-reason"]);
    expect(deriveStringFlagMessages()).toEqual({
      reason: "--reason requires a non-empty argument",
      "migration-reason": "--migration-reason requires a non-empty argument",
      "retire-ratchet": "--retire-ratchet requires a ratchet id argument",
      "base-ref": "--base-ref requires a git ref",
      since: "--since requires a non-empty argument",
      "targets-file": "--targets-file requires a non-empty argument",
    });
    expect(derivePreflightTiers()).toEqual({
      default: "registry-preflight",
      update: "update-registry-clean",
      "check-baseline": "registry-preflight",
      "check-debt-accounting": "validate-registry",
      "check-registry": "none",
      summary: "validate-registry",
      trend: "none",
      "zero-baseline": "validate-registry",
      report: "none",
      "debt-log": "none",
      propose: "none",
      "edit-check-targets": "none",
      "edit-check": "none",
      "edit-ratchet-coverage": "none",
    });
  });
});
