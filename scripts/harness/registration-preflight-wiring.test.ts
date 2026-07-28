import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadGeneratedSurfaces } from "./generated-surfaces-loader.js";
import { readHarnessManifest } from "./harness-manifest.js";
import {
  checkRegistrationPreflightWiring,
  REGISTRATION_PREFLIGHT_WIRING_REPAIR,
  type RegistrationPreflightWiringInputs,
} from "./registration-preflight-wiring.js";

const repoRoot = process.cwd();

function packageScripts(): ReadonlyMap<string, string> {
  const parsed = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    readonly scripts: Record<string, string>;
  };
  return new Map(Object.entries(parsed.scripts));
}

function liveInputs(): RegistrationPreflightWiringInputs {
  return {
    hookSource: readFileSync(join(repoRoot, ".husky/pre-commit"), "utf8"),
    engineSource: readFileSync(join(repoRoot, "scripts/lib/verify-engine.sh"), "utf8"),
    collectorSource: readFileSync(
      join(repoRoot, "scripts/harness/registration-generated-checks.ts"),
      "utf8",
    ),
    packageScripts: packageScripts(),
    manifest: readHarnessManifest(repoRoot),
    generatedSurfaces: loadGeneratedSurfaces(repoRoot),
  };
}

describe("registration preflight self-wiring", () => {
  it("accepts the live direct hook and structural fragment wiring", () => {
    expect(checkRegistrationPreflightWiring(liveInputs())).toEqual([]);
  });

  it("pins call presence, ordering, script, control, and fragment coverage", () => {
    const base = liveInputs();
    const cases: readonly RegistrationPreflightWiringInputs[] = [
      {
        ...base,
        hookSource: base.hookSource.replace(
          '  [pre_cache_admission_hook]="$REGISTRATION_ADMISSION_HOOK"\n',
          "",
        ),
      },
      {
        ...base,
        hookSource: base.hookSource.replace(
          "[pre_cache_admission_condition]='musi_precommit_snapshot_fast_mode'",
          "[pre_cache_admission_condition]=''",
        ),
      },
      {
        ...base,
        hookSource: base.hookSource.replace(
          '[ "${MUSI_FAST_COMMIT_ENABLED_SNAPSHOT:-0}" -eq 1 ]',
          '[ -f "$(musi_precommit_fast_marker)" ]',
        ),
      },
      {
        ...base,
        hookSource: base.hookSource
          .replace(
            '  [pre_cache_admission_hook]="$REGISTRATION_ADMISSION_HOOK"\n',
            '  [pre_cache_admission_hook]="$REGISTRATION_ADMISSION_HOOK"\n# moved too early\n',
          )
          .replace('musi_changed_gate_fail_if_unstaged "$REPO_ROOT" "pre-commit" || exit 1\n', ""),
      },
      {
        ...base,
        packageScripts: new Map(
          [...base.packageScripts].map(([name, command]) => [
            name,
            name === "harness:registration:check" ? "true" : command,
          ]),
        ),
      },
      {
        ...base,
        manifest: {
          ...(base.manifest as Record<string, unknown>),
          controls: (base.manifest as { readonly controls: readonly unknown[] }).controls.filter(
            (entry) =>
              typeof entry !== "object" ||
              entry === null ||
              (entry as { readonly id?: unknown }).id !== "check/harness-registration-preflight",
          ),
        },
      },
      {
        ...base,
        collectorSource: base.collectorSource.replaceAll(
          "GENERATED_VERIFY_STEPS_PATH",
          "REMOVED_PATH",
        ),
      },
      {
        ...base,
        generatedSurfaces: base.generatedSurfaces.map((record) =>
          record.id === "check/verify-steps-generator"
            ? {
                ...record,
                outputPaths: record.outputPaths.filter(
                  (path) => path !== "scripts/harness/generated-surface-freshness.generated.sh",
                ),
              }
            : record,
        ),
      },
    ];

    for (const inputs of cases) {
      const failures = checkRegistrationPreflightWiring(inputs);
      expect(failures).toHaveLength(1);
      expect((failures[0] ?? "").endsWith(REGISTRATION_PREFLIGHT_WIRING_REPAIR)).toBe(true);
    }
  });
});
