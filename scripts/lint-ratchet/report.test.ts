import { join } from "node:path";

import { REGRESSION_RECOVERY_FOOTER } from "@musi/lint-ratchet/kernel/recovery-command.js";
import { describe, expect, it } from "vitest";

import {
  HARNESS_DIAGNOSTICS_SCHEMA_VERSION,
  type HarnessDiagnostics,
  type HarnessFinding,
  summarizeHarnessFindings,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { formatHarnessDiagnosticsReport, runLintRatchetReport } from "./report.js";

const tmpRepo = registerTempRootCleanup();
const IMPROVEMENT_RECOVERY_LINE = "Run `bun run lint:ratchet:update` to lock in the improvement.";

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
  const tempRoot = tmpRepo.writeRepo(
    { "diagnostics.json": `${JSON.stringify(rawEnvelope)}\n` },
    "lint-ratchet-report-",
  );
  const input = join(tempRoot, "diagnostics.json");
  return runLintRatchetReport({ input });
}

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
      "No ratchet findings. (clean)\n\nArtifact: <https://example/run/123>\nRecovery: nothing to do.",
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
    expect(report).toContain(REGRESSION_RECOVERY_FOOTER);
  });

  it("escapes markdown-sensitive finding text, paths, and artifact names", () => {
    const report = formatHarnessDiagnosticsReport(
      envelope([
        {
          ...baseFinding,
          control: "ratchet/x`tick`|<control>",
          path: "packages/<dir>/a|`b`.ts",
          line: 7,
          why: "why | <tag> and `tick` [link](https://example.test) ![img](x) *bold* _em_\nnext",
          howToFix:
            "fix | <tag> and `tick` [link](https://example.test) ![img](x) *bold* _em_\nnext",
          reason: "increased-count",
          baselineCount: 1,
          currentCount: 2,
        },
      ]),
      { artifactName: "artifact | <url> [report](https://example.test)" },
    );

    expect(report).not.toContain("<tag>");
    expect(report).toContain("#### `` ratchet/x`tick`|<control> ``");
    expect(report).toContain("`` packages/<dir>/a|`b`.ts:7 ``");
    expect(report).toContain(
      "why: why | &lt;tag&gt; and `tick` \\[link\\]\\(https://example.test\\) \\!\\[img\\]\\(x\\) \\*bold\\* \\_em\\_ next",
    );
    expect(report).toContain(
      "fix: fix | &lt;tag&gt; and `tick` \\[link\\]\\(https://example.test\\) \\!\\[img\\]\\(x\\) \\*bold\\* \\_em\\_ next",
    );
    expect(report).toContain(
      "Artifact: artifact | &lt;url&gt; \\[report\\]\\(https://example.test\\)",
    );
  });

  it("formats an improvement with the exact recovery command line", () => {
    const report = formatHarnessDiagnosticsReport(
      envelope([
        {
          ...baseFinding,
          why: "Current tree is better than the committed baseline.",
          howToFix:
            "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
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

  it("uses explicit improvement kind before legacy reason matching", () => {
    const report = formatHarnessDiagnosticsReport(
      envelope([
        {
          ...baseFinding,
          kind: "improvement",
          why: "Current tree is better than the committed baseline.",
          howToFix:
            "Run `bun run lint:ratchet:update` to lower the committed baseline and lock in this improvement.",
          reason: "future-improvement-reason",
          baselineCount: 3,
          currentCount: 1,
        },
      ]),
    );

    expect(report).toContain("3 → 1");
    expect(report).toContain("Recovery: `bun run lint:ratchet:update`");
    expect(report).not.toContain(REGRESSION_RECOVERY_FOOTER);
  });

  it("treats an explicit regression kind as a regression even with a legacy improvement reason", () => {
    const report = formatHarnessDiagnosticsReport(
      envelope([
        {
          ...baseFinding,
          kind: "regression",
          reason: "lower-count",
          baselineCount: 3,
          currentCount: 1,
        },
      ]),
    );

    expect(report).toContain(REGRESSION_RECOVERY_FOOTER);
    expect(report).not.toContain(IMPROVEMENT_RECOVERY_LINE);
  });

  it("formats an info-only equal-count swap without regression recovery", () => {
    const report = formatHarnessDiagnosticsReport(
      envelope([
        {
          ...baseFinding,
          severity: "info",
          path: "packages/server/src/app.ts",
          reason: "equal-count-message-swap",
          baselineCount: 2,
          currentCount: 2,
          why: "Message-count fingerprint changed at the same count.",
          howToFix:
            "Review the equal-count finding swap; if it is intentional, run `bun run lint:ratchet:update`.",
        },
      ]),
    );

    expect(report).toContain("| 1 | 0 | 0 | 1 |");
    expect(report).toContain("2 → 2");
    expect(report).toContain("1 info");
    expect(report).not.toContain(REGRESSION_RECOVERY_FOOTER);
    expect(report).toContain("Recovery: review informational findings.");
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
    expect(report).toContain(REGRESSION_RECOVERY_FOOTER);
  });

  it("caps each mixed control at 10 findings and points to the artifact", () => {
    const findings = Array.from(
      { length: 12 },
      (_, index): HarnessFinding => ({
        ...baseFinding,
        path: `packages/client/src/file-${String(index).padStart(2, "0")}.ts`,
        line: index + 1,
        reason: index === 0 ? "lower-count" : "increased-count",
        baselineCount: index === 0 ? 3 : 0,
        currentCount: 1,
      }),
    );

    const report = formatHarnessDiagnosticsReport(envelope(findings));
    const bullets = report.split("\n").filter((line) => line.startsWith("- `"));

    expect(bullets).toHaveLength(10);
    expect(report).toContain(
      "_2 more (rerun with a higher per-control limit or see the JSON envelope)._",
    );
    expect(report).not.toContain("more in artifact");
    expect(report).toContain(REGRESSION_RECOVERY_FOOTER);
  });

  it("points truncated findings at the artifact when one is provided", () => {
    const findings = Array.from(
      { length: 12 },
      (_, index): HarnessFinding => ({
        ...baseFinding,
        path: `packages/client/src/file-${String(index).padStart(2, "0")}.ts`,
        line: index + 1,
        reason: "increased-count",
        baselineCount: 0,
        currentCount: 1,
      }),
    );

    const report = formatHarnessDiagnosticsReport(envelope(findings), {
      artifactName: "https://example/run/9",
    });

    expect(report).toContain("_2 more in artifact._");
  });

  it("rejects an unsupported diagnostics envelope version with a purpose-built message", () => {
    expect(() => runReportForRawEnvelope({ ...envelope([]), version: "2" })).toThrow(
      /unsupported harness diagnostics version 2; this reader supports version 1/,
    );
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
