import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runLintRatchetUpdate } from "@musi/lint-ratchet/governance/operations.js";
import type * as BaselineModule from "@musi/lint-ratchet/kernel/baseline.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import { createLintRatchetEngineContext } from "@musi/lint-ratchet/kernel/engine-context.js";
import { afterEach, describe, expect, it, vi } from "vitest";

// The update operation's fail-closed round-trip guard: the rendered generated
// baseline is re-parsed before the gated apply, so formatter/parser drift (the
// engine bug class the Musi adapter guarded against and the demo used to lack)
// aborts the update BEFORE anything is written. Drift cannot occur through the
// real formatter by construction, so this simulates it: the operation module's
// view of `formatLintRatchetBaseline` (imported via the package self-specifier)
// is corrupted, while the parser's internal relative import stays real and
// catches the mismatch.
vi.mock("@musi/lint-ratchet/kernel/baseline.js", async (importOriginal) => {
  const original = await importOriginal<typeof BaselineModule>();
  return {
    ...original,
    formatLintRatchetBaseline: (
      ...args: Parameters<typeof original.formatLintRatchetBaseline>
    ): string => `${original.formatLintRatchetBaseline(...args)} `,
  };
});

const realRepoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function makeFixtureRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-roundtrip-"));
  cleanups.push(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });
  symlinkSync(join(realRepoRoot, "node_modules"), join(repoRoot, "node_modules"), "dir");
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(
    join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "roundtrip-fixture", private: true, type: "module" }, null, 2)}\n`,
  );
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "roundtrip@example.test"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "roundtrip"], { cwd: repoRoot });
  return repoRoot;
}

const roundtripRatchet = {
  id: "ratchet/roundtrip-no-debugger",
  ruleId: "no-debugger",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  repairKind: "manual",
  principle: "Round-trip fixture: keep debugger statements out of the fixture source.",
} satisfies LintRatchetConfig;
const registry: readonly LintRatchetConfig[] = [roundtripRatchet];

describe("update round-trip validation (simulated formatter drift)", () => {
  it("rejects a rendered baseline that fails re-parse and writes nothing", async () => {
    const repoRoot = makeFixtureRepo();
    const context = createLintRatchetEngineContext({ repoRoot });
    const binding = { repoRoot, thirdPartyPluginAllowlist: [] };
    const rel = "src/a.ts";
    writeFileSync(
      join(repoRoot, rel),
      "export function a(): number {\n  debugger;\n  return 1;\n}\n",
    );
    execFileSync("git", ["add", rel], { cwd: repoRoot });

    await expect(
      runLintRatchetUpdate({ context, binding, registry, options: { allowWorse: false } }),
    ).rejects.toThrow(/generated baseline failed validation:/u);
    // The guard fired BEFORE the gated apply: no baseline, no debt log.
    expect(existsSync(context.baselinePath)).toBe(false);
    expect(existsSync(context.debtLogPath)).toBe(false);
  });
});
