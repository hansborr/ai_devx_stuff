import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  checkFixtureCopyClosure,
  FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV,
} from "./fixture-closure-check.js";
import {
  deriveGeneratedSurfaceDependencies,
  renderFixtureManifest,
} from "./generated-surface-dependencies.js";
import { type FixtureExtra } from "./generated-surfaces.js";
import { loadGeneratedSurfaces } from "./generated-surfaces-loader.js";
import { type ControlFailures } from "./harness-check-validation.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";
import { GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH } from "./harness-paths.js";

const tmpRepo = registerTempRootCleanup();

const WALK_SOURCES = {
  "scripts/harness-check.ts": "export const fixtureValidatorRoot = true;\n",
  "scripts/harness-registration-check.ts": "export const fixtureRegistrationRoot = true;\n",
  "scripts/alpha-generator.ts": 'import "./lib/helper.js";\n',
  "scripts/lib/helper.ts": "export const helper = true;\n",
  "scripts/runtime.sh": "#!/usr/bin/env bash\n",
} as const;

const FULL_CLOSURE = [
  "scripts/harness-check.ts",
  "scripts/harness-registration-check.ts",
  "scripts/alpha-generator.ts",
  "scripts/lib/helper.ts",
] as const;

interface ClosureRepoOptions {
  readonly fixtureExtras?: readonly FixtureExtra[];
  readonly triggerPaths?: readonly string[];
  readonly staleProjection?: boolean;
}

function manifestSource(options: ClosureRepoOptions): string {
  return JSON.stringify({
    scriptParityExemptions: [],
    ciGateControlIds: [],
    controls: [
      {
        id: "check/alpha-generator",
        kind: "check",
        category: "maintainability",
        principle: "Fixture generator control for import-closure tests.",
        pairedGuide: "none",
        repairKind: "autofix",
        source: "scripts/alpha-generator.ts",
        invocation: "bun run alpha",
        generatedSurface: {
          triggerPaths: options.triggerPaths ?? [
            "scripts/alpha-generator.ts",
            "scripts/lib/helper.ts",
          ],
          outputPaths: ["generated/alpha.txt"],
          checkScript: "alpha:check",
          warnLabel: "alpha output",
          bunHook: { refresh: "bypass", check: "wrapped" },
          ...(options.fixtureExtras === undefined ? {} : { fixtureExtras: options.fixtureExtras }),
        },
      },
    ],
  });
}

function makeClosureRepo(options: ClosureRepoOptions = {}): string {
  const fixturePaths = [
    ...FULL_CLOSURE,
    ...(options.fixtureExtras ?? []).map((extra) => extra.path),
  ];
  return tmpRepo.writeRepo(
    {
      ...WALK_SOURCES,
      [HARNESS_MANIFEST_FILENAME]: manifestSource(options),
      [GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH]: options.staleProjection
        ? "# stale\n"
        : renderFixtureManifest(fixturePaths),
    },
    "fixture-closure-check-",
  );
}

async function runValidator(root: string): Promise<string[]> {
  const failures = new Map<string, ControlFailures>();
  await checkFixtureCopyClosure(root, loadGeneratedSurfaces(root), failures);
  return Array.from(failures.values()).flatMap((entry) => entry.failures);
}

beforeEach(() => {
  vi.stubEnv(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkFixtureCopyClosure (orchestration over a temp repo)", () => {
  const runtimeExtra = {
    path: "scripts/runtime.sh",
    reason: "Executed by the reduced fixture.",
  } as const;

  it("passes with a fresh derived projection and reasoned residue", async () => {
    const root = makeClosureRepo({ fixtureExtras: [runtimeExtra] });
    expect(await runValidator(root)).toEqual([]);
  });

  it("fails when residue repeats a dependency the walker derives", async () => {
    const root = makeClosureRepo({
      fixtureExtras: [{ path: "scripts/lib/helper.ts", reason: "Mechanical import-closure echo." }],
    });
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/helper.ts");
    expect(failures[0]).toContain("fixtureExtras");
  });

  it("fails an extra that resolves to a directory, not a regular file", async () => {
    const root = makeClosureRepo({
      fixtureExtras: [{ path: "scripts/lib", reason: "Invalid directory copy." }],
    });
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib");
    expect(failures[0]).toContain("does not resolve to a regular file");
  });

  it("fails an extra that does not exist", async () => {
    const root = makeClosureRepo({
      fixtureExtras: [{ path: "scripts/lib/gone.sh", reason: "Missing runtime helper." }],
    });
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/gone.sh");
    expect(failures[0]).toContain("does not resolve to a regular file");
  });

  it("fails when the checked-in derived projection is stale", async () => {
    const root = makeClosureRepo({ fixtureExtras: [runtimeExtra], staleProjection: true });
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH);
    expect(failures[0]).toContain("bun run verify:steps");
  });

  it("fails on a generator import that no triggerPaths entry covers", async () => {
    const root = makeClosureRepo({
      fixtureExtras: [runtimeExtra],
      triggerPaths: ["scripts/alpha-generator.ts"],
    });
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("check/alpha-generator");
    expect(failures[0]).toContain("scripts/lib/helper.ts");
    expect(failures[0]).toContain("triggerPaths");
  });

  it("fails closed when no record declares fixtureExtras", async () => {
    const root = makeClosureRepo();
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no generatedSurface record declares fixtureExtras");
    expect(failures[0]).toContain(HARNESS_MANIFEST_FILENAME);
    expect(failures[0]).toContain(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV);
  });

  it("skips derivation only under the explicit fixture opt-out", async () => {
    const root = makeClosureRepo();
    vi.stubEnv(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV, "1");
    expect(await runValidator(root)).toEqual([]);
  });

  it("does not let the zero-declaration opt-out suppress declared validation", async () => {
    const root = makeClosureRepo({
      fixtureExtras: [
        runtimeExtra,
        { path: "scripts/lib/helper.ts", reason: "Mechanical import-closure echo." },
        { path: "scripts/missing.sh", reason: "Missing declared runtime file." },
      ],
      staleProjection: true,
      triggerPaths: ["scripts/alpha-generator.ts"],
    });
    vi.stubEnv(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV, "1");

    const failures = await runValidator(root);

    expect(failures.some((failure) => failure.includes("scripts/lib/helper.ts"))).toBe(true);
    expect(
      failures.some(
        (failure) =>
          failure.includes("scripts/missing.sh") &&
          failure.includes("does not resolve to a regular file"),
      ),
    ).toBe(true);
    expect(failures.some((failure) => failure.includes("triggerPaths"))).toBe(true);
    expect(
      failures.some((failure) => failure.includes(GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH)),
    ).toBe(true);
  });

  it("derives a fully hand-declared list when the walker is unavailable", async () => {
    const root = makeClosureRepo({
      fixtureExtras: FULL_CLOSURE.map((path) => ({
        path,
        reason: "Fully declared by a repository that cannot run the import walker.",
      })),
    });
    const records = loadGeneratedSurfaces(root);
    const loadClosureWalker = vi.fn(() => Promise.reject(new Error("walker unavailable")));

    const dependencies = await deriveGeneratedSurfaceDependencies(root, records, {
      allowDeclaredFallback: true,
      loadClosureWalker,
    });

    expect(loadClosureWalker).toHaveBeenCalledOnce();
    expect(dependencies.failures).toEqual([]);
    expect(dependencies.entryClosures).toEqual([]);
    expect(dependencies.fixturePaths).toEqual([
      "scripts/alpha-generator.ts",
      "scripts/harness-check.ts",
      "scripts/harness-registration-check.ts",
      "scripts/lib/helper.ts",
    ]);
  });

  it("still fails closed under an opt-out value other than 1", async () => {
    const root = makeClosureRepo();
    vi.stubEnv(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV, "true");
    const failures = await runValidator(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV);
  });

  it("aggregates a directory-shaped extra with other closure diagnostics", async () => {
    const root = makeClosureRepo({
      fixtureExtras: [{ path: "scripts/harness/", reason: "Invalid directory copy." }],
      staleProjection: true,
      triggerPaths: ["scripts/alpha-generator.ts"],
    });

    const failures = await runValidator(root);

    expect(failures.some((failure) => failure.includes("does not resolve to a regular file"))).toBe(
      true,
    );
    expect(failures.some((failure) => failure.includes("must be plain files"))).toBe(true);
    expect(failures.some((failure) => failure.includes("triggerPaths"))).toBe(true);
  });
});
