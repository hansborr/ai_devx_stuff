import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  emitHarnessDiagnostics,
  HARNESS_DIAGNOSTICS_OUTPUT_ENV,
  harnessDiagnosticsOutputPath,
  type HarnessDiagnosticsRoute,
  HarnessDiagnosticsValidationError,
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

/**
 * The exact bytes `validEnvelope()` must be emitted as, written out by hand
 * rather than produced by the module under test: two-space indent, no trailing
 * spaces, one trailing newline. Route tests compare against this literal so an
 * indent-width or trailing-newline regression cannot move the expectation along
 * with the code. A `HARNESS_DIAGNOSTICS_SCHEMA_VERSION` bump is meant to fail
 * here — this is a byte-identity pin, not a structural one.
 */
const VALID_ENVELOPE_BYTES = `{
  "version": "1",
  "tool": "drift:ai",
  "findings": [],
  "summary": {
    "blocking": 0,
    "warning": 0,
    "info": 0,
    "byControl": {}
  }
}
`;

describe("the rendered envelope bytes", () => {
  it("matches the hand-written pin, so the pin tracks a real envelope", () => {
    expect(JSON.parse(VALID_ENVELOPE_BYTES)).toEqual(validEnvelope());
    expect(VALID_ENVELOPE_BYTES.endsWith("}\n")).toBe(true);
    expect(harnessDiagnosticsSchema.safeParse(JSON.parse(VALID_ENVELOPE_BYTES)).success).toBe(true);
  });
});

function invalidEnvelope(blocking: number): HarnessDiagnostics {
  // type-assertion-boundary: test - exercises runtime rejection of a summary
  // that disagrees with findings, which the static type forbids.
  return {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: "drift:ai",
    findings: [],
    summary: { blocking, warning: 0, info: 0, byControl: {} },
  } as unknown as HarnessDiagnostics;
}

/** An envelope whose keys are NOT in shared-schema declaration order. */
function producerOrderedEnvelope(): HarnessDiagnostics {
  // type-assertion-boundary: test - pins the literal key order the producer
  // built, which the structural type intentionally does not describe.
  return {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: "lint:agent",
    findings: [
      {
        control: "lint/local/x",
        severity: "warn",
        ruleId: "local/x",
        path: "a.ts",
        why: "w",
        howToFix: "h",
        repairKind: "manual",
        line: 3,
      },
    ],
    summary: { blocking: 0, warning: 1, info: 0, byControl: { "lint/local/x": 1 } },
  } as unknown as HarnessDiagnostics;
}

describe("emitHarnessDiagnostics", () => {
  const source = "test-producer";

  it("stdout-only writes to stdout and never consults the sidecar env var", () => {
    const outputPath = join(makeTempRoot(), "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    emitHarnessDiagnostics(validEnvelope(), { mode: "stdout-only" }, { source });

    expect(writeSpy).toHaveBeenCalledWith(VALID_ENVELOPE_BYTES);
    writeSpy.mockRestore();
    expect(existsSync(outputPath)).toBe(false);
  });

  it("sidecar-only writes the sidecar and never touches stdout", () => {
    const outputPath = join(makeTempRoot(), "nested", "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    emitHarnessDiagnostics(validEnvelope(), { mode: "sidecar-only" }, { source });

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
    expect(readFileSync(outputPath, "utf8")).toBe(VALID_ENVELOPE_BYTES);
  });

  it("sidecar-only is a no-op when the sidecar env var is unset", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    emitHarnessDiagnostics(validEnvelope(), { mode: "sidecar-only" }, { source });

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("stdout-and-sidecar writes the same bytes to both", () => {
    const outputPath = join(makeTempRoot(), "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    emitHarnessDiagnostics(validEnvelope(), { mode: "stdout-and-sidecar" }, { source });

    expect(writeSpy).toHaveBeenCalledWith(VALID_ENVELOPE_BYTES);
    writeSpy.mockRestore();
    expect(readFileSync(outputPath, "utf8")).toBe(VALID_ENVELOPE_BYTES);
  });

  it("stdout-and-sidecar still writes stdout when no sidecar is requested", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    emitHarnessDiagnostics(validEnvelope(), { mode: "stdout-and-sidecar" }, { source });

    expect(writeSpy).toHaveBeenCalledWith(VALID_ENVELOPE_BYTES);
    writeSpy.mockRestore();
  });

  it("output-path writes the named file, ignoring stdout and the sidecar env var", () => {
    const root = makeTempRoot();
    const outputPath = join(root, "explicit", "diag.json");
    const sidecarPath = join(root, "sidecar.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, sidecarPath);
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    emitHarnessDiagnostics(validEnvelope(), { mode: "output-path", path: outputPath }, { source });

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
    expect(readFileSync(outputPath, "utf8")).toBe(VALID_ENVELOPE_BYTES);
    expect(existsSync(sidecarPath)).toBe(false);
  });

  it("output-path resolves a relative path against the working directory", () => {
    const outputPath = join(makeTempRoot(), "relative-diag.json");

    emitHarnessDiagnostics(
      validEnvelope(),
      { mode: "output-path", path: relative(process.cwd(), outputPath) },
      { source },
    );

    expect(existsSync(outputPath)).toBe(true);
  });

  it("validates every envelope even when nothing is written", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    expect(() => {
      emitHarnessDiagnostics(invalidEnvelope(1), { mode: "sidecar-only" }, { source });
    }).toThrow(HarnessDiagnosticsValidationError);

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("validates stdout-only envelopes before writing a byte", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    expect(() => {
      emitHarnessDiagnostics(invalidEnvelope(1), { mode: "stdout-only" }, { source });
    }).toThrow(/test-producer produced an invalid envelope/u);

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it("leaves a stale output-path file untouched when validation fails", () => {
    const outputPath = join(makeTempRoot(), "diag.json");
    writeFileSync(outputPath, "stale\n");

    expect(() => {
      emitHarnessDiagnostics(
        invalidEnvelope(2),
        { mode: "output-path", path: outputPath },
        { source },
      );
    }).toThrow(HarnessDiagnosticsValidationError);

    expect(readFileSync(outputPath, "utf8")).toBe("stale\n");
  });

  it("refuses a route mode the dispatch does not handle", () => {
    const root = makeTempRoot();
    const sidecarPath = join(root, "sidecar.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, sidecarPath);
    // type-assertion-boundary: test - forges the fifth routing mode the closed
    // union forbids. In production TypeScript rejects it at the `never` default
    // of `writeRenderedEnvelope`; this proves the same case is a hard runtime
    // failure rather than a silent fall-through that writes stdout AND the
    // sidecar, which is what a chain of `!==` tests would have done.
    const forgedRoute = { mode: "stdout-and-output-path" } as unknown as HarnessDiagnosticsRoute;
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    expect(() => {
      emitHarnessDiagnostics(validEnvelope(), forgedRoute, { source });
    }).toThrow(/unhandled harness-diagnostics route/u);

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
    expect(existsSync(sidecarPath)).toBe(false);
  });

  it("writes the producer's envelope verbatim rather than the parsed copy", () => {
    const outputPath = join(makeTempRoot(), "diag.json");
    vi.stubEnv(HARNESS_DIAGNOSTICS_OUTPUT_ENV, outputPath);
    const envelope = producerOrderedEnvelope();

    emitHarnessDiagnostics(envelope, { mode: "sidecar-only" }, { source });

    const written = readFileSync(outputPath, "utf8");
    expect(written).toBe(`${JSON.stringify(envelope, null, 2)}\n`);
    expect(harnessDiagnosticsSchema.safeParse(JSON.parse(written)).success).toBe(true);
    // Guard the claim above: the parsed copy really does reorder keys, so
    // "verbatim" is a load-bearing property, not a tautology.
    expect(written).not.toBe(
      `${JSON.stringify(harnessDiagnosticsSchema.parse(envelope), null, 2)}\n`,
    );
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
    expect(contents).toBe(VALID_ENVELOPE_BYTES);
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
