import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const excludedCheckSpies = vi.hoisted(() => ({
  fixtureClosure: vi.fn(),
  portingDocs: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawnSync: excludedCheckSpies.spawn }));
vi.mock("./fixture-closure-check.js", () => ({
  checkFixtureCopyClosure: excludedCheckSpies.fixtureClosure,
}));
vi.mock("./porting-knob-parity.js", () => ({
  checkPortingKnobParity: excludedCheckSpies.portingDocs,
}));

import {
  collectRegistrationFailures,
  formatRegistrationFailures,
  loadRegistrationCheckInputs,
  type RegistrationCheckInputs,
} from "./registration-check.js";

const repoRoot = process.cwd();

function cloneManifest(manifest: unknown): Record<string, unknown> {
  return structuredClone(manifest) as Record<string, unknown>;
}

function controls(manifest: Record<string, unknown>): Record<string, unknown>[] {
  const value = manifest.controls;
  if (!Array.isArray(value)) throw new Error("fixture manifest has no controls array");
  return value as Record<string, unknown>[];
}

function control(manifest: Record<string, unknown>, id: string): Record<string, unknown> {
  const entry = controls(manifest).find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`fixture manifest has no ${id}`);
  return entry;
}

function withManifest(
  inputs: RegistrationCheckInputs,
  mutate: (manifest: Record<string, unknown>) => void,
): RegistrationCheckInputs {
  const rawManifest = cloneManifest(inputs.rawManifest);
  mutate(rawManifest);
  return { ...inputs, rawManifest };
}

function messages(failures: ReturnType<typeof collectRegistrationFailures>): string {
  return [...failures.values()].flatMap((entry) => entry.failures).join("\n");
}

describe("registration-only harness checks", () => {
  it("accepts the live repository registration state", async () => {
    const failures = collectRegistrationFailures(await loadRegistrationCheckInputs(repoRoot));

    expect(failures.size).toBe(0);
  });

  it("collects every included registration class without spawning behavioral checks", async () => {
    const base = await loadRegistrationCheckInputs(repoRoot);
    const cases: readonly {
      readonly name: string;
      readonly inputs: RegistrationCheckInputs;
      readonly expected: string;
      readonly repair: string | readonly string[];
    }[] = [
      {
        // Schema diagnostics fire against the ASSEMBLED manifest, so the entry
        // they name may live in either owner file. Both routes have to be in
        // the repair text or a malformed lint-rule control sends the reader to
        // harness.controls.json, which no longer holds one.
        name: "manifest shape",
        inputs: withManifest(base, (manifest) => {
          manifest.unregisteredTopLevelField = true;
        }),
        expected: "Unrecognized key",
        repair: ["harness.controls.json", "harness.controls.lint-rules.generated.json"],
      },
      {
        name: "manifest control entry shape",
        inputs: withManifest(base, (manifest) => {
          controls(manifest).push("not-an-object" as unknown as Record<string, unknown>);
        }),
        expected: "is not an object",
        repair: ["harness.controls.json", "harness.controls.lint-rules.generated.json"],
      },
      {
        name: "source reference",
        inputs: withManifest(base, (manifest) => {
          control(manifest, "hook/pre-commit").source = "missing-pre-commit-hook";
        }),
        expected: "source does not resolve to an existing file",
        repair: "missing-pre-commit-hook",
      },
      {
        name: "package script reference",
        inputs: {
          ...base,
          scripts: new Map([...base.scripts].filter(([name]) => name !== "lint")),
        },
        expected: "invocation references unknown package.json script: lint",
        repair: "package.json",
      },
      {
        name: "verify slot validity",
        inputs: withManifest(base, (manifest) => {
          const catalog = manifest.verifySlotCatalog;
          if (!Array.isArray(catalog)) throw new Error("fixture manifest has no slot catalog");
          const lint = (catalog as Record<string, unknown>[]).find(
            (entry) => entry.name === "lint",
          );
          if (lint === undefined) throw new Error("fixture slot catalog has no lint entry");
          const full = lint.full;
          if (typeof full !== "object" || full === null) {
            throw new Error("fixture lint entry has no full slot");
          }
          (full as Record<string, unknown>).script = "missing:slot-script";
          const changed = lint.changed;
          if (typeof changed !== "object" || changed === null) {
            throw new Error("fixture lint entry has no changed disposition");
          }
          const changedSlot = (changed as Record<string, unknown>).slot;
          if (typeof changedSlot !== "object" || changedSlot === null) {
            throw new Error("fixture lint entry has no changed slot");
          }
          (changedSlot as Record<string, unknown>).script = "missing:slot-script";
        }),
        expected: "references unknown package.json script: missing:slot-script",
        repair: "bun run verify:steps",
      },
      {
        name: "verify registration freshness",
        inputs: {
          ...base,
          readOutput: (path) =>
            path === "scripts/verify/steps.generated.sh"
              ? "stale\n"
              : readFileSync(join(repoRoot, path), "utf8"),
        },
        expected: "scripts/verify/steps.generated.sh is out of date",
        repair: "bun run verify:steps",
      },
      {
        name: "package script parity",
        inputs: { ...base, scripts: new Map([...base.scripts, ["harness:orphan", "true"]]) },
        expected: 'package.json script "harness:orphan"',
        repair: "scriptParityExemptions",
      },
      {
        name: "local rule parity",
        inputs: {
          ...base,
          localRuleConfig: {
            ...base.localRuleConfig,
            registeredRuleNames: new Set([
              ...base.localRuleConfig.registeredRuleNames,
              "local/unregistered-test-rule",
            ]),
          },
        },
        expected: "local rule local/unregistered-test-rule is not declared",
        repair: "manifest",
      },
      {
        // Regression: the ratchet direction of the activation-mode check. Its
        // absence is what let lint/local/no-plain-error-in-trpc advertise
        // `bun run lint:ratchet` after the rule was promoted to normal lint.
        name: "lint rule activation mode (ratchet claim for an enabled rule)",
        inputs: withManifest(base, (manifest) => {
          control(manifest, "lint/local/no-barrel").invocation = "bun run lint:ratchet";
        }),
        expected: "but it is enabled in eslint.config.js",
        repair: "harness:lint-rule-controls",
      },
      {
        name: "lint rule activation mode (normal-lint claim for a disabled rule)",
        inputs: {
          ...base,
          localRuleConfig: {
            ...base.localRuleConfig,
            enabledRuleNames: new Set(
              [...base.localRuleConfig.enabledRuleNames].filter(
                (name) => name !== "local/no-barrel",
              ),
            ),
          },
        },
        expected: "claims normal ESLint coverage",
        repair: "bun run lint:ratchet",
      },
      {
        name: "lint overlay parity",
        inputs: { ...base, overlayRuleIds: new Set([...base.overlayRuleIds, "test-overlay"]) },
        expected: "lint-agent overlay test-overlay is not declared",
        repair: "lint/test-overlay",
      },
      {
        name: "ratchet parity",
        inputs: { ...base, ratchetIds: new Set([...base.ratchetIds, "ratchet/test-registration"]) },
        expected: "ratchet/test-registration",
        repair: "harness.controls.json",
      },
      {
        name: "doctor id parity",
        inputs: {
          ...base,
          doctorSource: `${base.doctorSource}\nprintf '%s' 'doctor-check/test-registration'\n`,
        },
        expected: "doctor.sh emits doctor-check/test-registration",
        repair: "harness.controls.json",
      },
      {
        name: "generated surface schema",
        inputs: withManifest(base, (manifest) => {
          const surface = control(manifest, "check/verify-steps-generator").generatedSurface;
          if (typeof surface !== "object" || surface === null) throw new Error("surface missing");
          (surface as Record<string, unknown>).checkScript = "";
        }),
        expected: "invalid generatedSurface records",
        repair: "harness.controls.json",
      },
      {
        name: "generated check script registration",
        inputs: withManifest(base, (manifest) => {
          const surface = control(manifest, "check/verify-steps-generator").generatedSurface;
          if (typeof surface !== "object" || surface === null) throw new Error("surface missing");
          (surface as Record<string, unknown>).checkScript = "harness:missing-generated-check";
        }),
        expected: "references unknown package.json check script",
        repair: "package.json",
      },
      {
        name: "generated trigger and output metadata",
        inputs: withManifest(base, (manifest) => {
          const surface = control(manifest, "check/verify-steps-generator").generatedSurface;
          if (typeof surface !== "object" || surface === null) throw new Error("surface missing");
          (surface as Record<string, unknown>).triggerPaths = ["../outside-repository"];
        }),
        expected: "generatedSurface.triggerPaths entry must resolve under repoRoot",
        repair: "harness.controls.json",
      },
      {
        name: "generated Bun classifier freshness",
        inputs: {
          ...base,
          readOutput: (path) =>
            path === "scripts/ai-hooks/classified-bun-scripts.generated.sh"
              ? "stale\n"
              : readFileSync(join(repoRoot, path), "utf8"),
        },
        expected: "scripts/ai-hooks/classified-bun-scripts.generated.sh is out of date",
        repair: "bun run verify:steps",
      },
      {
        name: "skill mirror registration",
        inputs: withManifest(base, (manifest) => {
          const skill = controls(manifest).find((entry) => entry.kind === "skill");
          if (skill === undefined) throw new Error("skill fixture missing");
          const wiring = skill.skillWiring;
          if (typeof wiring !== "object" || wiring === null)
            throw new Error("skill wiring missing");
          (wiring as Record<string, unknown>).canonical = ".claude/skills/missing-registration";
        }),
        expected: "canonical path must match exactly one target",
        repair: "bun run harness:skills:refresh",
      },
      {
        name: "skill smoke-subject projection freshness",
        inputs: withManifest(base, (manifest) => {
          const skill = controls(manifest).find((entry) => entry.kind === "skill");
          if (skill === undefined) throw new Error("skill fixture missing");
          const wiring = skill.skillWiring;
          if (typeof wiring !== "object" || wiring === null)
            throw new Error("skill wiring missing");
          (wiring as Record<string, unknown>).smokeTest = "scripts/tests/test-verify.sh";
        }),
        expected: "generated smoke-subject output is stale",
        repair: "bun run harness:skills:refresh",
      },
    ];

    for (const fixture of cases) {
      const output = messages(collectRegistrationFailures(fixture.inputs));
      expect(output, fixture.name).toContain(fixture.expected);
      const repairs = typeof fixture.repair === "string" ? [fixture.repair] : fixture.repair;
      for (const repair of repairs) expect(output, fixture.name).toContain(repair);
    }
    expect(excludedCheckSpies.spawn).not.toHaveBeenCalled();
    expect(excludedCheckSpies.fixtureClosure).not.toHaveBeenCalled();
    expect(excludedCheckSpies.portingDocs).not.toHaveBeenCalled();
  });

  it("formats the shared findings for both entrypoints without changing repair text", async () => {
    const base = await loadRegistrationCheckInputs(repoRoot);
    const inputs = withManifest(base, (manifest) => {
      control(manifest, "hook/pre-commit").source = "missing-pre-commit-hook";
    });
    const failures = collectRegistrationFailures(inputs);

    const full = formatRegistrationFailures("harness:check", failures);
    const registration = formatRegistrationFailures("harness:registration:check", failures);
    expect(full.replace("harness:check", "COMMAND")).toBe(
      registration.replace("harness:registration:check", "COMMAND"),
    );
    expect(full).toContain("missing-pre-commit-hook");
  });
});
