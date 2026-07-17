import { describe, expect, it } from "vitest";

import {
  classifyClientTestFileSource,
  classifyClientTestIsolation,
  runClientTestIsolationClassifierCli,
} from "./client-test-isolation-classifier.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();

function makeRepo(): string {
  return tmpRepo.makeTempRepo("client-test-isolation-classifier-");
}

function writeFixture(root: string, relativePath: string, source: string): void {
  tmpRepo.writeRepoFile(root, relativePath, source);
}

describe("classifyClientTestFileSource", () => {
  it("keeps comments, strings, and vi.mocked helper calls in the no-isolate bucket", () => {
    const result = classifyClientTestFileSource({
      file: "packages/client/src/hooks/example.test.ts",
      source: `
        import { vi } from "vitest";

        // vi.mock("@/lib/trpc.js") is only documentation here.
        const message = "vi.unmock should not count inside a string";
        const mockedFetch = vi.mocked(fetch);

        mockedFetch.mockResolvedValue(new Response("{}"));
        expect(message).toContain("vi.unmock");
      `,
    });

    expect(result.mode).toBe("no-isolate");
    expect(result.reasons).toEqual([]);
  });

  it("classifies direct vi.mock and vi.unmock calls as isolated", () => {
    const result = classifyClientTestFileSource({
      file: "packages/client/src/pages/example.test.tsx",
      source: `
        import { vi } from "vitest";

        vi.mock("@/lib/trpc.js", () => ({}));
        vi.unmock("./real-module.js");
      `,
    });

    expect(result.mode).toBe("isolated");
    expect(result.reasons).toEqual([
      {
        kind: "module-registry-mutation",
        line: 4,
        method: "mock",
        expression: 'vi.mock("@/lib/trpc.js")',
        moduleName: "@/lib/trpc.js",
      },
      {
        kind: "module-registry-mutation",
        line: 5,
        method: "unmock",
        expression: 'vi.unmock("./real-module.js")',
        moduleName: "./real-module.js",
      },
    ]);
  });

  it("detects vitest vi aliases and method aliases", () => {
    const result = classifyClientTestFileSource({
      file: "packages/client/src/components/example.test.tsx",
      source: `
        import { vi as vitestVi } from "vitest";

        const registry = vitestVi;
        const resetRegistry = registry.resetModules;
        const { doMock } = registry;

        doMock("./mocked.js", () => ({}));
        resetRegistry();
      `,
    });

    expect(result.mode).toBe("isolated");
    expect(result.reasons).toEqual([
      {
        kind: "module-registry-mutation",
        line: 8,
        method: "doMock",
        expression: 'doMock("./mocked.js")',
        moduleName: "./mocked.js",
      },
      {
        kind: "module-registry-mutation",
        line: 9,
        method: "resetModules",
        expression: "resetRegistry()",
      },
    ]);
  });

  it("detects non-null asserted vi registry mutations", () => {
    const result = classifyClientTestFileSource({
      file: "packages/client/src/components/example.test.tsx",
      source: `
        import { vi } from "vitest";

        vi!.mock("./mocked.js", () => ({}));
      `,
    });

    expect(result.mode).toBe("isolated");
    expect(result.reasons).toEqual([
      {
        kind: "module-registry-mutation",
        line: 4,
        method: "mock",
        expression: 'vi!.mock("./mocked.js")',
        moduleName: "./mocked.js",
      },
    ]);
  });
});

describe("classifyClientTestIsolation", () => {
  it("discovers client test files, excludes slow tests, and returns sorted buckets", () => {
    const root = makeRepo();
    writeFixture(
      root,
      "packages/client/src/z-fast.test.ts",
      'import { vi } from "vitest"; vi.mocked(fetch);\n',
    );
    writeFixture(
      root,
      "packages/client/src/a-isolated.test.tsx",
      'import { vi } from "vitest"; vi.doUnmock("./real.js");\n',
    );
    writeFixture(
      root,
      "packages/client/src/ignored.slow.test.ts",
      'import { vi } from "vitest"; vi.mock("./slow.js");\n',
    );

    const result = classifyClientTestIsolation({ cwd: root });

    expect(result.noIsolateFiles).toEqual(["packages/client/src/z-fast.test.ts"]);
    expect(result.isolatedFiles.map((file) => file.file)).toEqual([
      "packages/client/src/a-isolated.test.tsx",
    ]);
    expect(result.totals).toEqual({ testFiles: 2, noIsolate: 1, isolated: 1 });
  });
});

describe("runClientTestIsolationClassifierCli", () => {
  it("emits JSON for the generated split", () => {
    const root = makeRepo();
    writeFixture(
      root,
      "packages/client/src/no-mock.test.tsx",
      'import { vi } from "vitest"; vi.mocked(fetch);\n',
    );
    writeFixture(
      root,
      "packages/client/src/uses-mock.test.ts",
      'import { vi } from "vitest"; vi.mock("@/lib/trpc.js");\n',
    );

    const result = runClientTestIsolationClassifierCli({ argv: ["--json"], cwd: root });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      noIsolateFiles: ["packages/client/src/no-mock.test.tsx"],
      isolatedFiles: [
        {
          file: "packages/client/src/uses-mock.test.ts",
          mode: "isolated",
          reasons: [
            {
              kind: "module-registry-mutation",
              line: 1,
              method: "mock",
              expression: 'vi.mock("@/lib/trpc.js")',
              moduleName: "@/lib/trpc.js",
            },
          ],
        },
      ],
      totals: { testFiles: 2, noIsolate: 1, isolated: 1 },
    });
  });
});
