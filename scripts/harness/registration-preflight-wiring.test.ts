import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { VERIFY_STEP_PROJECTIONS } from "./generate-verify-steps.js";
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
    fixtureClosureSource: readFileSync(
      join(repoRoot, "scripts/harness/fixture-closure-check.ts"),
      "utf8",
    ),
    packageScripts: packageScripts(),
    manifest: readHarnessManifest(repoRoot),
    generatedSurfaces: loadGeneratedSurfaces(repoRoot),
    verifyStepProjections: VERIFY_STEP_PROJECTIONS,
  };
}

describe("registration preflight self-wiring", () => {
  it("accepts the live direct hook and structural fragment wiring", () => {
    expect(checkRegistrationPreflightWiring(liveInputs())).toEqual([]);
  });

  it("accepts shell-equivalent registration timeout reflow", () => {
    const inputs = liveInputs();
    const hookSource = inputs.hookSource
      .replace(
        `printf 'pre-commit: invalid MUSI_PRECOMMIT_REGISTRATION_TIMEOUT=%s; expected positive whole seconds without a suffix or leading zero (for example, 30)\\n' \\
      "$MUSI_PRECOMMIT_REGISTRATION_TIMEOUT" >&2`,
        `printf 'pre-commit: invalid MUSI_PRECOMMIT_REGISTRATION_TIMEOUT=%s; expected positive whole seconds without a suffix or leading zero (for example, 30)\\n' "$MUSI_PRECOMMIT_REGISTRATION_TIMEOUT" >&2`,
      )
      .replace(
        `timeout --foreground --signal=TERM --kill-after=1s \\
    "\${MUSI_PRECOMMIT_REGISTRATION_TIMEOUT}s" \\
    bun run harness:registration:check`,
        `timeout --foreground --signal=TERM --kill-after=1s "\${MUSI_PRECOMMIT_REGISTRATION_TIMEOUT}s" bun run harness:registration:check`,
      );

    expect(checkRegistrationPreflightWiring({ ...inputs, hookSource })).toEqual([]);
  });

  it("accepts shell-equivalent block-boundary and case-pattern reflow", () => {
    const inputs = liveInputs();
    const hookSource = inputs.hookSource
      // `name ()` with the brace on its own line, and an indented terminator.
      .replace(
        "musi_precommit_snapshot_fast_mode() {\n",
        "musi_precommit_snapshot_fast_mode ()\n{\n",
      )
      .replace('  return "$snapshot_rc"\n}\n', '  return "$snapshot_rc"\n  }\n')
      // A rewrapped call inside the snapshot function.
      .replace(
        "    musi_warn_generated_surfaces_stale || true\n",
        "    musi_warn_generated_surfaces_stale \\\n      || true\n",
      )
      // Case-alternation spacing and an indented `esac`.
      .replace("  '' | *[!0-9]* | 0*)\n", "  ''|*[!0-9]*|0*)\n")
      .replace("    ;;\nesac\n", "    ;;\n  esac\n");

    expect(hookSource).not.toEqual(inputs.hookSource);
    expect(checkRegistrationPreflightWiring({ ...inputs, hookSource })).toEqual([]);
  });

  it("accepts a hook without the staged NUL guard when its manifest omits that control", () => {
    const inputs = liveInputs();
    const hookSource = inputs.hookSource.replace(
      "musi_staged_source_blobs_reject_nul || exit $?\n",
      "",
    );
    const manifest = {
      ...(inputs.manifest as Record<string, unknown>),
      controls: (inputs.manifest as { readonly controls: readonly unknown[] }).controls.filter(
        (entry) =>
          typeof entry !== "object" ||
          entry === null ||
          (entry as { readonly id?: unknown }).id !== "check/staged-source-nul",
      ),
    };

    expect(checkRegistrationPreflightWiring({ ...inputs, hookSource, manifest })).toEqual([]);
  });

  it("accepts manifest outputPaths declared in a different order", () => {
    const inputs = liveInputs();
    const generatedSurfaces = inputs.generatedSurfaces.map((record) =>
      record.id === "check/verify-steps-generator"
        ? { ...record, outputPaths: [...record.outputPaths].reverse() }
        : record,
    );

    expect(checkRegistrationPreflightWiring({ ...inputs, generatedSurfaces })).toEqual([]);
  });

  it("pins call presence, ordering, script, control, and projection parity", () => {
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
        hookSource: base.hookSource.replace(
          "${MUSI_PRECOMMIT_REGISTRATION_TIMEOUT:-$MUSI_GATE_PRECOMMIT_REGISTRATION_TIMEOUT_DEFAULT}",
          "${MUSI_PRECOMMIT_REGISTRATION_TIMEOUT:-5}",
        ),
      },
      {
        ...base,
        hookSource: base.hookSource.replace("'' | *[!0-9]* | 0*)", "'' | *[!0-9]*)"),
      },
      {
        ...base,
        hookSource: base.hookSource.replace("expected positive whole seconds", "expected seconds"),
      },
      {
        ...base,
        hookSource: base.hookSource.replace('"${MUSI_PRECOMMIT_REGISTRATION_TIMEOUT}s"', "45s"),
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
        hookSource: base.hookSource.replace("musi_staged_source_blobs_reject_nul || exit $?\n", ""),
      },
      {
        ...base,
        hookSource: base.hookSource
          .replace("musi_staged_source_blobs_reject_nul || exit $?\n", "")
          .replace(
            "musi_staged_has_source_relevant_change || staged_source_rc=$?\n",
            "musi_staged_has_source_relevant_change || staged_source_rc=$?\n" +
              "musi_staged_source_blobs_reject_nul || exit $?\n",
          ),
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
          "renderProjectionsFor",
          "inlinedProjections",
        ),
      },
      {
        ...base,
        fixtureClosureSource: base.fixtureClosureSource.replaceAll(
          "renderProjectionsFor",
          "inlinedProjections",
        ),
      },
      // Only the call is replaced: the import and the comment still mention the
      // renderer by name, so an occurrence-counting anchor would pass this.
      {
        ...base,
        collectorSource: base.collectorSource.replaceAll(
          'renderProjectionsFor("collector"',
          'inlinedProjections("collector"',
        ),
      },
      {
        ...base,
        fixtureClosureSource: base.fixtureClosureSource.replaceAll(
          'renderProjectionsFor("fixtureClosure"',
          'inlinedProjections("fixtureClosure"',
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
      {
        ...base,
        verifyStepProjections: [
          ...base.verifyStepProjections,
          {
            outputPath: "scripts/verify/unregistered.generated.sh",
            checkedBy: "collector",
            requires: [],
            render: () => "",
          },
        ],
      },
      // Mis-tagged ownership: the paths still agree with the manifest, but the
      // collector pass never carries fixturePaths, so this output would be
      // rendered by nobody and re-checked by nobody.
      {
        ...base,
        verifyStepProjections: base.verifyStepProjections.map((projection) =>
          projection.checkedBy === "fixtureClosure"
            ? { ...projection, checkedBy: "collector" as const }
            : projection,
        ),
      },
      {
        ...base,
        generatedSurfaces: base.generatedSurfaces.filter(
          (record) => record.id !== "check/verify-steps-generator",
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
