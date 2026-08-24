import path from "node:path";

import { existingRelativeFile } from "./source-project.js";
import { isSlowTestFile, isTestFile } from "./test-files.js";
import type {
  BfsVisit,
  DependentResult,
  ImportEdge,
  ImportGraph,
  ProjectBucket,
  ProjectBucketSummary,
  ProjectFilter,
  QueryDependentsOptions,
  QueryTestsOptions,
  TestResult,
} from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

type QueryDependentsRequest = {
  depthLimit: number;
  file: string;
  graph: ImportGraph;
  options?: QueryDependentsOptions;
  resolver: WorkspaceResolver;
};

type QueryDependentsArgs = [
  resolver: WorkspaceResolver,
  graph: ImportGraph,
  file: string,
  depthLimit: number,
  options?: QueryDependentsOptions,
];

type ReverseVisitCandidate = {
  depthLimit: number;
  edge: ImportEdge;
  runtimeOnly: boolean;
  seen: Map<string, BfsVisit>;
  visit: BfsVisit;
};

const TRANSITIVE_TEST_RANK = 2;

export function queryDependents(...args: QueryDependentsArgs): DependentResult[] {
  const [resolver, graph, file, depthLimit, options = {}] = args;
  return queryDependentsByRequest({ resolver, graph, file, depthLimit, options });
}

function queryDependentsByRequest(request: QueryDependentsRequest): DependentResult[] {
  const target = existingRelativeFile(request.resolver, request.file);
  const results: DependentResult[] = [];
  for (const visit of reverseBfs(request.graph, target, request.depthLimit)) {
    results.push({
      kind: "dependent",
      file: visit.file,
      depth: visit.depth,
      via: visit.via,
    });
  }
  return filterDependents(results, request.options ?? {});
}

export function queryTests(
  resolver: WorkspaceResolver,
  graph: ImportGraph,
  file: string,
  options: QueryTestsOptions = {},
): TestResult[] {
  const target = existingRelativeFile(resolver, file);
  const depthLimit = options.depth ?? Number.POSITIVE_INFINITY;
  const results = new Map<string, TestResult>();

  for (const candidate of colocatedTestCandidates(target)) {
    if (!resolver.fileExistsRelative(candidate)) continue;
    results.set(candidate, {
      kind: "test",
      file: candidate,
      reason: "co-located",
      slow: isSlowTestFile(candidate),
    });
  }

  for (const visit of reverseBfs(graph, target, depthLimit, true)) {
    if (!isTestFile(visit.file) || results.has(visit.file)) continue;
    results.set(visit.file, {
      kind: "test",
      file: visit.file,
      reason: visit.depth === 1 ? "direct" : "transitive",
      slow: isSlowTestFile(visit.file),
      depth: visit.depth,
      via: visit.via,
    });
  }

  return filterTestsByProject([...results.values()], options.project).sort(compareTestResults);
}

function reverseBfs(
  graph: ImportGraph,
  target: string,
  depthLimit = Number.POSITIVE_INFINITY,
  runtimeOnly = false,
): BfsVisit[] {
  const start: BfsVisit = { file: target, depth: 0, via: "direct" };
  const queue: BfsVisit[] = [start];
  const seen = new Map<string, BfsVisit>([[target, start]]);
  const results: BfsVisit[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const visit = queue[index];
    if (!visit) continue;
    const incoming = graph.incoming.get(visit.file) ?? [];
    for (const edge of incoming) {
      const next = nextReverseVisit({ edge, visit, depthLimit, runtimeOnly, seen });
      if (!next) continue;
      seen.set(edge.from, next);
      results.push(next);
      queue.push(next);
    }
  }

  return results.sort(compareVisits);
}

function nextReverseVisit(candidate: ReverseVisitCandidate): BfsVisit | undefined {
  if (candidate.runtimeOnly && !candidate.edge.runtime) return undefined;
  const depth = candidate.visit.depth + 1;
  if (depth > candidate.depthLimit) return undefined;
  const previous = candidate.seen.get(candidate.edge.from);
  if (previous && previous.depth <= depth) return undefined;
  return { file: candidate.edge.from, depth, via: candidate.edge.via };
}

function colocatedTestCandidates(file: string): string[] {
  const extension = path.extname(file);
  const withoutExtension = file.slice(0, -extension.length);
  return [
    `${withoutExtension}.test.ts`,
    `${withoutExtension}.test.tsx`,
    `${withoutExtension}.slow.test.ts`,
    `${withoutExtension}.slow.test.tsx`,
  ];
}

function filterTestsByProject(
  results: TestResult[],
  project: ProjectFilter | undefined,
): TestResult[] {
  if (!project) return results;
  return results.filter((result) => fileMatchesProject(result.file, project));
}

function filterDependents(
  results: DependentResult[],
  options: QueryDependentsOptions,
): DependentResult[] {
  return results.filter((result) => {
    if (options.excludeTests && isTestFile(result.file)) return false;
    if (options.project && !fileMatchesProject(result.file, options.project)) return false;
    return true;
  });
}

export function summarizeDependentProjects(results: DependentResult[]): ProjectBucketSummary {
  const summary: ProjectBucketSummary = {};
  for (const result of results) {
    const bucket = projectBucketForFile(result.file);
    if (!bucket) continue;
    summary[bucket] = (summary[bucket] ?? 0) + 1;
  }
  return summary;
}

function projectBucketForFile(file: string): ProjectBucket | undefined {
  if (file.startsWith("packages/client/")) return "client";
  if (file.startsWith("packages/server/")) return "server";
  if (file.startsWith("packages/shared/")) return "shared";
  if (file.startsWith("scripts/")) return "scripts";
  return undefined;
}

function fileMatchesProject(file: string, project: ProjectFilter): boolean {
  if (project === "shared") return file.startsWith("packages/shared/");
  if (project === "server") return file.startsWith("packages/server/");
  return file.startsWith("packages/client/");
}

function compareTestResults(left: TestResult, right: TestResult): number {
  const leftRank = testResultRank(left);
  const rightRank = testResultRank(right);
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (leftRank === TRANSITIVE_TEST_RANK) {
    const leftDepth = left.depth ?? Number.POSITIVE_INFINITY;
    const rightDepth = right.depth ?? Number.POSITIVE_INFINITY;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
  }
  return compareFileResults(left, right);
}

function testResultRank(result: TestResult): number {
  if (result.reason === "co-located") return 0;
  if (result.reason === "direct") return 1;
  return TRANSITIVE_TEST_RANK;
}

function compareFileResults(left: TestResult, right: TestResult): number {
  return left.file.localeCompare(right.file, "en");
}

function compareVisits(left: BfsVisit, right: BfsVisit): number {
  if (left.depth !== right.depth) return left.depth - right.depth;
  return left.file.localeCompare(right.file, "en");
}
