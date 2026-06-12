import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  LINT_RATCHET_CONFIG_HASH_PREFIX,
  type LintRatchetBaseline,
  type LintRatchetCurrentById,
  type LintRatchetCurrentItem,
  type LintRatchetRuleSourceHashesById,
} from "./lint-ratchet-baseline.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import {
  auditZeroBaselineRatchets,
  formatUndocumentedZeroBaselineFailure,
  formatZeroBaselineAudit,
  type NormalLintFileStatus,
  runLintRatchetZeroBaselineAudit,
  undocumentedZeroBaselineRows,
  type ZeroBaselineAuditRow,
} from "./lint-ratchet-zero-baseline.js";

const FIXTURE_HASH = `${LINT_RATCHET_CONFIG_HASH_PREFIX}${"a".repeat(64)}`;
const tempRoots: string[] = [];

const promotedRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-promoted",
  ruleId: "no-alert",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/app/src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  target: 0,
  metric: "message-count",
  repairKind: "manual",
};

const documentedRatchet: LintRatchetConfig = {
  ...promotedRatchet,
  id: "ratchet/fixture-documented",
  zeroBaselineDisposition: {
    kind: "temporary-ratchet-only",
    reason: "normal lint still excludes this script family",
    exitPath: "docs/agent_notes/backlog/lint-review-2026-06/fixture.md",
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

function currentById(
  entries: readonly [string, readonly [string, LintRatchetCurrentItem][]][],
): LintRatchetCurrentById {
  const current = new Map<string, ReadonlyMap<string, LintRatchetCurrentItem>>();
  for (const [ratchetId, items] of entries) current.set(ratchetId, new Map(items));
  return current;
}

function baseline(): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [promotedRatchet, documentedRatchet, debtRatchet],
    currentById([[debtRatchet.id, [["packages/app/src/debt.ts", { count: 1 }]]]]),
    ruleSourceHashes,
  );
}

function zeroBaseline(ratchet: LintRatchetConfig): LintRatchetBaseline {
  return buildLintRatchetBaseline(
    [ratchet],
    currentById([]),
    new Map([[ratchet.id, FIXTURE_HASH]]),
  );
}

function writeBaselineFixture(text: string): string {
  const tempRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-zero-baseline-"));
  tempRoots.push(tempRoot);
  const baselinePath = join(tempRoot, "lint-ratchet.baseline.json");
  writeFileSync(baselinePath, text);
  return baselinePath;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot !== undefined) rmSync(tempRoot, { recursive: true, force: true });
  }
});

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
      "docs/agent_notes/backlog/lint-review-2026-06/fixture.md",
    );
    expect(formatZeroBaselineAudit(rows)).toContain("Promote to normal lint");
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
        "lint:ratchet:zero-baseline FAIL - 2 zero-baseline ratchets lack zeroBaselineDisposition.",
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
    const tempRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-zero-baseline-missing-"));
    tempRoots.push(tempRoot);

    await expect(
      runLintRatchetZeroBaselineAudit({
        baselinePath: join(tempRoot, "missing-baseline.json"),
        registry: [promotedRatchet],
        ruleSourceHashesById: new Map([[promotedRatchet.id, FIXTURE_HASH]]),
      }),
    ).rejects.toThrow("lint-ratchet.baseline.json does not exist; run bun run lint:ratchet:update");
  });

  it("uses strict committed-baseline validation before auditing", async () => {
    const staleBaselineText = formatLintRatchetBaseline(zeroBaseline(promotedRatchet)).replace(
      /"configHash": "sha256:[^"]+"/u,
      '"configHash": "sha256:stale"',
    );
    const baselinePath = writeBaselineFixture(staleBaselineText);

    await expect(
      runLintRatchetZeroBaselineAudit({
        baselinePath,
        registry: [promotedRatchet],
        ruleSourceHashesById: new Map([[promotedRatchet.id, FIXTURE_HASH]]),
      }),
    ).rejects.toThrow(`${promotedRatchet.id}.configHash is stale`);
  });
});
