#!/usr/bin/env bun
import { pathToFileURL } from "node:url";

import { runCodeIntelCli } from "./code-intel/cli-main.js";

export { runCodeIntelCli } from "./code-intel/cli-main.js";
export { CODE_INTEL_DAEMON_PROTOCOL_VERSION } from "./code-intel/daemon-protocol.js";
export type {
  CodeIntelDaemonError,
  CodeIntelDaemonRequest,
  CodeIntelDaemonResponse,
} from "./code-intel/daemon-protocol.js";
export { CodeIntelError } from "./code-intel/errors.js";
export type {
  CodeIntelQueryResult,
  ExecutableCliCommand,
  IntelResult,
  OverviewResult,
} from "./code-intel/types.js";

type DefinitionQueryModule = typeof import("./code-intel/definition-query.js");
type ExportQueryModule = typeof import("./code-intel/export-query.js");
type FormatModule = typeof import("./code-intel/format.js");
type GraphQueriesModule = typeof import("./code-intel/graph-queries.js");
type ImportGraphModule = typeof import("./code-intel/import-graph.js");
type OverviewQueryModule = typeof import("./code-intel/overview-query.js");
type QueryExecutorModule = typeof import("./code-intel/query-executor.js");
type RunnerModule = typeof import("./code-intel/runner.js");
type WorkspaceResolverModule = typeof import("./code-intel/workspace-resolver.js");

export type WorkspaceResolver = InstanceType<WorkspaceResolverModule["WorkspaceResolver"]>;

type CodeIntelApiModules = {
  definitionQuery: DefinitionQueryModule;
  exportQuery: ExportQueryModule;
  format: FormatModule;
  graphQueries: GraphQueriesModule;
  importGraph: ImportGraphModule;
  overviewQuery: OverviewQueryModule;
  queryExecutor: QueryExecutorModule;
  runner: RunnerModule;
  workspaceResolver: WorkspaceResolverModule;
};

const isCli = isCliEntrypoint();
const apiModules = isCli ? undefined : await loadCodeIntelApiModules();

export let WorkspaceResolver: WorkspaceResolverModule["WorkspaceResolver"];
if (apiModules) {
  WorkspaceResolver = apiModules.workspaceResolver.WorkspaceResolver;
}

export const queryDefinition: DefinitionQueryModule["queryDefinition"] = (...args) =>
  requireCodeIntelApiModules().definitionQuery.queryDefinition(...args);

export const queryDefinitionsByName: DefinitionQueryModule["queryDefinitionsByName"] = (...args) =>
  requireCodeIntelApiModules().definitionQuery.queryDefinitionsByName(...args);

export const queryExports: ExportQueryModule["queryExports"] = (...args) =>
  requireCodeIntelApiModules().exportQuery.queryExports(...args);

export const queryOverview: OverviewQueryModule["queryOverview"] = (...args) =>
  requireCodeIntelApiModules().overviewQuery.queryOverview(...args);

export const queryDependents: GraphQueriesModule["queryDependents"] = (...args) =>
  requireCodeIntelApiModules().graphQueries.queryDependents(...args);

export const queryTests: GraphQueriesModule["queryTests"] = (...args) =>
  requireCodeIntelApiModules().graphQueries.queryTests(...args);

export const formatCodeIntelQueryResult: FormatModule["formatCodeIntelQueryResult"] = (...args) =>
  requireCodeIntelApiModules().format.formatCodeIntelQueryResult(...args);

export const buildImportGraph: ImportGraphModule["buildImportGraph"] = (...args) =>
  requireCodeIntelApiModules().importGraph.buildImportGraph(...args);

export const executeCodeIntelQuery: QueryExecutorModule["executeCodeIntelQuery"] = (...args) =>
  requireCodeIntelApiModules().queryExecutor.executeCodeIntelQuery(...args);

export const runCodeIntel: RunnerModule["runCodeIntel"] = (...args) =>
  requireCodeIntelApiModules().runner.runCodeIntel(...args);

export const createWorkspaceResolver: WorkspaceResolverModule["createWorkspaceResolver"] = (
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

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}
