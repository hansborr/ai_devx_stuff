import { describe, expect, it } from "vitest";

import {
  resolveVerifyStepCatalog,
  resolveVerifyStepProfile,
  type VerifyStepCatalogEntryInput,
} from "./verify-step-programs.js";

function resolvedCatalog(
  rawCatalog: readonly VerifyStepCatalogEntryInput[],
  failures: string[],
): NonNullable<ReturnType<typeof resolveVerifyStepCatalog>> {
  const catalog = resolveVerifyStepCatalog(rawCatalog, failures);
  if (catalog === undefined) throw new Error("fixture catalog did not resolve");
  return catalog;
}

describe("verify step program resolution", () => {
  it("rejects name-restating slot bodies", () => {
    const failures: string[] = [];

    resolveVerifyStepCatalog(
      [
        {
          name: "restated",
          full: { name: "restated", script: "lint" },
          changed: { kind: "inherit" },
        },
      ],
      failures,
    );

    expect(failures).toContain(
      "verifySlotCatalog[0].full slot must not restate name; the catalog entry owns it",
    );
  });

  it("carries catalog artifact edges into every resolved command form", () => {
    // An artifact edge describes the slot, so a changed-mode replacement and a
    // gate override must both keep it. If either could drop it, that gate would
    // schedule the slot without the dependency and race its producer.
    const failures: string[] = [];
    const catalog = resolvedCatalog(
      [
        {
          name: "lint",
          full: { script: "lint" },
          changed: {
            kind: "replace",
            reason: "Changed mode lints changed files.",
            slot: { script: "lint:changed" },
          },
          requiresArtifact: "dist-outputs",
        },
        { name: "typecheck", full: { script: "typecheck" }, changed: { kind: "inherit" } },
      ],
      failures,
    );
    const profile = resolveVerifyStepProfile(
      catalog,
      {
        mode: "changed",
        overrides: [
          { name: "lint", reason: "This gate lints staged files.", slot: { script: "lint" } },
        ],
      },
      failures,
      "hook/pre-commit",
    );

    expect(failures).toStrictEqual([]);
    expect(catalog.full[0]?.requiresArtifact).toBe("dist-outputs");
    expect(catalog.changed[0]).toStrictEqual({
      name: "lint",
      script: "lint:changed",
      requiresArtifact: "dist-outputs",
    });
    expect(profile.slots[0]).toStrictEqual({
      name: "lint",
      script: "lint",
      requiresArtifact: "dist-outputs",
    });
  });

  it("rejects artifact-restating slot bodies so the catalog entry stays the only source", () => {
    const failures: string[] = [];

    resolveVerifyStepCatalog(
      [
        {
          name: "typecheck",
          full: { script: "typecheck", produces: "dist-outputs" },
          changed: { kind: "inherit" },
        },
      ],
      failures,
    );

    expect(failures).toContain(
      "verifySlotCatalog[0].full slot must not restate produces; the catalog entry owns it",
    );
  });

  it("rejects duplicate catalog names", () => {
    const failures: string[] = [];

    resolveVerifyStepCatalog(
      [
        { name: "lint", full: { script: "lint" }, changed: { kind: "inherit" } },
        { name: "lint", full: { script: "lint:changed" }, changed: { kind: "inherit" } },
      ],
      failures,
    );

    expect(failures).toContain("duplicate verifySlotCatalog slot name: lint");
  });

  it("rejects overrides for omitted slots and duplicate overrides", () => {
    const failures: string[] = [];
    const catalog = resolvedCatalog(
      [
        { name: "lint", full: { script: "lint" }, changed: { kind: "inherit" } },
        {
          name: "full-only",
          full: { script: "typecheck" },
          changed: { kind: "omit", reason: "Full gates alone run this slot." },
        },
      ],
      failures,
    );

    resolveVerifyStepProfile(
      catalog,
      {
        mode: "changed",
        overrides: [
          {
            name: "full-only",
            reason: "Invalid omitted-slot override.",
            slot: { script: "typecheck" },
          },
          { name: "lint", reason: "First replacement.", slot: { script: "lint:changed" } },
          { name: "lint", reason: "Second replacement.", slot: { script: "lint" } },
        ],
      },
      failures,
      "hook/pre-commit",
    );

    expect(failures).toContain(
      "hook/pre-commit slotProfile.overrides[0] targets slot full-only, which is absent from changed mode",
    );
    expect(failures).toContain("hook/pre-commit slotProfile has duplicate override for slot lint");
  });

  it("rejects a profile whose selected mode omits every catalog slot", () => {
    const failures: string[] = [];
    const catalog = resolvedCatalog(
      [
        {
          name: "full-only",
          full: { script: "typecheck" },
          changed: { kind: "omit", reason: "Changed gates omit this slot." },
        },
      ],
      failures,
    );

    resolveVerifyStepProfile(catalog, { mode: "changed" }, failures, "verify-wrapper/changed");

    expect(failures).toContain(
      "verify-wrapper/changed slotProfile resolves to an empty slots array",
    );
  });
});
