import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  summarizeHarnessFindings,
  type HarnessDiagnostics,
  type HarnessFinding,
} from "../packages/shared/src/schemas/harness-diagnostics.js";
import {
  formatHarnessDiagnosticsReport,
  runLintRatchetReport,
} from "./lint-ratchet-report.js";

const tempRoots: string[] = [];
const IMPROVEMENT_RECOVERY_LINE = "Run `bun run lint:ratchet:update` to lock in the improvement.";
const REGRESSION_FOOTER_LINE =
  'Recovery: fix the regressions above; if the new findings are intentional, run `bun run lint:ratchet:update -- --allow-worse --reason "<why>"`.';

const baseFinding: HarnessFinding = {
  control: "lint/local/no-debugger",
  severity: "block",
  why: "Ratchet regression for no-debugger.",
  howToFix: "Remove the debugger statement.",
  repairKind: "manual",
};

function envelope(findings: readonly HarnessFinding[]): HarnessDiagnostics {
  return {
    version: HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
    tool: "lint:ratchet",
    findings: [...findings],
    summary: summarizeHarnessFindings(findings),
  };
}

function runReportForRawEnvelope(rawEnvelope: unknown): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-report-"));
  tempRoots.push(tempRoot);
  const input = join(tempRoot, "diagnostics.json");
  writeFileSync(input, `${JSON.stringify(rawEnvelope)}\n`);
  return runLintRatchetReport({ input });
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot !== undefined) rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("lint ratchet report", () => {
  it("formats a clean diagnostics envelope without per-control sections", () => {
    const report = formatHarnessDiagnosticsReport(envelope([]));

    expect(report).toContain("<!-- lint-ratchet-summary -->\n### Lint ratchet");
    expect(report).toContain("| 0 | 0 | 0 | 0 |");
    expect(report).toContain("No ratchet findings. (clean)");
    expect(report).toContain("Recovery: nothing to do.");
    expect(report).not.toContain("#### `");
  });

  it("places the artifact URL before the recovery footer", () => {
    const report = formatHarnessDiagnosticsReport(envelope([]), {
      artifactName: "https://example/run/123",
    });

    expect(report).toContain(
      "No ratchet findings. (clean)\n\nArtifact: https://example/run/123\nRecovery: nothing to do.",
    );
  });

  it("formats a regression with location and count delta", () => {
    const report = formatHarnessDiagnosticsReport(
      envelope([
        {
          ...baseFinding,
          path: "packages/client/src/app.ts",
          line: 12,
          reason: "increased-count",
          baselineCount: 1,
          currentCount: 2,
        },
      ]),
    );

    expect(report).toContain("| 1 | 1 | 0 | 0 |");
    expect(report).toContain("#### `lint/local/no-debugger` (1 finding");
    expect(report).toContain("`packages/client/src/app.ts:12`");
    expect(report).toContain("1 → 2");
    expect(report).toContain(REGRESSION_FOOTER_LINE);
  });

  it("formats an improvement with the exact recovery command line", () => {
    const report = formatHarnessDiagnosticsReport(
      envelope([
        {
          ...baseFinding,
          why: "Current tree is better than the committed baseline.",
          howToFix: "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
          reason: "lower-count",
          baselineCount: 3,
          currentCount: 1,
        },
      ]),
    );

    expect(report).toContain("3 → 1");
    expect(report).toContain(
      "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
    );
    expect(report).toContain("Recovery: `bun run lint:ratchet:update`");
  });

  it("treats lower count with increased-complexity reason as a regression", () => {
    const report = formatHarnessDiagnosticsReport(
      envelope([
        {
          ...baseFinding,
          control: "lint/local/complexity",
          path: "packages/server/src/services/example.ts",
          line: 42,
          ruleId: "complexity",
          reason: "increased-complexity",
          baselineCount: 3,
          currentCount: 1,
          baselineComplexity: 12,
          currentComplexity: 18,
        },
      ]),
    );

    expect(report).toContain("12 → 18");
    expect(report).not.toContain(IMPROVEMENT_RECOVERY_LINE);
    expect(report).toContain(REGRESSION_FOOTER_LINE);
  });

  it("caps each mixed control at 10 findings and points to the artifact", () => {
    const findings = Array.from({ length: 12 }, (_, index): HarnessFinding => ({
      ...baseFinding,
      path: `packages/client/src/file-${String(index).padStart(2, "0")}.ts`,
      line: index + 1,
      reason: index === 0 ? "lower-count" : "increased-count",
      baselineCount: index === 0 ? 3 : 0,
      currentCount: 1,
    }));

    const report = formatHarnessDiagnosticsReport(envelope(findings));
    const bullets = report
      .split("\n")
      .filter((line) => line.startsWith("- `"));

    expect(bullets).toHaveLength(10);
    expect(report).toContain("_2 more in artifact._");
    expect(report).toContain("Recovery: `bun run lint:ratchet:update`");
  });

  it("renders byte-identical output for the same envelope", () => {
    const diagnostics = envelope([
      {
        ...baseFinding,
        path: "packages/client/src/b.ts",
        line: 20,
        reason: "increased-count",
        baselineCount: 0,
        currentCount: 1,
      },
      {
        ...baseFinding,
        control: "lint/local/no-alert",
        path: "packages/client/src/a.ts",
        line: 10,
        reason: "increased-count",
        baselineCount: 0,
        currentCount: 1,
      },
    ]);

    expect(formatHarnessDiagnosticsReport(diagnostics)).toBe(
      formatHarnessDiagnosticsReport(diagnostics),
    );
  });

  it("rejects diagnostics for tools other than lint:ratchet", () => {
    expect(() =>
      runReportForRawEnvelope({
        ...envelope([]),
        tool: "doctor",
      }),
    ).toThrow();
  });
});
