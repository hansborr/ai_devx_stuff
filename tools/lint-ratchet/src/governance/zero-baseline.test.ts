import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  customWorkflowVocabulary,
  fixtureWorkflowVocabulary,
} from "../../test/fixture-workflow-vocabulary.js";
import { currentById, FIXTURE_HASH } from "../../test/support/lint-ratchet.test-helper.js";
import { registerTempRootCleanup } from "../../test/support/tmp-repo.test-helper.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetBaseline,
  type LintRatchetRuleSourceHashesById,
} from "../kernel/baseline.js";
import type { LintRatchetConfig } from "../kernel/config-types.js";
import {
  auditZeroBaselineRatchets,
  createNormalLintStatusForFile,
  formatUndocumentedZeroBaselineFailure,
  formatZeroBaselineAudit,
  type NormalLintFileStatus,
  runLintRatchetZeroBaselineAuditResult,
  undocumentedZeroBaselineRows,
  type ZeroBaselineAuditRow,
} from "./zero-baseline.js";

const tmpRepo = registerTempRootCleanup();

const promotedRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-promoted",
  ruleId: "no-alert",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/app/src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  principle: "Fixture promoted ratchet principle.",
};

const documentedRatchet: LintRatchetConfig = {
  ...promotedRatchet,
  id: "ratchet/fixture-documented",
  zeroBaselineDisposition: {
    kind: "temporary-ratchet-only",
    reason: "normal lint still excludes this script family",
    exitPath: "docs/agent_notes/backlog/example-pack/fixture.md",
  },
};

const debtRatchet: LintRatchetConfig = {
  ...promotedRatchet,
  id: "ratchet/fixture-debt",
};

const ruleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [promotedRatchet.id, FIXTURE_HASH],
  [documentedRatchet.id, FIXTURE_HASH],
  [debtRatchet.id, FIXTURE_HASH],
]);

function baseline(): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [promotedRatchet, documentedRatchet, debtRatchet],
    currentById([[debtRatchet.id, [["packages/app/src/debt.ts", { count: 1 }]]]]),
    ruleSourceHashes,
    { workflowVocabulary: fixtureWorkflowVocabulary },
  );
}

function zeroBaseline(ratchet: LintRatchetConfig): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [ratchet],
    currentById([]),
    new Map([[ratchet.id, FIXTURE_HASH]]),
    { workflowVocabulary: fixtureWorkflowVocabulary },
  );
}

function writeBaselineFixture(text: string): string {
  const tempRoot = tmpRepo.writeRepo(
    { "lint-ratchet.baseline.json": text },
    "lint-ratchet-zero-baseline-",
  );
  const baselinePath = join(tempRoot, "lint-ratchet.baseline.json");
  return baselinePath;
}

describe("lint ratchet zero-baseline audit", () => {
  it("audits only committed zero-baseline ratchets and aggregates normal lint status", async () => {
    const statuses = new Map<string, NormalLintFileStatus>([
      ["packages/app/src/a.ts", "error"],
      ["packages/app/src/b.ts", "error"],
      ["packages/app/src/c.ts", "ignored"],
    ]);

    await expect(
      auditZeroBaselineRatchets({
        baseline: baseline(),
        registry: [promotedRatchet, documentedRatchet, debtRatchet],
        trackedFiles: ["packages/app/src/a.ts", "packages/app/src/b.ts", "packages/app/src/c.ts"],
        normalLintStatusForFile: (_ratchet, path) => Promise.resolve(statuses.get(path) ?? "off"),
      }),
    ).resolves.toEqual([
      {
        id: promotedRatchet.id,
        ruleId: promotedRatchet.ruleId,
        matchedFileCount: 3,
        normalLintStatus: "mixed",
      },
      {
        id: documentedRatchet.id,
        ruleId: documentedRatchet.ruleId,
        matchedFileCount: 3,
        normalLintStatus: "mixed",
        disposition: documentedRatchet.zeroBaselineDisposition,
      },
    ]);
  });

  it("memoizes normal ESLint config resolution per path across overlapping ratchets", async () => {
    const ignoredCalls: string[] = [];
    const configCalls: string[] = [];
    const eslint = {
      isPathIgnored(path: string): Promise<boolean> {
        ignoredCalls.push(path);
        return Promise.resolve(path.endsWith("ignored.ts"));
      },
      calculateConfigForFile(path: string): Promise<unknown> {
        configCalls.push(path);
        return Promise.resolve({
          rules: {
            "no-alert": "error",
            "no-console": "off",
          },
        });
      },
    };
    const statusForFile = createNormalLintStatusForFile(eslint);
    const samePath = "packages/app/src/a.ts";
    const ignoredPath = "packages/app/src/ignored.ts";

    await expect(statusForFile(promotedRatchet, samePath)).resolves.toBe("error");
    await expect(
      statusForFile({ ...documentedRatchet, ruleId: "no-console" }, samePath),
    ).resolves.toBe("off");
    await expect(statusForFile(promotedRatchet, ignoredPath)).resolves.toBe("ignored");
    await expect(statusForFile(documentedRatchet, ignoredPath)).resolves.toBe("ignored");

    expect(ignoredCalls).toEqual([samePath, ignoredPath]);
    expect(configCalls).toEqual([samePath]);
  });

  it("formats lifecycle counts and next actions", () => {
    const rows: readonly ZeroBaselineAuditRow[] = [
      {
        id: promotedRatchet.id,
        ruleId: promotedRatchet.ruleId,
        matchedFileCount: 2,
        normalLintStatus: "normal-error",
      },
      {
        id: documentedRatchet.id,
        ruleId: documentedRatchet.ruleId,
        matchedFileCount: 1,
        normalLintStatus: "normal-ignored",
        disposition: documentedRatchet.zeroBaselineDisposition,
      },
      {
        id: "ratchet/fixture-missing",
        ruleId: "no-alert",
        matchedFileCount: 1,
        normalLintStatus: "normal-off",
      },
    ];

    expect(formatZeroBaselineAudit(rows)).toContain("Zero-baseline ratchets: 3");
    expect(formatZeroBaselineAudit(rows)).toContain("Normal-lint error coverage: 1");
    expect(formatZeroBaselineAudit(rows)).toContain("Documented ratchet-only lifecycle: 1");
    expect(formatZeroBaselineAudit(rows)).toContain("Needs lifecycle action: 2");
    expect(undocumentedZeroBaselineRows(rows).map((row) => row.id)).toEqual([
      promotedRatchet.id,
      "ratchet/fixture-missing",
    ]);
    expect(formatZeroBaselineAudit(rows)).toContain(
      "docs/agent\\_notes/backlog/example-pack/fixture.md",
    );
    expect(formatZeroBaselineAudit(rows)).toContain("Promote to normal lint");
  });

  it("canonically escapes disposition reasons and preferred exit paths in table rows", () => {
    const rows: readonly ZeroBaselineAuditRow[] = [
      {
        id: "ratchet/reason",
        ruleId: "no-alert",
        matchedFileCount: 1,
        normalLintStatus: "normal-off",
        disposition: {
          kind: "narrow-floor",
          reason: "reason | line\r\nnext \\ `code` <tag> [x]!",
        },
      },
      {
        id: "ratchet/exit-path",
        ruleId: "no-console",
        matchedFileCount: 2,
        normalLintStatus: "normal-ignored",
        disposition: {
          kind: "temporary-ratchet-only",
          reason: "the preferred exit path must win",
          exitPath: "docs\\guide|next\r\n<done>.md",
        },
      },
    ];

    const report = formatZeroBaselineAudit(rows);
    expect(report).toContain(
      "| ratchet/reason | no-alert | 1 | normal-off | narrow-floor | reason \\| line next \\\\ \\`code\\` &lt;tag&gt; \\[x\\]\\! |",
    );
    expect(report).toContain(
      "| ratchet/exit-path | no-console | 2 | normal-ignored | temporary-ratchet-only | docs\\\\guide\\|next &lt;done&gt;.md |",
    );
    expect(report.split("\n").filter((line) => line.startsWith("| ratchet/")).length).toBe(2);
    expect(report).not.toContain("the preferred exit path must win");
  });

  it("formats undocumented lifecycle failures for checked mode", () => {
    const rows: readonly ZeroBaselineAuditRow[] = [
      {
        id: promotedRatchet.id,
        ruleId: promotedRatchet.ruleId,
        matchedFileCount: 2,
        normalLintStatus: "normal-error",
      },
      {
        id: "ratchet/fixture-missing",
        ruleId: "no-alert",
        matchedFileCount: 1,
        normalLintStatus: "normal-off",
      },
    ];

    expect(formatUndocumentedZeroBaselineFailure(rows)).toBe(
      [
        "lint:ratchet:zero-baseline FAIL — 2 zero-baseline ratchets lack zeroBaselineDisposition.",
        "Undocumented ratchets:",
        "- ratchet/fixture-promoted",
        "- ratchet/fixture-missing",
      ].join("\n"),
    );
  });

  it("does not undercount overlapping documented normal-error rows", () => {
    const rows: readonly ZeroBaselineAuditRow[] = [
      {
        id: documentedRatchet.id,
        ruleId: documentedRatchet.ruleId,
        matchedFileCount: 1,
        normalLintStatus: "normal-error",
        disposition: documentedRatchet.zeroBaselineDisposition,
      },
      {
        id: "ratchet/fixture-missing",
        ruleId: "no-alert",
        matchedFileCount: 1,
        normalLintStatus: "normal-off",
      },
    ];

    expect(formatZeroBaselineAudit(rows)).toContain("Needs lifecycle action: 1");
  });

  it("reports a missing committed baseline as a config error", async () => {
    const tempRoot = tmpRepo.makeTempRepo("lint-ratchet-zero-baseline-missing-");

    await expect(
      runLintRatchetZeroBaselineAuditResult({
        baselinePath: join(tempRoot, "missing-baseline.json"),
        repoRoot: tempRoot,
        binding: { repoRoot: tempRoot, thirdPartyPluginAllowlist: [] },
        registry: [promotedRatchet],
        ruleSourceHashesById: new Map([[promotedRatchet.id, FIXTURE_HASH]]),
        workflowVocabulary: customWorkflowVocabulary,
      }),
    ).rejects.toThrow("missing-baseline.json does not exist; run fixture-ratchet update");
  });

  it("uses strict committed-baseline validation before auditing", async () => {
    // The stale value must stay format-valid (sha256:<64 hex>) so strict
    // parse-level hash validation accepts the file and staleness is detected
    // by the registry-identity check instead.
    const staleBaselineText = formatLintRatchetBaseline(
      zeroBaseline(promotedRatchet),
      fixtureWorkflowVocabulary,
    ).replace(/"configHash": "sha256:[^"]+"/u, `"configHash": "sha256:${"ab".repeat(32)}"`);
    const baselinePath = writeBaselineFixture(staleBaselineText);

    await expect(
      runLintRatchetZeroBaselineAuditResult({
        baselinePath,
        repoRoot: ".",
        binding: { repoRoot: ".", thirdPartyPluginAllowlist: [] },
        registry: [promotedRatchet],
        ruleSourceHashesById: new Map([[promotedRatchet.id, FIXTURE_HASH]]),
        workflowVocabulary: fixtureWorkflowVocabulary,
      }),
    ).rejects.toThrow(`${promotedRatchet.id}.configHash is stale`);
  });
});
