import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { collectNonLintFieldIssues } from "./control-field-validation.js";
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

describe("raw harness control fields", () => {
  it("collects tagged non-lint issues without short-circuiting or live-tree lookups", () => {
    expect(
      collectNonLintFieldIssues(
        {
          ruleName: "local/fixture",
          category: "invalid",
          principle: "Keep the inventory from task 39.",
          pairedGuide: 42,
          repairKind: "codemod",
          source: "missing/source.ts",
          invocation: 42,
        },
        {
          principleFromRegistry: false,
          includeSource: true,
          bareCoordinateCheck: true,
        },
      ),
    ).toEqual([
      { field: "ruleName", message: "ruleName is only allowed on lint-rule entries" },
      {
        field: "category",
        message: "category must be one of: maintainability, architecture-fitness, behavior",
      },
      {
        field: "principle",
        message: "principle contains a bare backlog coordinate: task 39",
      },
      {
        field: "pairedGuide",
        message: 'pairedGuide must be "none" or a non-empty path string',
      },
      {
        field: "repairCommand",
        message: "repairCommand must be a non-empty string when repairKind is codemod",
      },
      { field: "invocation", message: "invocation must be a non-empty string" },
    ]);
  });

  it("makes source placement and bare-coordinate checking explicit caller options", () => {
    expect(
      collectNonLintFieldIssues(
        {
          category: "maintainability",
          principle: "Keep the inventory from task 39.",
          pairedGuide: "none",
          repairKind: "manual",
          invocation: "bun run fixture",
        },
        {
          principleFromRegistry: false,
          includeSource: false,
          bareCoordinateCheck: false,
        },
      ),
    ).toEqual([]);
  });
});

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
  it("preserves the generator's assembled non-lint diagnostic order", () => {
    const repoRoot = makeRepoRoot();

    expect(
      generateFailureMessages(
        generateControl({
          ruleName: "local/fixture",
          category: "invalid",
          principle: 42,
          pairedGuide: 42,
          repairKind: "codemod",
          repairCommand: undefined,
          source: 42,
          invocation: 42,
        }),
        repoRoot,
      ),
    ).toEqual([
      "ruleName is only allowed on lint-rule entries",
      "category must be one of: maintainability, architecture-fitness, behavior",
      "principle must be a non-empty string",
      'pairedGuide must be "none" or a non-empty path string',
      "repairCommand must be a non-empty string when repairKind is codemod",
      "source must be a non-empty string",
      "invocation must be a non-empty string",
    ]);
  });

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
