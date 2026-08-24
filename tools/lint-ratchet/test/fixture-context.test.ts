import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLintRatchetBaseline,
  compareCurrentToBaseline,
  formatLintRatchetBaseline,
  parseLintRatchetBaseline,
} from "@musi/lint-ratchet/kernel/baseline.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import {
  collectCurrentById,
  totalCurrentCount,
} from "@musi/lint-ratchet/kernel/current-collector.js";
import {
  createLintRatchetEngineContext,
  type LintRatchetEngineBinding,
} from "@musi/lint-ratchet/kernel/engine-context.js";
import { buildRuleSourceHashesById } from "@musi/lint-ratchet/kernel/rule-source.js";
import { afterEach, describe, expect, it } from "vitest";

import { fixtureWorkflowVocabulary } from "./fixture-workflow-vocabulary.js";

// The plan's §2.3 fixture-context acceptance test (inherited from leaf 71): prove
// the package runs the full collect→compare→update pipeline over a throwaway repo
// with a NON-Musi registry, driven only by the injected engine context/binding
// and imported only through the package's own exports map. The real repo's
// node_modules is borrowed solely for the engine's declared runtime deps
// (eslint + typescript-eslint) — the deps any adopter installs; the registry,
// source, rule, and gate wiring are entirely synthetic (no Musi binding).
const realRepoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function makeFixtureRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-acceptance-"));
  cleanups.push(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });
  // Borrow the installed store so the generated ESLint config (which references
  // typescript-eslint) and ESLint's bin resolve; the workspace .bun metadata is
  // irrelevant here — nothing imports @musi from the fixture. "junction" is
  // ignored on POSIX and avoids the Windows Developer-Mode privilege a "dir"
  // symlink needs; junction targets must be absolute, and realRepoRoot is.
  symlinkSync(join(realRepoRoot, "node_modules"), join(repoRoot, "node_modules"), "junction");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "acceptance-fixture", private: true, type: "module" }, null, 2)}\n`,
  );
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "acceptance@example.test"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "acceptance"], { cwd: repoRoot });
  return repoRoot;
}

function stageSource(repoRoot: string, name: string, body: string): void {
  const rel = `src/${name}`;
  writeFileSync(join(repoRoot, rel), body);
  execFileSync("git", ["add", rel], { cwd: repoRoot });
}

// A wholly synthetic, non-Musi registry: one core-rule ratchet — no local rule
// source file, no Musi config, no third-party plugin allowlist entry needed.
const acceptanceRatchet = {
  id: "ratchet/acceptance-no-debugger",
  ruleId: "no-debugger",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  principle: "Acceptance fixture: keep debugger statements out of the fixture source.",
} satisfies LintRatchetConfig;
const registry: readonly LintRatchetConfig[] = [acceptanceRatchet];

describe("non-Musi fixture-context acceptance", () => {
  it("runs collect→compare→update through the injected binding and context", async () => {
    const repoRoot = makeFixtureRepo();
    const binding: LintRatchetEngineBinding = { repoRoot, thirdPartyPluginAllowlist: [] };
    const context = createLintRatchetEngineContext({
      workflowVocabulary: fixtureWorkflowVocabulary,
      repoRoot,
    });
    expect(context.baselinePath).toBe(join(repoRoot, "lint-ratchet.baseline.json"));

    stageSource(repoRoot, "a.ts", "export function a(): number {\n  debugger;\n  return 1;\n}\n");

    // COLLECT — through the injected binding, over the fixture's git-tracked files.
    const ruleSourceHashesById = buildRuleSourceHashesById(registry, binding);
    const currentById = await collectCurrentById({
      ruleSourceHashesById,
      ratchets: registry,
      binding,
    });
    expect(totalCurrentCount(currentById)).toBe(1);

    // UPDATE — regenerate and persist through the context's derived baseline path.
    const generated = buildLintRatchetBaseline(registry, currentById, ruleSourceHashesById, {
      workflowVocabulary: fixtureWorkflowVocabulary,
    });
    writeFileSync(
      context.baselinePath,
      formatLintRatchetBaseline(generated, fixtureWorkflowVocabulary),
    );
    const parsed = parseLintRatchetBaseline(
      readFileSync(context.baselinePath, "utf8"),
      registry,
      ruleSourceHashesById,
      { workflowVocabulary: fixtureWorkflowVocabulary },
    );
    const baseline = parsed.baseline;
    if (baseline === undefined) {
      throw new Error(`fixture baseline failed to parse: ${parsed.failures.join("\n")}`);
    }

    // COMPARE clean — the current findings match the just-written baseline.
    expect(
      compareCurrentToBaseline(baseline, registry, currentById, fixtureWorkflowVocabulary)
        .regressions,
    ).toHaveLength(0);

    // COMPARE regression — a new finding on a new path is caught by the no-new gate.
    stageSource(repoRoot, "b.ts", "export function b(): number {\n  debugger;\n  return 2;\n}\n");
    const regressed = await collectCurrentById({
      ruleSourceHashesById,
      ratchets: registry,
      binding,
    });
    expect(totalCurrentCount(regressed)).toBe(2);
    expect(
      compareCurrentToBaseline(baseline, registry, regressed, fixtureWorkflowVocabulary).regressions
        .length,
    ).toBeGreaterThan(0);
  });
});
