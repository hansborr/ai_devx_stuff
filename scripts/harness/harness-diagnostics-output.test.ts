import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  HARNESS_DIAGNOSTICS_OUTPUT_ENV,
  harnessDiagnosticsOutputPath,
  renderHarnessDiagnosticsEnvelope,
  writeHarnessDiagnosticsSidecar,
} from "./harness-diagnostics-output.js";

const tmpRepo = registerTempRootCleanup();

function makeTempRoot(): string {
  return tmpRepo.makeTempRepo("harness-diagnostics-output-");
}

function validEnvelope(): HarnessDiagnostics {
  return {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: "drift:ai",
    findings: [],
    summary: { blocking: 0, warning: 0, info: 0, byControl: {} },
  };
}

beforeEach(() => {
  vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("harnessDiagnosticsOutputPath", () => {
  it("returns undefined when the env var is unset", () => {
    expect(harnessDiagnosticsOutputPath()).toBeUndefined();
  });

  it("treats an empty env var as unset", () => {
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, "");
    expect(harnessDiagnosticsOutputPath()).toBeUndefined();
  });

  it("returns the configured path", () => {
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, "/tmp/diag.json");
    expect(harnessDiagnosticsOutputPath()).toBe("/tmp/diag.json");
  });
});

describe("renderHarnessDiagnosticsEnvelope", () => {
  it("renders pretty JSON with a trailing newline", () => {
    const rendered = renderHarnessDiagnosticsEnvelope(validEnvelope());
    expect(rendered.endsWith("\n")).toBe(true);
    expect(JSON.parse(rendered)).toEqual(validEnvelope());
  });
});

describe("writeHarnessDiagnosticsSidecar", () => {
  it("does nothing when the env var is unset", () => {
    const writeSpy = vi.spyOn(process.stdout, "write");
    expect(() => {
      writeHarnessDiagnosticsSidecar(validEnvelope());
    }).not.toThrow();
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("does nothing when the env var is empty", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, "");

    writeHarnessDiagnosticsSidecar(validEnvelope());

    expect(existsSync(outputPath)).toBe(false);
  });

  it("writes a schema-valid envelope to the sidecar without touching stdout", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);
    const writeSpy = vi.spyOn(process.stdout, "write");

    writeHarnessDiagnosticsSidecar(validEnvelope());

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
    const contents = readFileSync(outputPath, "utf8");
    expect(contents).toBe(renderHarnessDiagnosticsEnvelope(validEnvelope()));
    expect(harnessDiagnosticsSchema.safeParse(JSON.parse(contents)).success).toBe(true);
  });

  it("creates the sidecar parent directory when missing", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "nested", "deeper", "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);

    writeHarnessDiagnosticsSidecar(validEnvelope());

    expect(existsSync(outputPath)).toBe(true);
  });

  it("throws on an invalid envelope and writes nothing", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);
    // type-assertion-boundary: test - exercises runtime rejection of a summary
    // that disagrees with findings, which the static type forbids.
    const invalid = {
      version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
      tool: "drift:ai",
      findings: [],
      summary: { blocking: 1, warning: 0, info: 0, byControl: {} },
    } as unknown as HarnessDiagnostics;

    expect(() => {
      writeHarnessDiagnosticsSidecar(invalid);
    }).toThrow(/invalid envelope/u);
    expect(existsSync(outputPath)).toBe(false);
  });

  it("throws when the sidecar path cannot be written", () => {
    const root = makeTempRoot();
    const dirAsOutput = join(root, "diag-dir");
    mkdirSync(dirAsOutput);
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, dirAsOutput);

    expect(() => {
      writeHarnessDiagnosticsSidecar(validEnvelope());
    }).toThrow();
  });

  it("does not write when validation fails even if a stale sidecar exists", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "diag.json");
    writeFileSync(outputPath, "stale\n");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);
    // type-assertion-boundary: test - drives the validation-before-write order.
    const invalid = {
      version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
      tool: "drift:ai",
      findings: [],
      summary: { blocking: 2, warning: 0, info: 0, byControl: {} },
    } as unknown as HarnessDiagnostics;

    expect(() => {
      writeHarnessDiagnosticsSidecar(invalid);
    }).toThrow();
    expect(readFileSync(outputPath, "utf8")).toBe("stale\n");
  });
});
