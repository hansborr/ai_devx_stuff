import { describe, expect, it } from "vitest";

import {
  checkAgentOverlayControlParity,
  checkDoctorParity,
  type ControlFailures,
  extractDoctorCheckIds,
  type ManifestCheckContext,
} from "./harness-check-validation.js";
import {
  checkCiGateParity,
  checkScriptParity,
  parseHarnessParityConfig,
} from "./harness-gate-parity.js";

function makeContext(scripts: ReadonlyMap<string, string>): {
  context: ManifestCheckContext;
  failures: Map<string, ControlFailures>;
} {
  const failures = new Map<string, ControlFailures>();
  return { context: { repoRoot: "/repo", scripts, failures }, failures };
}

describe("checkScriptParity", () => {
  const controlPrefix = /^(sensor|docs|harness):/u;

  it("passes when every control-prefixed script is declared or exempt", () => {
    const scripts = new Map([
      ["sensor:declared", "bun run x"],
      ["docs:exempt", "bun run y"],
      ["build", "bun run z"],
    ]);
    const { context, failures } = makeContext(scripts);

    checkScriptParity(
      controlPrefix,
      new Set(["docs:exempt"]),
      new Set(["sensor:declared"]),
      context,
    );

    expect(failures.size).toBe(0);
  });

  it("names the offending script and both remedies plus the regen command", () => {
    const scripts = new Map([["docs:lint-coverage-map:audit", "bun run scripts/x.ts"]]);
    const { context, failures } = makeContext(scripts);

    checkScriptParity(controlPrefix, new Set(), new Set(), context);

    const parityBucket = failures.get("(parity)");
    expect(parityBucket).toBeDefined();
    const message = parityBucket?.failures.join("\n") ?? "";
    // Names the script.
    expect(message).toContain('"docs:lint-coverage-map:audit"');
    // Remedy 1: declare a control entry + regenerate the docs.
    expect(message).toContain("harness.controls.json");
    expect(message).toContain("bun run docs:harness-controls");
    // Remedy 2: mark it operational in manifest metadata.
    expect(message).toContain("scriptParityExemptions");
    expect(message).toContain("harness.controls.json");
  });

  it("rejects stale and non-control-prefixed manifest exemptions", () => {
    const { context, failures } = makeContext(new Map([["build", "bun build"]]));

    checkScriptParity(controlPrefix, new Set(["sensor:missing", "build"]), new Set(), context);

    expect(failures.get("(parity)")?.failures).toEqual([
      'scriptParityExemptions names unknown package.json script "sensor:missing"',
      'scriptParityExemptions includes "build", which does not match the control-prefix convention',
    ]);
  });
});

describe("checkAgentOverlayControlParity", () => {
  it("requires every guidance overlay to have a lint control id", () => {
    const failures = new Map<string, ControlFailures>();

    checkAgentOverlayControlParity(
      new Set(["complexity", "react-hooks/exhaustive-deps"]),
      new Set(["lint/complexity"]),
      failures,
    );

    expect(failures.get("(parity)")?.failures).toEqual([
      "lint-agent overlay react-hooks/exhaustive-deps is not declared as control lint/react-hooks/exhaustive-deps in harness.controls.json",
    ]);
  });
});

describe("doctor check parity", () => {
  const doctorSource = `
CURRENT_CONTROL="doctor-check/direct"
run_subcommand "merge driver" "repair hint" \\
  "doctor-check/loop-driven" \\
  bun run lint:check
run_subcommand() {
  local control=$3
  CURRENT_CONTROL="$control"
}
`;

  it("extracts direct assignments and ids passed through generic helpers", () => {
    expect(extractDoctorCheckIds(doctorSource)).toEqual(
      new Set(["doctor-check/direct", "doctor-check/loop-driven"]),
    );
  });

  it("diffs doctor.sh and manifest ids in both directions", () => {
    const failures = new Map<string, ControlFailures>();

    checkDoctorParity(
      doctorSource,
      new Set(["doctor-check/direct", "doctor-check/manifest-only"]),
      failures,
    );

    expect(failures.get("(doctor parity)")?.failures).toEqual([
      "doctor.sh emits doctor-check/loop-driven, but harness.controls.json does not declare it",
      "harness.controls.json declares doctor-check/manifest-only, but doctor.sh does not emit it",
    ]);
  });
});

describe("CI and local parity metadata", () => {
  it("loads script exemptions and expected CI control ids from the manifest", () => {
    const failures = new Map<string, ControlFailures>();

    const config = parseHarnessParityConfig(
      {
        scriptParityExemptions: ["docs:generate:check"],
        ciGateControlIds: ["verify-wrapper/verify"],
      },
      failures,
    );

    expect(config.scriptParityExemptions).toEqual(new Set(["docs:generate:check"]));
    expect(config.ciGateControlIds).toEqual(new Set(["verify-wrapper/verify"]));
    expect(failures.size).toBe(0);
  });

  it("reports omitted, extra, and renamed CI gate scripts by manifest control id", () => {
    const failures = new Map<string, ControlFailures>();
    const workflow = `
      # harness-ci-gate: verify-wrapper/verify
      - name: Verify
        run: bun run verify:changed
      # harness-ci-gate: verify-wrapper/extra
      - name: Extra
        run: bun run extra
    `;

    checkCiGateParity(
      workflow,
      new Map([
        ["verify-wrapper/verify", "bun run verify"],
        ["verify-wrapper/local", "bun run local"],
      ]),
      failures,
    );

    const messages = failures.get("(CI parity)")?.failures.join("\n") ?? "";
    expect(messages).toContain(
      'verify-wrapper/verify runs "bun run verify:changed" in CI, expected manifest invocation "bun run verify"',
    );
    expect(messages).toContain(
      "CI marks verify-wrapper/extra as a gate, but ciGateControlIds does not declare it",
    );
    expect(messages).toContain(
      "ciGateControlIds declares verify-wrapper/local, but CI has no harness-ci-gate marker for it",
    );
  });
});
