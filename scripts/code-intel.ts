#!/usr/bin/env bun

import { runCodeIntelCli } from "./code-intel/cli-main.js";
import type * as DefinitionQueryModule from "./code-intel/definition-query.js";
import type * as ExportQueryModule from "./code-intel/export-query.js";
import type * as FormatModule from "./code-intel/format.js";
import type * as GraphQueriesModule from "./code-intel/graph-queries.js";
import type * as ImportGraphModule from "./code-intel/import-graph.js";
import type * as OverviewQueryModule from "./code-intel/overview-query.js";
import type * as QueryExecutorModule from "./code-intel/query-executor.js";
import type * as RunnerModule from "./code-intel/runner.js";
import type * as WorkspaceResolverModule from "./code-intel/workspace-resolver.js";

export { runCodeIntelCli } from "./code-intel/cli-main.js";
export type {
  CodeIntelDaemonError,
  CodeIntelDaemonRequest,
  CodeIntelDaemonResponse,
} from "./code-intel/daemon-protocol.js";
export { CODE_INTEL_DAEMON_PROTOCOL_VERSION } from "./code-intel/daemon-protocol.js";
export { CodeIntelError } from "./code-intel/errors.js";
export type {
  CodeIntelQueryResult,
  ExecutableCliCommand,
  IntelResult,
  OverviewResult,
} from "./code-intel/types.js";
import { isCliEntrypoint } from "./lib/process-argv.js";

export type WorkspaceResolver = InstanceType<typeof WorkspaceResolverModule.WorkspaceResolver>;

type CodeIntelApiModules = {
  definitionQuery: typeof DefinitionQueryModule;
  exportQuery: typeof ExportQueryModule;
  format: typeof FormatModule;
  graphQueries: typeof GraphQueriesModule;
  importGraph: typeof ImportGraphModule;
  overviewQuery: typeof OverviewQueryModule;
  queryExecutor: typeof QueryExecutorModule;
  runner: typeof RunnerModule;
  workspaceResolver: typeof WorkspaceResolverModule;
};

const isCli = isCliEntrypoint(import.meta.url);
const apiModules = isCli ? undefined : await loadCodeIntelApiModules();

export let WorkspaceResolver: typeof WorkspaceResolverModule.WorkspaceResolver;
if (apiModules) {
  WorkspaceResolver = apiModules.workspaceResolver.WorkspaceResolver;
}

export const queryDefinition: typeof DefinitionQueryModule.queryDefinition = (...args) =>
  requireCodeIntelApiModules().definitionQuery.queryDefinition(...args);

export const queryDefinitionsByName: typeof DefinitionQueryModule.queryDefinitionsByName = (
  ...args
) => requireCodeIntelApiModules().definitionQuery.queryDefinitionsByName(...args);

export const queryExports: typeof ExportQueryModule.queryExports = (...args) =>
  requireCodeIntelApiModules().exportQuery.queryExports(...args);

export const queryOverview: typeof OverviewQueryModule.queryOverview = (...args) =>
  requireCodeIntelApiModules().overviewQuery.queryOverview(...args);

export const queryDependents: typeof GraphQueriesModule.queryDependents = (...args) =>
  requireCodeIntelApiModules().graphQueries.queryDependents(...args);

export const queryTests: typeof GraphQueriesModule.queryTests = (...args) =>
  requireCodeIntelApiModules().graphQueries.queryTests(...args);

export const formatCodeIntelQueryResult: typeof FormatModule.formatCodeIntelQueryResult = (
  ...args
) => requireCodeIntelApiModules().format.formatCodeIntelQueryResult(...args);

export const buildImportGraph: typeof ImportGraphModule.buildImportGraph = (...args) =>
  requireCodeIntelApiModules().importGraph.buildImportGraph(...args);

export const executeCodeIntelQuery: typeof QueryExecutorModule.executeCodeIntelQuery = (...args) =>
  requireCodeIntelApiModules().queryExecutor.executeCodeIntelQuery(...args);

export const runCodeIntel: typeof RunnerModule.runCodeIntel = (...args) =>
  requireCodeIntelApiModules().runner.runCodeIntel(...args);

export const createWorkspaceResolver: typeof WorkspaceResolverModule.createWorkspaceResolver = (
  ...args
) => requireCodeIntelApiModules().workspaceResolver.createWorkspaceResolver(...args);

if (isCli) {
  await runCodeIntelCli();
}

async function loadCodeIntelApiModules(): Promise<CodeIntelApiModules> {
  const [
    definitionQuery,
    exportQuery,
    format,
    graphQueries,
    importGraph,
    overviewQuery,
    queryExecutor,
    runner,
    workspaceResolver,
  ] = await Promise.all([
    import("./code-intel/definition-query.js"),
    import("./code-intel/export-query.js"),
    import("./code-intel/format.js"),
    import("./code-intel/graph-queries.js"),
    import("./code-intel/import-graph.js"),
    import("./code-intel/overview-query.js"),
    import("./code-intel/query-executor.js"),
    import("./code-intel/runner.js"),
    import("./code-intel/workspace-resolver.js"),
  ]);
  return {
    definitionQuery,
    exportQuery,
    format,
    graphQueries,
    importGraph,
    overviewQuery,
    queryExecutor,
    runner,
    workspaceResolver,
  };
}

function requireCodeIntelApiModules(): CodeIntelApiModules {
  if (!apiModules) {
    throw new Error("code:intel API exports are not available while running the CLI entrypoint.");
  }
  return apiModules;
}
