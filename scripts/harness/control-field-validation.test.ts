import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { RawControl as GenerateRawControl } from "./generate-harness-controls.js";
import { resolveControl } from "./generate-harness-controls-validation.js";
import {
  type ControlFailures,
  type RawControl as CheckRawControl,
  validateNonLintEntry,
  validateSourceField,
} from "./harness-check-validation.js";

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function makeRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "control-field-validation-"));
  tempRoots.push(root);
  return root;
}

function writeRepoFile(repoRoot: string, path: string): void {
  const filePath = join(repoRoot, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "");
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
  const result = resolveControl(control, new Map(), repoRoot);
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
    const result = resolveControl(generateControl({ pairedGuide: "none" }), new Map(), repoRoot);

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
