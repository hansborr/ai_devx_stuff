import { ModuleKind, ModuleResolutionKind, Project, ScriptTarget } from "ts-morph";
import { describe, expect, it } from "vitest";

import {
  collectOverviewCallContext,
  collectOverviewCallTargets,
  type OverviewCallTargets,
} from "./overview-call-targets.js";
import { DEFAULT_OVERVIEW_CONVENTIONS, type OverviewConventions } from "./overview-conventions.js";

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

function collectTargets(text: string, conventions?: OverviewConventions): OverviewCallTargets {
  const project = createFixtureProject();
  const sourceFile = project.createSourceFile("/repo/packages/server/src/routers/fixture.ts", text);
  const resolver = sourceFile.getVariableDeclarationOrThrow("handler").getInitializer();
  if (conventions === undefined) {
    return collectOverviewCallTargets(resolver, collectOverviewCallContext(sourceFile));
  }
  const context = collectOverviewCallContext(sourceFile, conventions);
  return collectOverviewCallTargets(resolver, context, conventions);
}

describe("code:intel overview conventions", () => {
  it("pins the shipped Musi conventions data", () => {
    expect(DEFAULT_OVERVIEW_CONVENTIONS).toEqual({
      serviceImportPathFragments: ["/services/"],
      broadcastImportPathFragments: ["/socket/", "/utils/character-campaign"],
      broadcastNamePrefixes: ["broadcast", "emit"],
      broadcastNameSuffixes: ["Broadcast"],
      socketEmitMethod: "emit",
      socketRoomMethod: "to",
      socketServerIdentifier: "io",
    });
  });

  it("detects Musi service, broadcast, and socket conventions by default", () => {
    const targets = collectTargets(`
      import { doThing } from "../services/things.js";
      import { broadcastThing } from "../socket/things.js";
      import { campaignPing } from "../utils/character-campaign.js";
      import { thingBroadcast } from "../helpers/naming.js";
      const handler = () => {
        doThing();
        broadcastThing();
        campaignPing();
        thingBroadcast();
        io.to("room").emit("thing", {});
      };
    `);

    expect(targets).toEqual({
      serviceCalls: ["doThing"],
      broadcasts: ["broadcastThing", "campaignPing", "emit", "thingBroadcast"],
    });
  });

  it("threads custom conventions through import classification", () => {
    const conventions: OverviewConventions = {
      serviceImportPathFragments: ["/api/"],
      broadcastImportPathFragments: ["/pubsub/"],
      broadcastNamePrefixes: ["publish"],
      broadcastNameSuffixes: ["Fanout"],
      socketEmitMethod: "emit",
      socketRoomMethod: "to",
      socketServerIdentifier: "io",
    };
    const targets = collectTargets(
      `
      import { fetchThing } from "../api/things.js";
      import { relayThing } from "../pubsub/things.js";
      import { doThing } from "../services/things.js";
      import { publishNote } from "../helpers/notes.js";
      import { thingFanout } from "../helpers/fanout.js";
      import { broadcastThing } from "../socket/things.js";
      const handler = () => {
        fetchThing();
        relayThing();
        doThing();
        publishNote();
        thingFanout();
        broadcastThing();
      };
      `,
      conventions,
    );

    expect(targets).toEqual({
      serviceCalls: ["fetchThing"],
      broadcasts: ["publishNote", "relayThing", "thingFanout"],
    });
  });

  it("honors configured spellings in the socket emit chain matcher", () => {
    const conventions: OverviewConventions = {
      serviceImportPathFragments: [],
      broadcastImportPathFragments: [],
      broadcastNamePrefixes: [],
      broadcastNameSuffixes: [],
      socketEmitMethod: "publish",
      socketRoomMethod: "room",
      socketServerIdentifier: "bus",
    };
    const targets = collectTargets(
      `
      const handler = () => {
        bus.room("table").publish("thing", {});
        bus.publish("direct", {});
        io.to("table").emit("thing", {});
      };
      `,
      conventions,
    );

    expect(targets).toEqual({ serviceCalls: [], broadcasts: ["publish"] });
  });
});
