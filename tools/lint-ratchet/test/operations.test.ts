import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BaselineParseError,
  MissingBaselineError,
  WorseBaselineError,
} from "@musi/lint-ratchet/governance/errors.js";
import {
  runLintRatchetGate,
  runLintRatchetUpdate,
} from "@musi/lint-ratchet/governance/operations.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import {
  createLintRatchetEngineContext,
  type LintRatchetEngineBinding,
  type LintRatchetEngineContext,
} from "@musi/lint-ratchet/kernel/engine-context.js";
import { ConfigError } from "@musi/lint-ratchet/kernel/metrics-types.js";
import { afterEach, describe, expect, it } from "vitest";

// Leaf 13 "In scope now" acceptance: the neutral gate/update application
// operations own the ordering invariants both adapters used to hand-copy —
// rule-source hashes → collect current → build/compare → round-trip-validate the
// rendered generated baseline → gated apply — driven purely by an injected
// context/binding/registry over a throwaway non-Musi fixture repo.
const realRepoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function makeFixtureRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-operations-"));
  cleanups.push(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });
  // Borrow the installed store so the generated ESLint config resolves its
  // engine deps; nothing imports @musi from the fixture.
  symlinkSync(join(realRepoRoot, "node_modules"), join(repoRoot, "node_modules"), "dir");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "operations-fixture", private: true, type: "module" }, null, 2)}\n`,
  );
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "operations@example.test"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "operations"], { cwd: repoRoot });
  return repoRoot;
}

function stageSource(repoRoot: string, name: string, body: string): void {
  const rel = `src/${name}`;
  writeFileSync(join(repoRoot, rel), body);
  execFileSync("git", ["add", rel], { cwd: repoRoot });
}

const operationsRatchet = {
  id: "ratchet/operations-no-debugger",
  ruleId: "no-debugger",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  repairKind: "manual",
  principle: "Operations fixture: keep debugger statements out of the fixture source.",
} satisfies LintRatchetConfig;
const registry: readonly LintRatchetConfig[] = [operationsRatchet];

interface FixtureEngine {
  readonly repoRoot: string;
  readonly context: LintRatchetEngineContext;
  readonly binding: LintRatchetEngineBinding;
}

function makeFixtureEngine(): FixtureEngine {
  const repoRoot = makeFixtureRepo();
  return {
    repoRoot,
    context: createLintRatchetEngineContext({ repoRoot }),
    binding: { repoRoot, thirdPartyPluginAllowlist: [] },
  };
}

describe("runLintRatchetGate / runLintRatchetUpdate application operations", () => {
  it("update writes a first baseline the gate then reports clean, and flags a regression", async () => {
    const { context, binding, repoRoot } = makeFixtureEngine();
    stageSource(repoRoot, "a.ts", "export function a(): number {\n  debugger;\n  return 1;\n}\n");

    // UPDATE (first-ever baseline): render, round-trip-validate, apply.
    const updated = await runLintRatchetUpdate({
      context,
      binding,
      registry,
      options: { allowWorse: false },
    });
    expect(updated.currentFindingCount).toBe(1);
    expect(updated.recordedDebt).toBe(false);
    expect(existsSync(context.baselinePath)).toBe(true);

    // GATE clean — same context/binding, zero deltas, warnings surfaced as data.
    const clean = await runLintRatchetGate({ context, binding, registry });
    expect(clean.comparison.regressions).toHaveLength(0);
    expect(clean.comparison.improvements).toHaveLength(0);
    expect(clean.currentFindingCount).toBe(1);
    expect(clean.baselineWarnings).toEqual([]);

    // GATE regression — a new finding on a new path is caught by the no-new gate.
    stageSource(repoRoot, "b.ts", "export function b(): number {\n  debugger;\n  return 2;\n}\n");
    const regressed = await runLintRatchetGate({ context, binding, registry });
    expect(regressed.currentFindingCount).toBe(2);
    expect(regressed.comparison.regressions.length).toBeGreaterThan(0);
  });

  it("update gates the committed baseline before writing and records accepted debt", async () => {
    const { context, binding, repoRoot } = makeFixtureEngine();
    stageSource(repoRoot, "a.ts", "export function a(): number {\n  debugger;\n  return 1;\n}\n");
    await runLintRatchetUpdate({ context, binding, registry, options: { allowWorse: false } });
    const committed = readFileSync(context.baselinePath, "utf8");

    // A worse update without --allow-worse is refused BEFORE any write: the
    // committed baseline text is untouched and no debt log appears.
    stageSource(repoRoot, "b.ts", "export function b(): number {\n  debugger;\n  return 2;\n}\n");
    await expect(
      runLintRatchetUpdate({ context, binding, registry, options: { allowWorse: false } }),
    ).rejects.toThrow(WorseBaselineError);
    expect(readFileSync(context.baselinePath, "utf8")).toBe(committed);
    expect(existsSync(context.debtLogPath)).toBe(false);

    // Accepting the debt writes the baseline and appends the debt-log record.
    const accepted = await runLintRatchetUpdate({
      context,
      binding,
      registry,
      options: { allowWorse: true, reason: "operations fixture accepts one debugger" },
    });
    expect(accepted.currentFindingCount).toBe(2);
    expect(accepted.recordedDebt).toBe(true);
    expect(readFileSync(context.baselinePath, "utf8")).not.toBe(committed);
    expect(readFileSync(context.debtLogPath, "utf8")).toContain(
      "operations fixture accepts one debugger",
    );

    // The accepted baseline gates clean again.
    const clean = await runLintRatchetGate({ context, binding, registry });
    expect(clean.comparison.regressions).toHaveLength(0);
  });

  // Parse-first ORDERING (the collector must not be invoked on these failure
  // paths) is pinned separately with a collector mock in
  // operations-parse-first.test.ts; these assert the typed-error contract
  // against the real, unmocked module graph.
  it("gate fails loud on a missing committed baseline with adapter-neutral data", async () => {
    const { context, binding } = makeFixtureEngine();
    const failure = await runLintRatchetGate({ context, binding, registry }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(MissingBaselineError);
    if (!(failure instanceof MissingBaselineError)) throw new Error("unreachable");
    expect(failure.relativeBaselinePath).toBe("lint-ratchet.baseline.json");
    // Recovery text (which command regenerates the baseline) is adapter-owned;
    // the package message carries only the missing path.
    expect(failure.message).toBe("lint-ratchet.baseline.json does not exist");
    // Adapters that only catch ConfigError still render a config failure.
    expect(failure).toBeInstanceOf(ConfigError);
  });

  it("gate fails loud on an unparseable committed baseline with structured failures", async () => {
    const { context, binding, repoRoot } = makeFixtureEngine();
    stageSource(repoRoot, "a.ts", "export function a(): number {\n  return 1;\n}\n");
    writeFileSync(context.baselinePath, "{ not a baseline\n");
    const failure = await runLintRatchetGate({ context, binding, registry }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(BaselineParseError);
    if (!(failure instanceof BaselineParseError)) throw new Error("unreachable");
    expect(failure.failures.length).toBeGreaterThan(0);
    expect(failure).toBeInstanceOf(ConfigError);
  });
});
