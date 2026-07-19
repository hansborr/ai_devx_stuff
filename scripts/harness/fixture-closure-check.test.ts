import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  checkFixtureCopyClosure,
  FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV,
} from "./fixture-closure-check.js";
import { type ControlFailures } from "./harness-check-validation.js";
import { HARNESS_MANIFEST_FILENAME } from "./harness-manifest.js";

const tmpRepo = registerTempRootCleanup();

// Minimal walkable tree: the validator root plus one generator whose static
// import closure is exactly {alpha-generator.ts, lib/helper.ts}.
const WALK_SOURCES = {
  "scripts/harness-check.ts": "export const fixtureValidatorRoot = true;\n",
  "scripts/alpha-generator.ts": 'import "./lib/helper.js";\n',
  "scripts/lib/helper.ts": "export const helper = true;\n",
} as const;

const FULL_CLOSURE = [
  "scripts/harness-check.ts",
  "scripts/alpha-generator.ts",
  "scripts/lib/helper.ts",
] as const;

function manifestSource(fixturePaths?: readonly string[]): string {
  return JSON.stringify({
    controls: [
      {
        id: "check/alpha-generator",
        kind: "check",
        source: "scripts/alpha-generator.ts",
        invocation: "bun run alpha",
        generatedSurface: {
          triggerPaths: ["scripts/alpha-generator.ts"],
          outputPaths: ["generated/alpha.txt"],
          checkScript: "alpha:check",
          warnLabel: "alpha output",
          bunHook: { refresh: "bypass", check: "wrapped" },
          ...(fixturePaths === undefined ? {} : { fixturePaths }),
        },
      },
    ],
  });
}

function makeClosureRepo(fixturePaths?: readonly string[]): string {
  return tmpRepo.writeRepo(
    { ...WALK_SOURCES, [HARNESS_MANIFEST_FILENAME]: manifestSource(fixturePaths) },
    "fixture-closure-check-",
  );
}

async function runValidator(root: string): Promise<string[]> {
  const failures = new Map<string, ControlFailures>();
  await checkFixtureCopyClosure(root, failures);
  return Array.from(failures.values()).flatMap((entry) => entry.failures);
}

beforeEach(() => {
  vi.stubEnv(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkFixtureCopyClosure (orchestration over a temp repo)", () => {
  it("passes when the declarations cover the computed closure exactly", async () => {
    const root = makeClosureRepo([...FULL_CLOSURE]);
    expect(await runValidator(root)).toEqual([]);
  });

  it("fails on a closure file that no record declares", async () => {
    const root = makeClosureRepo(["scripts/harness-check.ts", "scripts/alpha-generator.ts"]);
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/helper.ts");
    expect(failures[0]).toContain("fixturePaths");
  });

  it("fails on a stale declared TypeScript file outside the closure", async () => {
    const root = makeClosureRepo([...FULL_CLOSURE, "scripts/lib/stale.ts"]);
    tmpRepo.writeRepoFile(root, "scripts/lib/stale.ts", "export const stale = true;\n");
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/stale.ts");
    expect(failures[0]).toContain("not in the computed fixture import closure");
  });

  it("fails a fixturePaths entry that resolves to a directory, not a regular file", async () => {
    // "scripts/lib" exists (helper.ts lives there) but is a directory; the
    // fixture copy loop runs plain `cp`, so directories must be rejected here.
    const root = makeClosureRepo([...FULL_CLOSURE, "scripts/lib"]);
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib");
    expect(failures[0]).toContain("does not resolve to a regular file");
  });

  it("fails a fixturePaths entry that does not exist at all", async () => {
    const root = makeClosureRepo([...FULL_CLOSURE, "scripts/lib/gone.sh"]);
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("scripts/lib/gone.sh");
    expect(failures[0]).toContain("does not resolve to a regular file");
  });

  it("fails closed when no record declares fixturePaths", async () => {
    const root = makeClosureRepo();
    const failures = await runValidator(root);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("no generatedSurface record declares fixturePaths");
    expect(failures[0]).toContain(HARNESS_MANIFEST_FILENAME);
    expect(failures[0]).toContain(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV);
  });

  it("skips the walk only under the explicit fixture opt-out", async () => {
    // Same tree as the fail-closed case: if the walk ran anyway, the undeclared
    // closure files would fail, so an empty result proves the explicit skip.
    const root = makeClosureRepo();
    vi.stubEnv(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV, "1");
    expect(await runValidator(root)).toEqual([]);
  });

  it("still fails closed under an opt-out value other than 1", async () => {
    const root = makeClosureRepo();
    vi.stubEnv(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV, "true");
    const failures = await runValidator(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(FIXTURE_CLOSURE_NO_DECLARATIONS_OPT_OUT_ENV);
  });
});
