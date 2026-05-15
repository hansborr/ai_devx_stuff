import path from "node:path";

import { describe, expect, it } from "bun:test";
import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from "ts-morph";

import { parseArgs } from "./cli-args.js";
import { CodeIntelError } from "./errors.js";
import { formatCodeIntelQueryResult } from "./format.js";
import { queryOverview } from "./overview-query.js";
import { runCodeIntel } from "./runner.js";
import { createWorkspaceResolver } from "./workspace-resolver.js";

const repoRoot = "/repo";
const target = "packages/server/src/routers/sample.ts";
const packageConfigs = [
  {
    name: "@musi/shared",
    packageRoot: "packages/shared",
    exports: {
      "./schemas/*.js": {
        types: "./dist/schemas/*.d.ts",
        default: "./dist/schemas/*.js",
      },
    },
  },
  {
    name: "@musi/server",
    packageRoot: "packages/server",
    exports: {},
  },
];

function createFixtureProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      module: ModuleKind.Node16,
      moduleResolution: ModuleResolutionKind.Node16,
      target: ScriptTarget.ES2024,
    },
  });
}

function sourcePath(file: string): string {
  return path.join(repoRoot, file);
}

function addSource(project: Project, file: string, text: string): void {
  project.createSourceFile(sourcePath(file), text, { overwrite: true });
}

function createFixtureResolver(project: Project): ReturnType<typeof createWorkspaceResolver> {
  return createWorkspaceResolver(repoRoot, {
    fileExists: (filePath) => project.getSourceFile(path.resolve(filePath)) !== undefined,
    fileIsFile: (filePath) => project.getSourceFile(path.resolve(filePath)) !== undefined,
    packages: packageConfigs,
  });
}

function addRouterFixture(project: Project): void {
  addSource(project, target, routerFixtureText());
  addSource(
    project,
    "packages/server/src/routers/sample.test.ts",
    'import { sampleRouter } from "./sample.js"; test("sample", () => sampleRouter);\n',
  );
}

function routerFixtureText(): string {
  return `
import { z } from "zod";
import { doNestedThing, doThing } from "../services/things.js";
import { broadcastThing } from "../socket/things.js";
import { emitAudit } from "../events/audit.js";
import { publicProcedure, protectedProcedure, router } from "../trpc/trpc.js";

const castInputSchema = z.object({ id: z.string() });
const castOutputSchema = z.object({ ok: z.boolean() });
const rateLimit = () => undefined;
async function runNestedThing(id: string): Promise<void> {
  await doNestedThing(id);
  emitAudit(id);
}
function notifyCast(id: string): void {
  broadcastThing(id);
}
const listProcedure = publicProcedure
  .output(z.object({ ok: z.boolean() }))
  .query(() => {
    io.to("room").emit("thing", {});
    return { ok: true };
  });

export const sampleRouter = router({
  cast: protectedProcedure
    .use(rateLimit)
    .input(castInputSchema)
    .output(castOutputSchema)
    .mutation(async ({ input }) => {
      await doThing(input);
      await runNestedThing(input.id);
      notifyCast(input.id);
      return { ok: true };
    }),
  list: listProcedure,
});
`;
}

describe("code:intel overview", () => {
  it("parses overview args", () => {
    expect(parseArgs(["overview", target])).toEqual({
      command: { kind: "overview", file: target },
      format: "text",
    });
    expect(parseArgs(["overview", target, "--format", "json"]).format).toBe("json");
    expect(() => parseArgs(["overview", target, "--depth", "1"])).toThrow(CodeIntelError);
  });

  it("extracts procedures, schemas, service calls, and broadcasts", () => {
    const project = createFixtureProject();
    addRouterFixture(project);
    const resolver = createFixtureResolver(project);

    expect(queryOverview(project, resolver, target, ["candidate.test.ts"])).toEqual([
      {
        procedure: "cast",
        kind: "mutation",
        authHelper: "protectedProcedure",
        inputSchema: "castInputSchema",
        outputSchema: "castOutputSchema",
        serviceCalls: ["doNestedThing", "doThing"],
        broadcasts: ["broadcastThing", "emitAudit"],
        candidateTests: ["candidate.test.ts"],
      },
      {
        procedure: "list",
        kind: "query",
        authHelper: "publicProcedure",
        inputSchema: null,
        outputSchema: "inline",
        serviceCalls: [],
        broadcasts: ["emit"],
        candidateTests: ["candidate.test.ts"],
      },
    ]);
  });

  it("throws a clean error for non-router files", () => {
    const project = createFixtureProject();
    const file = "packages/server/src/routers/not-router.ts";
    addSource(project, file, "export const value = 1;\n");
    const resolver = createFixtureResolver(project);

    expect(() => queryOverview(project, resolver, file)).toThrow(
      "overview: packages/server/src/routers/not-router.ts does not export a tRPC router via router({ ... }).",
    );
  });

  it("throws a clean error for aggregator routers", () => {
    const project = createFixtureProject();
    const file = "packages/server/src/routers/app-router.ts";
    addSource(
      project,
      file,
      `
      import { router } from "../trpc/trpc.js";
      import { sampleRouter } from "./sample.js";

      export const appRouter = router({
        sample: sampleRouter,
      });
      `,
    );
    const resolver = createFixtureResolver(project);

    expect(() => queryOverview(project, resolver, file)).toThrow(
      "overview: packages/server/src/routers/app-router.ts does not contain direct tRPC procedures in router({ ... }).",
    );
  });

  it("formats text and JSON overview output", () => {
    const project = createFixtureProject();
    addRouterFixture(project);
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, project, repoRoot, resolver };

    expect(runCodeIntel(["overview", target], context)).toBe(
      [
        "overview: packages/server/src/routers/sample.ts — 2 procedure(s)",
        "  cast  mutation  auth=protectedProcedure",
        "    input:  castInputSchema",
        "    output: castOutputSchema",
        "    services:    doNestedThing, doThing",
        "    broadcasts:  broadcastThing, emitAudit",
        "    tests:       packages/server/src/routers/sample.test.ts",
        "  list  query  auth=publicProcedure",
        "    input:  null",
        "    output: inline",
        "    broadcasts:  emit",
        "    tests:       packages/server/src/routers/sample.test.ts",
      ].join("\n"),
    );

    const jsonOutput = runCodeIntel(["overview", target, "--format", "json"], context);
    expect(() => JSON.parse(jsonOutput)).not.toThrow();
    expect(jsonOutput).toBe(
      JSON.stringify(
        [
          {
            procedure: "cast",
            kind: "mutation",
            authHelper: "protectedProcedure",
            inputSchema: "castInputSchema",
            outputSchema: "castOutputSchema",
            serviceCalls: ["doNestedThing", "doThing"],
            broadcasts: ["broadcastThing", "emitAudit"],
            candidateTests: ["packages/server/src/routers/sample.test.ts"],
          },
          {
            procedure: "list",
            kind: "query",
            authHelper: "publicProcedure",
            inputSchema: null,
            outputSchema: "inline",
            serviceCalls: [],
            broadcasts: ["emit"],
            candidateTests: ["packages/server/src/routers/sample.test.ts"],
          },
        ],
        undefined,
        2,
      ),
    );

    expect(
      formatCodeIntelQueryResult(
        {
          kind: "overview",
          file: target,
          results: queryOverview(project, resolver, target),
        },
        "text",
      ),
    ).toContain("overview: packages/server/src/routers/sample.ts");
  });
});
