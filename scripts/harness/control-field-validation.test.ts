import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import type { RawControl as GenerateRawControl } from "./generate-harness-controls.js";
import { resolveControl } from "./generate-harness-controls-validation.js";
import {
  type ControlFailures,
  type ManifestCheckContext,
  type RawControl as CheckRawControl,
  validateNonLintEntry,
  validateRatchetEntry,
  validateSourceField,
} from "./harness-check-validation.js";

const tmpRepo = registerTempRootCleanup();

function makeRepoRoot(): string {
  return tmpRepo.makeTempRepo("control-field-validation-");
}

function writeRepoFile(repoRoot: string, path: string): void {
  tmpRepo.writeRepoFile(repoRoot, path, "");
}

function generateControl(overrides: Partial<GenerateRawControl> = {}): GenerateRawControl {
  const base = {
    id: "sensor/fixture",
    kind: "sensor",
    category: "maintainability",
    principle: "Fixture principle.",
    pairedGuide: "none",
    repairKind: "manual",
    source: "scripts/source.ts",
    invocation: "bun run test",
  } satisfies GenerateRawControl;
  return { ...base, ...overrides };
}

function checkControl(overrides: Partial<CheckRawControl> = {}): CheckRawControl {
  const base = {
    id: "sensor/fixture",
    kind: "sensor",
    category: "maintainability",
    principle: "Fixture principle.",
    pairedGuide: "none",
    repairKind: "manual",
    source: "scripts/source.ts",
    invocation: "bun run test",
  } satisfies CheckRawControl;
  return { ...base, ...overrides };
}

function generateFailureMessages(control: GenerateRawControl, repoRoot: string): readonly string[] {
  const result = resolveControl(control, new Map(), repoRoot, new Map());
  return "failures" in result ? result.failures : [];
}

function checkFailureMessages(
  validate: (failures: Map<string, ControlFailures>) => void,
): readonly string[] {
  const failures = new Map<string, ControlFailures>();
  validate(failures);
  return failures.get("sensor/fixture")?.failures ?? [];
}

function expectCheckFailure(
  validate: (failures: Map<string, ControlFailures>) => void,
  expected: string,
): void {
  expect(checkFailureMessages(validate)).toContain(expected);
}

function expectNoCheckFailures(validate: (failures: Map<string, ControlFailures>) => void): void {
  expect(checkFailureMessages(validate)).toEqual([]);
}

describe("shared harness control field rules", () => {
  it("rejects source paths outside repo root in both validation callers", () => {
    const repoRoot = makeRepoRoot();
    const source = "../outside.ts";

    expect(generateFailureMessages(generateControl({ source }), repoRoot)).toContain(
      "source must resolve under repoRoot",
    );
    expectCheckFailure((failures) => {
      validateSourceField(repoRoot, "sensor/fixture", source, failures);
    }, "source must resolve under repoRoot");
  });

  it("rejects missing source paths in both validation callers", () => {
    const repoRoot = makeRepoRoot();
    const source = "scripts/missing.ts";

    expect(generateFailureMessages(generateControl({ source }), repoRoot)).toContain(
      `source does not resolve to an existing file: ${source}`,
    );
    expectCheckFailure((failures) => {
      validateSourceField(repoRoot, "sensor/fixture", source, failures);
    }, `source does not resolve to an existing file: ${source}`);
  });

  it('accepts pairedGuide: "none" in both validation callers', () => {
    const repoRoot = makeRepoRoot();
    writeRepoFile(repoRoot, "scripts/source.ts");
    const result = resolveControl(
      generateControl({ pairedGuide: "none" }),
      new Map(),
      repoRoot,
      new Map(),
    );

    expect("failures" in result).toBe(false);
    expect(result).toMatchObject({ pairedGuide: "none" });
    expectNoCheckFailures((failures) => {
      validateNonLintEntry(checkControl({ pairedGuide: "none" }), "sensor/fixture", {
        repoRoot,
        scripts: new Map(),
        failures,
      });
    });
  });

  it("rejects repairCommand on non-codemod controls in both validation callers", () => {
    const repoRoot = makeRepoRoot();
    writeRepoFile(repoRoot, "scripts/source.ts");

    expect(
      generateFailureMessages(
        generateControl({ repairKind: "manual", repairCommand: "bun run codemod:fixture" }),
        repoRoot,
      ),
    ).toContain("repairCommand must be absent unless repairKind is codemod");
    expectCheckFailure((failures) => {
      validateNonLintEntry(
        checkControl({ repairKind: "manual", repairCommand: "bun run codemod:fixture" }),
        "sensor/fixture",
        { repoRoot, scripts: new Map(), failures },
      );
    }, "repairCommand must be absent unless repairKind is codemod");
  });

  it("rejects codemod controls without repairCommand in both validation callers", () => {
    const repoRoot = makeRepoRoot();
    writeRepoFile(repoRoot, "scripts/source.ts");

    expect(generateFailureMessages(generateControl({ repairKind: "codemod" }), repoRoot)).toContain(
      "repairCommand must be a non-empty string when repairKind is codemod",
    );
    expectCheckFailure((failures) => {
      validateNonLintEntry(checkControl({ repairKind: "codemod" }), "sensor/fixture", {
        repoRoot,
        scripts: new Map(),
        failures,
      });
    }, "repairCommand must be a non-empty string when repairKind is codemod");
  });
});

function ratchetControl(overrides: Partial<GenerateRawControl> = {}): GenerateRawControl {
  const base = {
    id: "ratchet/fixture",
    kind: "ratchet",
    category: "maintainability",
    pairedGuide: "none",
    repairKind: "manual",
    source: "scripts/source.ts",
    invocation: "bun run lint:ratchet",
  } satisfies GenerateRawControl;
  return { ...base, ...overrides };
}

function ratchetCheckControl(overrides: Partial<CheckRawControl> = {}): CheckRawControl {
  const base = {
    id: "ratchet/fixture",
    kind: "ratchet",
    category: "maintainability",
    pairedGuide: "none",
    repairKind: "manual",
    source: "scripts/source.ts",
    invocation: "bun run lint:ratchet",
  } satisfies CheckRawControl;
  return { ...base, ...overrides };
}

function makeManifestContext(repoRoot: string): {
  context: ManifestCheckContext;
  failures: Map<string, ControlFailures>;
} {
  const failures = new Map<string, ControlFailures>();
  return { context: { repoRoot, scripts: new Map(), failures }, failures };
}

describe("ratchet principle derivation", () => {
  it("projects principle from the registry, not the manifest", () => {
    const repoRoot = makeRepoRoot();
    writeRepoFile(repoRoot, "scripts/source.ts");
    const ratchetPrinciples = new Map([["ratchet/fixture", "Registry-derived principle."]]);

    const result = resolveControl(ratchetControl(), new Map(), repoRoot, ratchetPrinciples);

    expect("failures" in result).toBe(false);
    expect(result).toMatchObject({
      id: "ratchet/fixture",
      principle: "Registry-derived principle.",
    });
  });

  it("rejects a hand-written ratchet principle in the manifest", () => {
    const repoRoot = makeRepoRoot();
    writeRepoFile(repoRoot, "scripts/source.ts");
    const ratchetPrinciples = new Map([["ratchet/fixture", "Registry-derived principle."]]);

    const result = resolveControl(
      ratchetControl({ principle: "Hand-written principle." }),
      new Map(),
      repoRoot,
      ratchetPrinciples,
    );

    expect("failures" in result).toBe(true);
    const failures = "failures" in result ? result.failures : [];
    expect(failures).toContain(
      "ratchet entries must not restate principle; it is re-projected from the lint-ratchet registry",
    );
  });

  it("fails when the registry has no principle for the ratchet id", () => {
    const repoRoot = makeRepoRoot();
    writeRepoFile(repoRoot, "scripts/source.ts");

    const result = resolveControl(ratchetControl(), new Map(), repoRoot, new Map());

    expect("failures" in result).toBe(true);
    const failures = "failures" in result ? result.failures : [];
    expect(failures).toContain(
      "ratchet/fixture has no principle in scripts/lint-ratchet/lint-ratchet-config.ts",
    );
  });

  it("rejects a hand-written ratchet principle in harness:check too", () => {
    const repoRoot = makeRepoRoot();
    writeRepoFile(repoRoot, "scripts/source.ts");
    const { context, failures } = makeManifestContext(repoRoot);

    validateRatchetEntry(
      ratchetCheckControl({ principle: "Hand-written principle." }),
      "ratchet/fixture",
      new Set(["ratchet/fixture"]),
      context,
    );

    const messages = failures.get("ratchet/fixture")?.failures ?? [];
    expect(messages).toContain(
      "ratchet entries must not restate principle; it is re-projected from the lint-ratchet registry",
    );
  });

  it("accepts a ratchet entry that omits principle in harness:check", () => {
    const repoRoot = makeRepoRoot();
    writeRepoFile(repoRoot, "scripts/source.ts");
    const { context, failures } = makeManifestContext(repoRoot);

    validateRatchetEntry(
      ratchetCheckControl(),
      "ratchet/fixture",
      new Set(["ratchet/fixture"]),
      context,
    );

    expect(failures.get("ratchet/fixture")?.failures ?? []).toEqual([]);
  });
});
