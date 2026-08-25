import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractNearDuplicateFunctions,
  NEAR_DUPLICATE_TOOL,
  type NearDuplicateFunction,
} from "./drift-ai/near-duplicates.js";
import type { NearDuplicateRunner } from "./drift-ai/near-duplicates-runner.js";
import { formatNearDuplicatesBaseline, runNearDuplicatesCli } from "./sensor-near-duplicates.js";
import { readNearDuplicatesBaseline } from "./sensor-near-duplicates-baseline.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

// Synthetic two-near-clone source, mirroring the constant the drift-ai
// detector suite uses. The threshold case below feeds it to a stub runner, so
// the two suites deliberately keep independent copies rather than importing
// across the detector/gate ownership boundary.
const RENAMED_VARIABLES = `
type Line = { active: boolean; priceCents: number; quantity: number };

export function totalForOrder(lines: readonly Line[]): number {
  let subtotal = 0;
  for (const line of lines) {
    if (!line.active) {
      continue;
    }
    const lineTotal = line.priceCents * line.quantity;
    subtotal += lineTotal;
  }
  const discount = subtotal > 10_000 ? Math.round(subtotal * 0.1) : 0;
  const tax = Math.round((subtotal - discount) * 0.0825);
  return subtotal - discount + tax;
}

export function totalForBasket(entries: readonly Line[]): number {
  let running = 0;
  for (const entry of entries) {
    if (!entry.active) {
      continue;
    }
    const entryTotal = entry.priceCents * entry.quantity;
    running += entryTotal;
  }
  const rebate = running > 10_000 ? Math.round(running * 0.1) : 0;
  const taxes = Math.round((running - rebate) * 0.0825);
  return running - rebate + taxes;
}
`;

function functionsFrom(files: Record<string, string>): NearDuplicateFunction[] {
  return Object.entries(files).flatMap(([filePath, source]) =>
    extractNearDuplicateFunctions(filePath, source),
  );
}

describe("runNearDuplicatesCli", () => {
  const fixtureDir = path.join(import.meta.dirname, "fixtures/near-duplicate-gate");

  function fixture(name: string): string {
    return readFileSync(path.join(fixtureDir, name), "utf8");
  }

  function commitAll(repoRoot: string, message: string): void {
    execFileSync("git", ["add", "."], { cwd: repoRoot });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Musi Tests",
        "-c",
        "user.email=tests@musi.invalid",
        "commit",
        "-qm",
        message,
      ],
      { cwd: repoRoot },
    );
  }

  function committedDebtRepo(): { readonly baselinePath: string; readonly repoRoot: string } {
    const repoRoot = tmpRepo.makeTmpGitRepo("drift-near-dupes-gate-");
    tmpRepo.writeRepoFile(repoRoot, "src/existing-order.ts", fixture("existing-order.ts"));
    tmpRepo.writeRepoFile(repoRoot, "src/existing-basket.ts", fixture("existing-basket.ts"));
    const baselinePath = path.join(repoRoot, "sensor-near-duplicates.baseline.json");
    const discovered = runNearDuplicatesCli({ argv: ["--update"], cwd: repoRoot });
    writeFileSync(baselinePath, formatNearDuplicatesBaseline(discovered.entries ?? []));
    commitAll(repoRoot, "test: commit near-duplicate debt");
    return { baselinePath, repoRoot };
  }

  it("admits baseline debt but fails a synthetic clone touching a changed file", () => {
    const { repoRoot } = committedDebtRepo();

    const existingDebt = runNearDuplicatesCli({
      argv: [],
      cwd: repoRoot,
      changedFiles: ["src/existing-order.ts"],
    });
    expect(existingDebt.exitCode).toBe(0);
    expect(existingDebt.stdout).toContain("committed no-new floor");
    expect(runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot }).exitCode).toBe(0);

    tmpRepo.writeRepoFile(repoRoot, "src/new-clone.ts", fixture("new-clone.ts"));
    const regression = runNearDuplicatesCli({
      argv: [],
      cwd: repoRoot,
      changedFiles: ["src/new-clone.ts"],
    });
    expect(regression.exitCode).toBe(1);
    expect(regression.stdout).toContain("FAIL: near-duplicate function pairs added");
    expect(regression.stdout).toContain("src/new-clone.ts#totalForShipment");
    const fullCheck = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });
    expect(fullCheck.exitCode).toBe(3);
    expect(fullCheck.stdout).toContain("whole-repo near-duplicate baseline is stale");

    const refusedUpdate = runNearDuplicatesCli({
      argv: ["--update"],
      cwd: repoRoot,
    });
    expect(refusedUpdate.exitCode).toBe(1);
    expect(refusedUpdate.stdout).toContain("refusing to increase the committed baseline");
  });

  it("uses configured thresholds for gate collection and comparison", () => {
    const { repoRoot } = committedDebtRepo();
    tmpRepo.writeRepoFile(
      repoRoot,
      "drift-ai.config.json",
      JSON.stringify({
        checks: {
          "near-duplicates": {
            minLines: 100,
            minTokens: 120,
            similarityThreshold: 0.95,
            tokenBandRatio: 0.2,
          },
        },
      }),
    );
    const inputs: Parameters<NearDuplicateRunner>[0][] = [];
    const result = runNearDuplicatesCli({
      argv: ["--check-baseline"],
      cwd: repoRoot,
      runner: (input) => {
        inputs.push(input);
        return {
          ok: true,
          engine: NEAR_DUPLICATE_TOOL,
          functions: functionsFrom({ "src/totals.ts": RENAMED_VARIABLES }),
        };
      },
    });

    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      minLines: 100,
      minTokens: 120,
      similarityThreshold: 0.95,
    });
    expect(result.entries).toEqual([]);
    expect(result.stdout).toContain("whole-repo near-duplicate baseline is stale");
  });

  it("migrates a renamed identity through a reasoned admission", () => {
    const { baselinePath, repoRoot } = committedDebtRepo();
    const committed = readNearDuplicatesBaseline(readFileSync(baselinePath, "utf8"));
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const oldIdentity = committed.value[0]?.key;
    expect(oldIdentity).toBeDefined();
    if (oldIdentity === undefined) return;
    unlinkSync(path.join(repoRoot, "src/existing-order.ts"));
    tmpRepo.writeRepoFile(repoRoot, "src/renamed-order.ts", fixture("existing-order.ts"));

    const renamed = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });
    const newIdentity = renamed.entries?.[0]?.key;
    expect(newIdentity).toBeDefined();
    expect(newIdentity).not.toBe(oldIdentity);
    if (newIdentity === undefined) return;
    const refusedUpdate = runNearDuplicatesCli({ argv: ["--update"], cwd: repoRoot });
    expect(refusedUpdate.exitCode).toBe(1);
    expect(refusedUpdate.stdout).toContain("refusing to increase the committed baseline");

    const reason = `renamed from ${oldIdentity}`;
    const admitted = runNearDuplicatesCli({
      argv: ["--admit", newIdentity, "--reason", reason],
      cwd: repoRoot,
    });

    expect(admitted.exitCode).toBe(0);
    expect(admitted.stdout).toContain("admitted 1 reviewed identity");
    const migrated = readNearDuplicatesBaseline(readFileSync(baselinePath, "utf8"));
    expect(migrated).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          key: newIdentity,
          admissionReason: reason,
        }),
      ],
    });
    expect(runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot }).exitCode).toBe(0);
    commitAll(repoRoot, "test: commit reviewed rename admission");
    expect(runNearDuplicatesCli({ argv: ["--update"], cwd: repoRoot }).exitCode).toBe(0);
    expect(readNearDuplicatesBaseline(readFileSync(baselinePath, "utf8"))).toEqual(migrated);
  });

  it("requires a non-empty reason for every admission", () => {
    expect(runNearDuplicatesCli({ argv: ["--admit", "some identity"] }).stdout).toContain(
      "--admit requires --reason",
    );
    expect(
      runNearDuplicatesCli({ argv: ["--admit", "some identity", "--reason", "  "] }).stdout,
    ).toContain("--reason requires non-empty text");
    expect(runNearDuplicatesCli({ argv: ["--reason", "reviewed"] }).stdout).toContain(
      "--reason requires --admit",
    );
  });

  it("uses a dedicated verdict when the working baseline proposes unreviewed growth", () => {
    const { baselinePath, repoRoot } = committedDebtRepo();
    tmpRepo.writeRepoFile(repoRoot, "src/new-clone.ts", fixture("new-clone.ts"));
    const current = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });
    writeFileSync(baselinePath, formatNearDuplicatesBaseline(current.entries ?? []));
    execFileSync("git", ["add", "src/new-clone.ts", "sensor-near-duplicates.baseline.json"], {
      cwd: repoRoot,
    });

    const stagedCheck = runNearDuplicatesCli({
      argv: [],
      cwd: repoRoot,
      changedFiles: ["src/new-clone.ts", "sensor-near-duplicates.baseline.json"],
    });
    const wholeTreeCheck = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });

    expect(stagedCheck.exitCode).toBe(6);
    expect(stagedCheck.stdout).toContain("proposed baseline adds near-duplicate debt over HEAD");
    expect(wholeTreeCheck.exitCode).toBe(6);
    expect(wholeTreeCheck.stdout).toContain("proposed baseline adds near-duplicate debt over HEAD");
  });

  it("refuses to regenerate a deleted committed baseline", () => {
    const { baselinePath, repoRoot } = committedDebtRepo();
    unlinkSync(baselinePath);

    const update = runNearDuplicatesCli({ argv: ["--update"], cwd: repoRoot });

    expect(update.exitCode).toBe(2);
    expect(update.stdout).toContain("baseline missing");
    expect(existsSync(baselinePath)).toBe(false);
  });

  it("restores exact detector truth after a stamped semantic merge", () => {
    const { baselinePath, repoRoot } = committedDebtRepo();
    const preMergeHead = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    writeFileSync(baselinePath, formatNearDuplicatesBaseline([]));
    commitAll(repoRoot, "test: simulate drained merge baseline");
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const current = runNearDuplicatesCli({ argv: ["--check-baseline"], cwd: repoRoot });
    expect(current.exitCode).toBe(3);
    expect(runNearDuplicatesCli({ argv: ["--restore-merge-truth"], cwd: repoRoot }).exitCode).toBe(
      2,
    );
    const markerPath = path.resolve(
      repoRoot,
      gitDir,
      "musi/near-duplicates-baseline-postmerge-truth-up-required",
    );
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `truth-up required\npre-merge-head=${preMergeHead}\n`);

    const restored = runNearDuplicatesCli({ argv: ["--restore-merge-truth"], cwd: repoRoot });

    expect(restored.exitCode).toBe(0);
    expect(restored.stdout).toContain("restored stamped merge truth");
    expect(readFileSync(baselinePath, "utf8")).toBe(
      formatNearDuplicatesBaseline(current.entries ?? []),
    );
    expect(
      runNearDuplicatesCli({
        argv: [],
        cwd: repoRoot,
        changedFiles: ["sensor-near-duplicates.baseline.json"],
      }).exitCode,
    ).toBe(0);
  });
});
