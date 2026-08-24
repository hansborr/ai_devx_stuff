import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BaselineParseError, MissingBaselineError } from "@musi/lint-ratchet/governance/errors.js";
import { runLintRatchetGate } from "@musi/lint-ratchet/governance/operations.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
} from "@musi/lint-ratchet/kernel/baseline.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import type * as CollectorModule from "@musi/lint-ratchet/kernel/current-collector.js";
import { createLintRatchetEngineContext } from "@musi/lint-ratchet/kernel/engine-context.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureWorkflowVocabulary } from "./fixture-workflow-vocabulary.js";

const LINT_RATCHET_BASELINE_REGENERATE = fixtureWorkflowVocabulary.updateCommand;

// The gate's parse-FIRST ordering: a missing or unparseable committed baseline
// must abort before the operation spends an ESLint sweep. The plain fail-loud
// tests in operations.test.ts cannot observe that (a collect-before-parse
// reorder would still reject), so this file replaces the operation module's
// view of `collectCurrentById` with a spy that fails the run if invoked — the
// same module-mock style as the round-trip drift simulation.
const collectSpy = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("collectCurrentById must not run before the committed baseline parses");
  }),
);

vi.mock("@musi/lint-ratchet/kernel/current-collector.js", async (importOriginal) => {
  const original = await importOriginal<typeof CollectorModule>();
  return { ...original, collectCurrentById: collectSpy };
});

const realRepoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const cleanups: Array<() => void> = [];
afterEach(() => {
  collectSpy.mockClear();
  while (cleanups.length > 0) cleanups.pop()?.();
});

function makeFixtureRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-parse-first-"));
  cleanups.push(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });
  // "junction" is ignored on POSIX and avoids the Windows Developer-Mode
  // privilege a "dir" symlink needs; junction targets must be absolute, and
  // realRepoRoot is.
  symlinkSync(join(realRepoRoot, "node_modules"), join(repoRoot, "node_modules"), "junction");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "parse-first-fixture", private: true, type: "module" }, null, 2)}\n`,
  );
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  return repoRoot;
}

const parseFirstRatchet = {
  id: "ratchet/parse-first-no-debugger",
  ruleId: "no-debugger",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  principle: "Parse-first fixture: keep debugger statements out of the fixture source.",
} satisfies LintRatchetConfig;
const registry: readonly LintRatchetConfig[] = [parseFirstRatchet];

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("gate parse-first ordering (collector must not run)", () => {
  it("aborts on a missing committed baseline before any collection", async () => {
    const repoRoot = makeFixtureRepo();
    const context = createLintRatchetEngineContext({
      workflowVocabulary: fixtureWorkflowVocabulary,
      repoRoot,
    });
    const binding = { repoRoot, thirdPartyPluginAllowlist: [] };

    const failure = await rejectionOf(runLintRatchetGate({ context, binding, registry }));
    expect(failure).toBeInstanceOf(MissingBaselineError);
    expect(collectSpy).not.toHaveBeenCalled();
  });

  it("aborts on an unparseable baseline, surfacing warnings alongside failures, before any collection", async () => {
    const repoRoot = makeFixtureRepo();
    const context = createLintRatchetEngineContext({
      workflowVocabulary: fixtureWorkflowVocabulary,
      repoRoot,
    });
    const binding = { repoRoot, thirdPartyPluginAllowlist: [] };
    // A post-bad-merge shape that yields BOTH: structurally valid JSON whose
    // registry validation fails (the committed tests are missing this
    // registry's ratchet) AND a non-blocking stale-regenerate warning.
    const emptyRegistryBaseline = formatLintRatchetBaseline(
      buildLintRatchetBaseline([], new Map(), new Map(), {
        workflowVocabulary: fixtureWorkflowVocabulary,
      }),
      fixtureWorkflowVocabulary,
    );
    writeFileSync(
      context.baselinePath,
      emptyRegistryBaseline.replace(LINT_RATCHET_BASELINE_REGENERATE, "bun run stale:regenerate"),
    );

    const failure = await rejectionOf(runLintRatchetGate({ context, binding, registry }));
    expect(failure).toBeInstanceOf(BaselineParseError);
    if (!(failure instanceof BaselineParseError)) throw new Error("unreachable");
    // Failures AND the pre-failure warnings both reach the adapter as data.
    expect(failure.failures.join("\n")).toMatch(/missing registry ratchet/u);
    expect(failure.warnings.join("\n")).toMatch(/regenerate annotation is stale/u);
    expect(collectSpy).not.toHaveBeenCalled();
  });
});
