import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateMonitoredFixtureShellDependencies } from "./fixture-shell-dependencies.js";

describe("monitored fixture shell dependencies", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "fixture-shell-dependencies-"));
    mkdirSync(join(repoRoot, "scripts", "tests"), { recursive: true });
    mkdirSync(join(repoRoot, "scripts", "lib"), { recursive: true });
    mkdirSync(join(repoRoot, "scripts", "verify"), { recursive: true });
    writeFileSync(
      join(repoRoot, "scripts", "verify", "memory-budget.sh"),
      [
        "#!/usr/bin/env bash",
        "# shellcheck source=../lib/test-worker-count.sh",
        '. "$(dirname "${BASH_SOURCE[0]}")/../lib/test-worker-count.sh"',
        "",
      ].join("\n"),
    );
    writeFileSync(join(repoRoot, "scripts", "lib", "test-worker-count.sh"), "#!/bin/bash\n");
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeSmoke(lines: readonly string[]): void {
    writeFileSync(
      join(repoRoot, "scripts", "tests", "test-fixture.sh"),
      ["#!/usr/bin/env bash", ...lines, ""].join("\n"),
    );
  }

  it("rejects an admission fixture that omits a literal sourced dependency", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
    ]);

    expect(() => {
      validateMonitoredFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("rejects copied fixture support that is absent from smoke-subject metadata", () => {
    writeFileSync(join(repoRoot, "scripts", "lib", "gate-env.sh"), "#!/bin/bash\n");
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      'cp "$SCRIPT_DIR/../lib/gate-env.sh" "$repo/scripts/lib/gate-env.sh"',
    ]);

    expect(() => {
      validateMonitoredFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh copies scripts/lib/gate-env.sh but its smoke-subject headers omit that path",
    );
  });

  it("rejects an under-closed second sandbox even when the first sandbox is complete", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo_one/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo_one/scripts/lib/test-worker-count.sh"',
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo_two/scripts/verify/memory-budget.sh"',
    ]);

    expect(() => {
      validateMonitoredFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh fixture $repo_two copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("does not merge the same destination variable across fixture functions", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "copy_complete_fixture() {",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      '  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      "}",
      "copy_incomplete_fixture() {",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      "}",
    ]);

    expect(() => {
      validateMonitoredFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh function copy_incomplete_fixture fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("recognizes function-keyword fixture declarations", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "function copy_complete_fixture {",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      '  cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      "}",
      "function copy_incomplete_fixture {",
      '  cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      "}",
    ]);

    expect(() => {
      validateMonitoredFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh function copy_incomplete_fixture fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("keeps identical nested function names in their full lexical scopes", () => {
    writeSmoke([
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      "copy_complete_outer() {",
      "  copy_nested() {",
      '    cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      '    cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      "  }",
      "}",
      "copy_incomplete_outer() {",
      "  copy_nested() {",
      '    cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      "  }",
      "}",
    ]);

    expect(() => {
      validateMonitoredFixtureShellDependencies(repoRoot);
    }).toThrow(
      "scripts/tests/test-fixture.sh function copy_incomplete_outer > copy_nested fixture $repo copies scripts/verify/memory-budget.sh but omits sourced dependency scripts/lib/test-worker-count.sh",
    );
  });

  it("accepts a transitively closed admission fixture with complete smoke metadata", () => {
    writeFileSync(
      join(repoRoot, "scripts", "lib", "tool-memory-admission.sh"),
      [
        "#!/usr/bin/env bash",
        "# shellcheck source=../verify/memory-budget.sh",
        "# shellcheck source=../process-tree.sh",
        "",
      ].join("\n"),
    );
    writeFileSync(join(repoRoot, "scripts", "process-tree.sh"), "#!/bin/bash\n");
    writeSmoke([
      "# smoke-subjects: scripts/lib/tool-memory-admission.sh",
      "# smoke-subjects: scripts/verify/memory-budget.sh",
      "# smoke-subjects: scripts/lib/test-worker-count.sh",
      "# smoke-subjects: scripts/process-tree.sh",
      "# smoke-subjects: scripts/tests/test-fixture.sh",
      'TOOL_MEMORY="$SCRIPT_DIR/../lib/tool-memory-admission.sh"',
      'cp "$TOOL_MEMORY" "$repo/scripts/lib/tool-memory-admission.sh"',
      'cp "$SCRIPT_DIR/../verify/memory-budget.sh" "$repo/scripts/verify/memory-budget.sh"',
      'cp "$SCRIPT_DIR/../lib/test-worker-count.sh" "$repo/scripts/lib/test-worker-count.sh"',
      'cp "$SCRIPT_DIR/../process-tree.sh" "$repo/scripts/process-tree.sh"',
    ]);

    expect(() => {
      validateMonitoredFixtureShellDependencies(repoRoot);
    }).not.toThrow();
  });
});
