import { describe, expect, it } from "vitest";

import {
  checkAgentOverlayControlParity,
  checkDoctorParity,
  checkRuleParity,
  type ControlFailures,
  extractDoctorCheckIds,
  type ManifestCheckContext,
  validateNonLintEntry,
} from "./harness-check-validation.js";
import {
  checkCiGateBindings,
  checkScriptParity,
  CI_GATE_ENV_KEY,
  collectCiGateBindings,
  parseHarnessParityConfig,
} from "./harness-gate-parity.js";

function makeContext(scripts: ReadonlyMap<string, string>): {
  context: ManifestCheckContext;
  failures: Map<string, ControlFailures>;
} {
  const failures = new Map<string, ControlFailures>();
  return { context: { repoRoot: "/repo", scripts, failures }, failures };
}

describe("validateNonLintEntry", () => {
  it("preserves the checker's assembled non-lint diagnostic order", () => {
    const { context, failures } = makeContext(new Map());

    validateNonLintEntry(
      {
        ruleName: "local/fixture",
        category: "invalid",
        principle: 42,
        pairedGuide: 42,
        repairKind: "codemod",
        invocation: 42,
      },
      "sensor/fixture",
      context,
    );

    expect(failures.get("sensor/fixture")?.failures).toEqual([
      "ruleName is only allowed on lint-rule entries",
      "category must be one of: maintainability, architecture-fitness, behavior",
      "principle must be a non-empty string",
      'pairedGuide must be "none" or a non-empty path string',
      "repairCommand must be a non-empty string when repairKind is codemod",
      "invocation must be a non-empty string",
    ]);
  });
});

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
      {
        controlPrefixPattern: controlPrefix,
        exemptScripts: new Set(["docs:exempt"]),
        declaredScripts: new Set(["sensor:declared"]),
        aliasScripts: new Set(),
      },
      context,
    );

    expect(failures.size).toBe(0);
  });

  it("accounts for a facet checkScript alias without an exemption entry", () => {
    const scripts = new Map([
      ["docs:generate", "bun run scripts/generate.ts"],
      ["docs:generate:check", "bun run scripts/generate.ts -- --check"],
    ]);
    const { context, failures } = makeContext(scripts);

    checkScriptParity(
      {
        controlPrefixPattern: controlPrefix,
        exemptScripts: new Set(),
        declaredScripts: new Set(["docs:generate"]),
        aliasScripts: new Set(["docs:generate:check"]),
      },
      context,
    );

    expect(failures.size).toBe(0);
  });

  it("still fails a :check script with no backing generatedSurface record", () => {
    const scripts = new Map([["docs:orphan:check", "bun run scripts/orphan.ts -- --check"]]);
    const { context, failures } = makeContext(scripts);

    checkScriptParity(
      {
        controlPrefixPattern: controlPrefix,
        exemptScripts: new Set(),
        declaredScripts: new Set(),
        aliasScripts: new Set(),
      },
      context,
    );

    const message = failures.get("(parity)")?.failures.join("\n") ?? "";
    expect(message).toContain('"docs:orphan:check"');
    expect(message).toContain("not declared in harness.controls.json and not exempt");
  });

  it("rejects exemption entries that are already alias-covered", () => {
    const scripts = new Map([
      ["docs:generate", "bun run scripts/generate.ts"],
      ["docs:generate:check", "bun run scripts/generate.ts -- --check"],
    ]);
    const { context, failures } = makeContext(scripts);

    checkScriptParity(
      {
        controlPrefixPattern: controlPrefix,
        exemptScripts: new Set(["docs:generate:check"]),
        declaredScripts: new Set(["docs:generate"]),
        aliasScripts: new Set(["docs:generate:check"]),
      },
      context,
    );

    expect(failures.get("(parity)")?.failures).toEqual([
      'scriptParityExemptions includes "docs:generate:check", which is already covered as a ' +
        "generatedSurface checkScript alias; remove the redundant exemption",
    ]);
  });

  it("names the offending script and both remedies plus the regen command", () => {
    const scripts = new Map([["docs:lint-coverage-map:audit", "bun run scripts/x.ts"]]);
    const { context, failures } = makeContext(scripts);

    checkScriptParity(
      {
        controlPrefixPattern: controlPrefix,
        exemptScripts: new Set(),
        declaredScripts: new Set(),
        aliasScripts: new Set(),
      },
      context,
    );

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

    checkScriptParity(
      {
        controlPrefixPattern: controlPrefix,
        exemptScripts: new Set(["sensor:missing", "build"]),
        declaredScripts: new Set(),
        aliasScripts: new Set(),
      },
      context,
    );

    expect(failures.get("(parity)")?.failures).toEqual([
      'scriptParityExemptions names unknown package.json script "sensor:missing"',
      'scriptParityExemptions includes "build", which does not match the control-prefix convention',
    ]);
  });
});

describe("checkRuleParity", () => {
  // Lint-rule controls are generated into an include; the root manifest must
  // not carry them. The diagnostic therefore has to send the reader to the
  // refresh command, not to a hand edit of harness.controls.json.
  it("points a missing rule control at the generator, not at a hand edit", () => {
    const failures = new Map<string, ControlFailures>();

    checkRuleParity(new Set(["local/no-barrel"]), new Set(), failures);

    const [message] = failures.get("(parity)")?.failures ?? [];
    expect(message).toContain("local rule local/no-barrel is not declared");
    expect(message).toContain("bun run harness:lint-rule-controls");
    expect(message).not.toMatch(/add .* to harness\.controls\.json/u);
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

describe("manifest principle backlog coordinates", () => {
  function validatePrinciple(principle: string): readonly string[] {
    const { context, failures } = makeContext(new Map());
    validateNonLintEntry(
      {
        category: "maintainability",
        principle,
        pairedGuide: "none",
        repairKind: "manual",
        invocation: "bun run fixture",
      },
      "check/fixture",
      context,
    );
    return failures.get("check/fixture")?.failures ?? [];
  }

  it("rejects a bare backlog coordinate in a manifest principle", () => {
    expect(validatePrinciple("Keep the inventory from task 39.")).toContain(
      "principle contains a bare backlog coordinate: task 39",
    );
  });

  it("accepts a pack-qualified backlog coordinate in a manifest principle", () => {
    expect(validatePrinciple("Keep the floor from lint-review-2026-06 leaf 03e.")).toEqual([]);
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

  it("collects gate bindings from step env, ignoring ordinary CI steps", () => {
    const workflow = {
      jobs: {
        validate: {
          steps: [
            { name: "Install", run: "bun install" },
            {
              name: "Verify",
              env: { [CI_GATE_ENV_KEY]: "verify-wrapper/verify", FORCE_VERIFY: "1" },
              run: "  bun run verify\n",
            },
            { name: "Gate without a run", env: { [CI_GATE_ENV_KEY]: "verify-wrapper/runless" } },
          ],
        },
        report: { steps: [{ uses: "actions/upload-artifact@v4" }] },
      },
    };

    expect(collectCiGateBindings(workflow)).toEqual([
      { controlId: "verify-wrapper/verify", invocation: "bun run verify" },
      { controlId: "verify-wrapper/runless" },
    ]);
  });

  // A binding that is present but unusable is a malformed gate declaration, not
  // an ordinary step: projecting it away would let an added gate escape parity
  // entirely while the one expected gate keeps the check green.
  it("keeps a present-but-unusable gate binding instead of ignoring the step", () => {
    const steps = [null, "", "   ", 42, { nested: true }].map((value) => ({
      env: { [CI_GATE_ENV_KEY]: value },
      run: "bun run verify",
    }));

    expect(collectCiGateBindings({ jobs: { validate: { steps } } })).toEqual(
      [null, "", "   ", 42, { nested: true }].map((value) => ({
        controlId: value,
        invocation: "bun run verify",
      })),
    );
  });

  it("fails parity on a gate step whose control id is unusable", () => {
    const failures = new Map<string, ControlFailures>();

    checkCiGateBindings(
      [
        { controlId: "", invocation: "bun run verify" },
        { controlId: null, invocation: "bun run verify" },
        { controlId: "verify-wrapper/verify", invocation: "bun run verify" },
      ],
      new Map([["verify-wrapper/verify", "bun run verify"]]),
      failures,
    );

    const messages = failures.get("(CI parity)")?.failures ?? [];
    expect(messages).toEqual([
      'a CI step carries HARNESS_CI_GATE with an unusable control id: ""',
      "a CI step carries HARNESS_CI_GATE with an unusable control id: null",
    ]);
  });

  it("survives workflow shapes with no jobs, steps, or env blocks", () => {
    expect(collectCiGateBindings(undefined)).toEqual([]);
    expect(collectCiGateBindings({ jobs: { a: {} } })).toEqual([]);
    expect(collectCiGateBindings({ jobs: { a: { steps: [null, "x"] } } })).toEqual([]);
  });

  it("reports omitted, extra, and renamed CI gate scripts by manifest control id", () => {
    const failures = new Map<string, ControlFailures>();

    checkCiGateBindings(
      [
        { controlId: "verify-wrapper/verify", invocation: "bun run verify:changed" },
        { controlId: "verify-wrapper/extra", invocation: "bun run extra" },
      ],
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
      "ciGateControlIds declares verify-wrapper/local, but no CI step carries HARNESS_CI_GATE: verify-wrapper/local",
    );
  });

  it("reports a gate step whose run is missing rather than passing it", () => {
    const failures = new Map<string, ControlFailures>();

    checkCiGateBindings(
      [{ controlId: "verify-wrapper/verify" }],
      new Map([["verify-wrapper/verify", "bun run verify"]]),
      failures,
    );

    expect(failures.get("(CI parity)")?.failures.join("\n")).toContain("(missing run)");
  });

  it("rejects two steps claiming the same gate control id", () => {
    const failures = new Map<string, ControlFailures>();

    checkCiGateBindings(
      [
        { controlId: "verify-wrapper/verify", invocation: "bun run verify" },
        { controlId: "verify-wrapper/verify", invocation: "bun run verify" },
      ],
      new Map([["verify-wrapper/verify", "bun run verify"]]),
      failures,
    );

    expect(failures.get("(CI parity)")?.failures.join("\n")).toContain(
      "CI duplicates the HARNESS_CI_GATE binding for verify-wrapper/verify",
    );
  });
});
