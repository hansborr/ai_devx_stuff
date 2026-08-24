import path from "node:path";

import {
  queryDefinition,
  queryDefinitionNearMatches,
  queryDefinitionsByName,
} from "./definition-query.js";
import { queryExports } from "./export-query.js";
import { queryDependents, queryTests, summarizeDependentProjects } from "./graph-queries.js";
import { buildImportGraph } from "./import-graph.js";
import { queryOverview } from "./overview-query.js";
import { queryReferences } from "./references-query.js";
import type { CodeIntelContext } from "./source-project.js";
import {
  createProjectForFile,
  createReferenceProject,
  existingRelativeFile,
  sourceFilesForGraph,
} from "./source-project.js";
import type { CodeIntelQueryResult, ExecutableCliCommand, ImportGraph } from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";
import { createWorkspaceResolver } from "./workspace-resolver.js";

type QueryExecutorContext = {
  context: CodeIntelContext;
  repoRoot: string;
  resolver: WorkspaceResolver;
};

type DefinitionCommand = Extract<ExecutableCliCommand, { kind: "def" }>;
type DefinitionNameCommand = Extract<ExecutableCliCommand, { kind: "defName" }>;
type ExportsCommand = Extract<ExecutableCliCommand, { kind: "exports" }>;
type OverviewCommand = Extract<ExecutableCliCommand, { kind: "overview" }>;
type RefsCommand = Extract<ExecutableCliCommand, { kind: "refs" }>;
type DependentsCommand = Extract<ExecutableCliCommand, { kind: "dependents" }>;
type TestsCommand = Extract<ExecutableCliCommand, { kind: "tests" }>;
type GraphCommand = DependentsCommand | TestsCommand;

const OVERVIEW_CANDIDATE_TEST_LIMIT = 5;

export function executeCodeIntelQuery(
  command: ExecutableCliCommand,
  context: CodeIntelContext = {},
): CodeIntelQueryResult {
  return executeCommand(command, createQueryExecutorContext(context));
}

function createQueryExecutorContext(context: CodeIntelContext): QueryExecutorContext {
  const repoRoot = path.resolve(context.repoRoot ?? process.cwd());
  return {
    context,
    repoRoot,
    resolver: context.resolver ?? createWorkspaceResolver(repoRoot),
  };
}

function executeCommand(
  command: ExecutableCliCommand,
  runner: QueryExecutorContext,
): CodeIntelQueryResult {
  if (command.kind === "def") return executeDefinition(command, runner);
  if (command.kind === "defName") return executeDefinitionName(command, runner);
  if (command.kind === "exports") return executeExports(command, runner);
  if (command.kind === "overview") return executeOverview(command, runner);
  if (command.kind === "refs") return executeRefs(command, runner);
  return executeGraphCommand(command, runner);
}

function executeDefinition(
  command: DefinitionCommand,
  runner: QueryExecutorContext,
): CodeIntelQueryResult {
  const project =
    runner.context.project ?? createProjectForFile(runner.repoRoot, command.location.file);
  const results = queryDefinition(project, runner.resolver, command.location);
  const headerName = results[0]?.name ?? "unknown";
  return { kind: "results", header: `definition ${headerName}`, results };
}

function executeDefinitionName(
  command: DefinitionNameCommand,
  runner: QueryExecutorContext,
): CodeIntelQueryResult {
  const sourceFiles = sourceFilesForGraph(runner.repoRoot, runner.context);
  const results = queryDefinitionsByName(runner.resolver, sourceFiles, command.name);
  const header = `definition ${command.name}`;
  // The formatter derives the searched-scope statement for every defName
  // execution from commandKind (docs/guides/code-intel.md#supported-scope),
  // so hits need no scope plumbing here.
  if (results.length > 0) return { kind: "results", header, results };
  return {
    kind: "definitionNameMiss",
    header,
    hint: queryDefinitionNearMatches(runner.resolver, sourceFiles, command.name),
  };
}

function executeExports(
  command: ExportsCommand,
  runner: QueryExecutorContext,
): CodeIntelQueryResult {
  const project = runner.context.project ?? createProjectForFile(runner.repoRoot, command.file);
  return {
    kind: "results",
    header: `exports ${runner.resolver.relative(command.file)}`,
    results: queryExports(project, runner.resolver, command.file),
  };
}

function executeOverview(
  command: OverviewCommand,
  runner: QueryExecutorContext,
): CodeIntelQueryResult {
  const project = runner.context.project ?? createProjectForFile(runner.repoRoot, command.file);
  const candidateTests = overviewCandidateTests(command.file, runner);
  return {
    kind: "overview",
    file: runner.resolver.relative(command.file),
    results: queryOverview(project, runner.resolver, command.file, candidateTests),
  };
}

function overviewCandidateTests(file: string, runner: QueryExecutorContext): string[] {
  try {
    const graph = runner.context.graph ?? buildGraphFromContext(runner);
    return queryTests(runner.resolver, graph, file, { depth: 1 })
      .map((result) => result.file)
      .slice(0, OVERVIEW_CANDIDATE_TEST_LIMIT);
  } catch {
    return [];
  }
}

function executeRefs(command: RefsCommand, runner: QueryExecutorContext): CodeIntelQueryResult {
  existingRelativeFile(runner.resolver, command.location.file);
  const project =
    runner.context.referenceProject ??
    runner.context.graphProject ??
    createReferenceProject(runner.repoRoot);
  const { name, results } = queryReferences(project, runner.resolver, command.location);
  return {
    kind: "results",
    header: `references ${name}`,
    limit: command.limit,
    results,
  };
}

function executeGraphCommand(
  command: GraphCommand,
  runner: QueryExecutorContext,
): CodeIntelQueryResult {
  existingRelativeFile(runner.resolver, command.file);
  const graph = runner.context.graph ?? buildGraphFromContext(runner);
  if (command.kind === "dependents") return executeDependents(command, runner, graph);
  return executeTests(command, runner, graph);
}

function buildGraphFromContext(runner: QueryExecutorContext): ImportGraph {
  const sourceFiles = sourceFilesForGraph(runner.repoRoot, runner.context);
  return buildImportGraph(sourceFiles, runner.resolver);
}

function executeDependents(
  command: DependentsCommand,
  runner: QueryExecutorContext,
  graph: ImportGraph,
): CodeIntelQueryResult {
  const results = queryDependents(runner.resolver, graph, command.file, command.depth, {
    excludeTests: command.excludeTests,
    project: command.project,
  });
  return {
    kind: "results",
    header: `dependents ${runner.resolver.relative(command.file)}`,
    limit: command.limit,
    metadata: { depth: command.depth },
    projectSummary: {
      byProject: summarizeDependentProjects(results),
      filter: command.project,
    },
    results,
  };
}

function executeTests(
  command: TestsCommand,
  runner: QueryExecutorContext,
  graph: ImportGraph,
): CodeIntelQueryResult {
  return {
    kind: "results",
    header: `tests ${runner.resolver.relative(command.file)}`,
    limit: command.limit,
    results: queryTests(runner.resolver, graph, command.file, {
      depth: command.depth,
      project: command.project,
    }),
  };
}
