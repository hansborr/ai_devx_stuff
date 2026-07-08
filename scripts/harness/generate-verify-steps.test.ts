import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderVerifyStepsShellFromManifest } from "./generate-verify-steps.js";

const fixtureRoot = join(process.cwd(), "scripts", "fixtures", "generate-verify-steps");

function readFixture(name: string): string {
  return readFileSync(join(fixtureRoot, name), "utf8");
}

// Point the fast-commit marker at a path that never exists so a developer's
// opt-in marker in the real Git common dir cannot leak into these tests.
const HERMETIC_ENV = {
  ...process.env,
  MUSI_FAST_COMMIT_MARKER: "/nonexistent/musi-fast-commit",
};

function runBash(script: string): string {
  const result = spawnSync("bash", ["-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: HERMETIC_ENV,
  });
  if (result.error !== undefined) throw result.error;
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout;
}

function runBashResult(script: string): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync("bash", ["-c", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: HERMETIC_ENV,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("verify step generator", () => {
  it("keeps the CI core gate routed through generated verify metadata", () => {
    const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(ciWorkflow).toContain("bun run verify");
    expect(ciWorkflow).not.toContain("bun run verify:parallel");
    expect(ciWorkflow).toContain("MUSI_VERIFY_LOG_DIR: .musi-ci-verify-logs");
    expect(ciWorkflow).toContain(".musi-ci-verify-logs/ratchet-diagnostics.json");
    expect(ciWorkflow).toMatch(/^\s*run: bun run harness:check$/mu);
    expect(ciWorkflow).not.toMatch(/^\s*run: bun run docs:lint-guidance:check$/mu);

    for (const script of [
      "format:check",
      "typecheck",
      "lint",
      "lint:suppressions",
      "lint:ratchet",
      "lint:ratchet:check-debt-accounting",
      "lint:ratchet:zero-baseline",
      "sensor:knip-unused-exports",
      "docs:lint-coverage-map:audit",
      "test:scripts",
      "test",
    ]) {
      expect(ciWorkflow).not.toMatch(new RegExp(`^\\s*run: bun run ${script}$`, "mu"));
    }
  });

  it("renders command arrays and dynamic metadata from the manifest slots", () => {
    const manifest: unknown = JSON.parse(readFixture("manifest.json"));
    const expected = readFixture("expected.sh");

    expect(renderVerifyStepsShellFromManifest(manifest)).toBe(expected);
  });

  it("rejects duplicate manifest control ids instead of letting the last one win", () => {
    const manifest = {
      controls: [
        { id: "verify-wrapper/verify", slots: [{ name: "lint", script: "lint" }] },
        { id: "verify-wrapper/verify", slots: [{ name: "typecheck", script: "typecheck" }] },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "duplicate control id: verify-wrapper/verify",
    );
  });

  it("rejects full verify slot sets that do not cover pre-commit marker bridges", () => {
    const manifest = {
      controls: [
        { id: "verify-wrapper/verify", slots: [{ name: "lint", script: "lint" }] },
        {
          id: "verify-wrapper/verify-changed",
          slots: [
            { name: "lint", script: "lint:changed" },
            { name: "typecheck", script: "typecheck" },
          ],
        },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        {
          id: "hook/pre-commit",
          slots: [
            { name: "lint", script: "lint:changed" },
            { name: "typecheck", script: "typecheck" },
          ],
        },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "verify-wrapper/verify slots must include every hook/pre-commit slot because pre-commit accepts fresh verify success markers; missing: typecheck",
    );
  });

  it("rejects changed verify slot sets that do not cover pre-commit marker bridges", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [
            { name: "lint", script: "lint" },
            { name: "typecheck", script: "typecheck" },
          ],
        },
        { id: "verify-wrapper/verify-changed", slots: [{ name: "lint", script: "lint:changed" }] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        {
          id: "hook/pre-commit",
          slots: [
            { name: "lint", script: "lint:changed" },
            { name: "typecheck", script: "typecheck" },
          ],
        },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "verify-wrapper/verify-changed slots must include every hook/pre-commit slot because pre-commit accepts fresh verify:changed success markers; missing: typecheck",
    );
  });

  it("rejects manifest values mixing backslash with $ expansion", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [{ name: "lint", script: "lint", args: ["\\$LOG_DIR"] }],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "manifest value mixes backslash with $ expansion: \\$LOG_DIR",
    );
  });

  it("rejects manifest values using $ outside a plain variable reference", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [{ name: "lint", script: "lint", args: ["$(rm -rf x)"] }],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "manifest value uses $ outside a plain variable reference: $(rm -rf x)",
    );
  });

  it("rejects slot names containing $", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [{ name: "lint-$STAGE", script: "lint" }],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "verify-wrapper/verify slots[0].name must not contain $: lint-$STAGE",
    );
  });

  it("rejects slot names outside the log-safe allow-list", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [{ name: "../lint", script: "lint" }],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "verify-wrapper/verify slots[0].name must match /^[A-Za-z0-9][A-Za-z0-9_-]*$/: ../lint",
    );
  });

  it("rejects slot scripts containing $", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [{ name: "lint", script: "lint:$MODE" }],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "verify-wrapper/verify slot lint script must not contain $: lint:$MODE",
    );
  });

  it("rejects unknown slot keys with the consumer context", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [{ name: "lint", script: "lint", dynamics: "precommit-test-timings" }],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "verify-wrapper/verify slots[0] has unsupported key dynamics; valid keys: name, script, condition, args, env, dynamic",
    );
  });

  it("rejects slot names that collide after shell-variable normalization", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [
            { name: "a-b", script: "lint" },
            { name: "a_b", script: "typecheck" },
          ],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "slots verify-wrapper/verify:a-b and verify-wrapper/verify:a_b derive the same shell variable: MUSI_VERIFY_A_B_CMD",
    );
  });

  it("rejects shell-variable collisions across consumers", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [{ name: "changed-lint", script: "lint" }],
        },
        { id: "verify-wrapper/verify-changed", slots: [{ name: "lint", script: "typecheck" }] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "slots verify-wrapper/verify:changed-lint and verify-wrapper/verify-changed:lint derive the same shell variable: MUSI_VERIFY_CHANGED_LINT_CMD",
    );
  });

  it("rejects duplicate slot names in one consumer", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [
            { name: "lint", script: "lint" },
            { name: "lint", script: "typecheck" },
          ],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "verify-wrapper/verify duplicate slot name: lint",
    );
  });

  it("rejects slot scripts missing from the known package.json scripts", () => {
    const manifest = {
      controls: [
        { id: "verify-wrapper/verify", slots: [{ name: "lint", script: "lnit" }] },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest, new Set(["lint"]))).toThrow(
      "verify-wrapper/verify slot lint references unknown package.json script: lnit",
    );
  });

  it("rejects dynamic resolver ids outside the allow-list", () => {
    const manifest = {
      controls: [
        { id: "verify-wrapper/verify", slots: [{ name: "lint", script: "lint" }] },
        { id: "verify-wrapper/verify-changed", slots: [{ name: "lint", script: "lint" }] },
        { id: "verify-wrapper/verify-parallel", slots: [{ name: "lint", script: "lint" }] },
        {
          id: "hook/pre-commit",
          slots: [{ name: "test", script: "test:changed", dynamic: "inline-shell-branch" }],
        },
      ],
    };

    expect(() => renderVerifyStepsShellFromManifest(manifest)).toThrow(
      "hook/pre-commit slot test dynamic must be one of: precommit-test-timings, staged-script-classifier",
    );
  });

  it("emits sorted runtime guards extracting both $VAR and ${VAR} reference forms", () => {
    const manifest = {
      controls: [
        {
          id: "verify-wrapper/verify",
          slots: [
            {
              name: "lint",
              script: "lint",
              env: { ZVAR: "${ZULU}" },
              args: ["$ALPHA", "prefix-${BRACED_VAR}-suffix"],
            },
          ],
        },
        { id: "verify-wrapper/verify-changed", slots: [] },
        { id: "verify-wrapper/verify-parallel", slots: [] },
        { id: "hook/pre-commit", slots: [] },
      ],
    };

    const rendered = renderVerifyStepsShellFromManifest(manifest);

    // The braced ${BRACED_VAR} reference reaches the guard scanner via the
    // regex's second capture group; without that branch no guard is emitted.
    expect(rendered).toContain(
      ': "${BRACED_VAR:?scripts/verify/steps.generated.sh requires BRACED_VAR}"',
    );

    // ZULU is sourced from env (scanned first) and ALPHA from args (scanned
    // later); the localeCompare sort must still emit them in alphabetical
    // order, so the guard sequence is deterministic regardless of declaration.
    const guardVariables = [...rendered.matchAll(/^: "\$\{(\w+):\?/gmu)].map((match) => match[1]);
    expect(guardVariables).toStrictEqual(["ALPHA", "BRACED_VAR", "ZULU"]);
  });

  it("resolves the pre-commit test timing toggle from generated metadata", () => {
    const output = runBash(`
set -u
LOG_DIR=/tmp/musi-verify-steps-test
TIMINGS_FILE="$LOG_DIR/test-timings.json"
. scripts/fixtures/generate-verify-steps/expected.sh
. scripts/verify/steps-lib.sh
MUSI_CAPTURE_TEST_TIMINGS=1
musi_resolve_slot_cmd pre_commit test
IFS='|'
printf '%s\\n' "\${MUSI_RESOLVED_SLOT_CMD[*]}"
`);

    expect(output).toBe(
      "bun|run|test:changed|--reporter=dot|--reporter=json|--outputFile.json=/tmp/musi-verify-steps-test/test-timings.json\n",
    );
  });

  it("dispatches dynamic resolvers through the generated function map", () => {
    const output = runBash(`
set -u
LOG_DIR=/tmp/musi-verify-steps-test
TIMINGS_FILE="$LOG_DIR/test-timings.json"
. scripts/fixtures/generate-verify-steps/expected.sh
. scripts/verify/steps-lib.sh
fixture_dynamic_resolver() {
  MUSI_RESOLVED_SLOT_CMD=(fixture "$1" "$2")
}
MUSI_VERIFY_DYNAMIC_RESOLVER_FUNC['precommit-test-timings']=fixture_dynamic_resolver
musi_resolve_slot_cmd pre_commit test
IFS='|'
printf '%s\\n' "\${MUSI_RESOLVED_SLOT_CMD[*]}"
`);

    expect(output).toBe("fixture|pre_commit|test\n");
  });

  it("points runtime resolver invariants at verify-step regeneration", () => {
    const unknownSlot = runBashResult(`
set -u
LOG_DIR=/tmp/musi-verify-steps-test
TIMINGS_FILE="$LOG_DIR/test-timings.json"
. scripts/fixtures/generate-verify-steps/expected.sh
. scripts/verify/steps-lib.sh
musi_resolve_slot_cmd verify nope
`);

    expect(unknownSlot.status).toBe(2);
    expect(unknownSlot.stderr).toContain("verify steps: unknown slot nope for consumer verify");
    expect(unknownSlot.stderr).toContain("bun run verify:steps:check");
    expect(unknownSlot.stderr).toContain("scripts/harness/generate-verify-steps.ts");

    const missingArray = runBashResult(`
set -u
LOG_DIR=/tmp/musi-verify-steps-test
TIMINGS_FILE="$LOG_DIR/test-timings.json"
. scripts/fixtures/generate-verify-steps/expected.sh
. scripts/verify/steps-lib.sh
unset MUSI_VERIFY_LINT_CMD
musi_resolve_slot_cmd verify lint
`);

    expect(missingArray.status).toBe(2);
    expect(missingArray.stderr).toContain(
      "verify steps: generated command array is missing: MUSI_VERIFY_LINT_CMD",
    );
    expect(missingArray.stderr).toContain("bun run verify:steps:check");
    expect(missingArray.stderr).toContain("scripts/harness/generate-verify-steps.ts");
  });

  it("preserves staged-script classifier rc 2 asymmetry by consumer", () => {
    const result = runBashResult(`
set -u
LOG_DIR=/tmp/musi-verify-steps-test
TIMINGS_FILE="$LOG_DIR/test-timings.json"
. scripts/fixtures/generate-verify-steps/expected.sh
. scripts/verify/steps-lib.sh
musi_classify_staged_script_input() { return 2; }
musi_resolve_slot_cmd pre_commit scripts || pre_rc=$?
printf 'pre:%s:%s\\n' "\${pre_rc:-0}" "\${#MUSI_RESOLVED_SLOT_CMD[@]}"
musi_resolve_slot_cmd verify_changed scripts
IFS='|'
printf 'changed:%s\\n' "\${MUSI_RESOLVED_SLOT_CMD[*]}"
`);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("pre:100:0\nchanged:bun|run|test:scripts:changed\n");
    expect(result.stderr).toContain(
      "verify steps: SKIP scripts (classifier uncertain — CI runs the full suite)",
    );
  });

  it("does not let unexpected staged-script classifier rc values impersonate skip", () => {
    const result = runBashResult(`
set -u
LOG_DIR=/tmp/musi-verify-steps-test
TIMINGS_FILE="$LOG_DIR/test-timings.json"
. scripts/fixtures/generate-verify-steps/expected.sh
. scripts/verify/steps-lib.sh
musi_classify_staged_script_input() { return 100; }
resolver_rc=0
musi_resolve_slot_cmd pre_commit scripts || resolver_rc=$?
printf '100:%s:%s\\n' "$resolver_rc" "\${#MUSI_RESOLVED_SLOT_CMD[@]}"
musi_classify_staged_script_input() { return 127; }
resolver_rc=0
musi_resolve_slot_cmd pre_commit scripts || resolver_rc=$?
printf '127:%s:%s\\n' "$resolver_rc" "\${#MUSI_RESOLVED_SLOT_CMD[@]}"
`);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("100:2:0\n127:2:0\n");
    expect(result.stderr).toContain(
      "verify steps: staged script classifier returned unexpected rc 100",
    );
    expect(result.stderr).toContain(
      "verify steps: staged script classifier returned unexpected rc 127",
    );
  });
});
