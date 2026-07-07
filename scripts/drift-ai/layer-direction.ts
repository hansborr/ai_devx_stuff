import type { ModuleEdge, ModuleGraph, ModuleGraphRunner } from "./import-cycles-graph.js";
import { changedFilesFromScope, toPosix } from "./path-util.js";
import type { DetectorScope } from "./scope.js";
import type { DriftFinding, FindingProvenance } from "./types.js";

export type ServerLayer = "utils" | "services" | "routers";

type LayerDirectionRule = {
  readonly id: string;
  readonly sourceLayer: ServerLayer;
  readonly sourcePrefix: string;
  readonly targetLayer: ServerLayer;
  readonly targetPrefix: string;
  readonly hint: string;
};

export type LayerDirectionViolation = DriftFinding & {
  readonly check: "layer-direction";
};

export type LayerDirectionServices = {
  readonly moduleGraph: ModuleGraphRunner;
  readonly pathExists: (relativePath: string) => boolean;
  readonly tsconfigOverride: string | null;
};

export const LAYER_DIRECTION_PROVENANCE: FindingProvenance = {
  configSource: "drift-baseline",
  tool: "ts-morph",
  configPath: "server layer-direction rules",
};

const SERVER_SRC_PREFIX = "packages/server/src/";

const LAYER_DIRECTION_RULES: readonly LayerDirectionRule[] = [
  {
    id: "utils-must-not-import-services",
    sourceLayer: "utils",
    sourcePrefix: `${SERVER_SRC_PREFIX}utils/`,
    targetLayer: "services",
    targetPrefix: `${SERVER_SRC_PREFIX}services/`,
    hint: "move the dependency down: keep utils independent of services; extract shared primitives into packages/server/src/utils, or move the caller into packages/server/src/services.",
  },
  {
    id: "services-must-not-import-routers",
    sourceLayer: "services",
    sourcePrefix: `${SERVER_SRC_PREFIX}services/`,
    targetLayer: "routers",
    targetPrefix: `${SERVER_SRC_PREFIX}routers/`,
    hint: "move the dependency down: services should expose operations that routers call; move router-only wiring out of the service dependency path, or extract shared types to a lower layer.",
  },
] as const;

const ALLOWED_LAYER_DIRECTION_EDGES: ReadonlySet<string> = new Set([
  edgeKey(
    "packages/server/src/utils/character-mapping.test.ts",
    "packages/server/src/services/character-create.ts",
  ),
  edgeKey(
    "packages/server/src/utils/__type-tests__/assert-turn-opts-dedup.ts",
    "packages/server/src/services/combat-actions/types.ts",
  ),
]);

export function buildLayerDirectionFindings(
  graph: ModuleGraph,
  detectorScope: DetectorScope,
): LayerDirectionViolation[] {
  const inScope = scopeFilter(detectorScope);
  const findings: LayerDirectionViolation[] = [];
  for (const [rawFrom, edges] of graph.edges) {
    const from = toPosix(rawFrom);
    for (const edge of edges) {
      const finding = findingForEdge(from, edge);
      if (finding !== null && inScope(finding)) findings.push(finding);
    }
  }
  return sortLayerDirectionFindings(findings);
}

function findingForEdge(from: string, edge: ModuleEdge): LayerDirectionViolation | null {
  const to = toPosix(edge.to);
  if (ALLOWED_LAYER_DIRECTION_EDGES.has(edgeKey(from, to))) return null;
  const rule = LAYER_DIRECTION_RULES.find(
    (candidate) => from.startsWith(candidate.sourcePrefix) && to.startsWith(candidate.targetPrefix),
  );
  if (rule === undefined) return null;
  const typeOnly = edge.typeOnly ? "type-only " : "";
  return {
    check: "layer-direction",
    file: from,
    message: `server ${rule.sourceLayer} ${typeOnly}imports disallowed ${rule.targetLayer} layer file ${to}`,
    hint: rule.hint,
    relatedFiles: [to],
    details: {
      rule: rule.id,
      sourceLayer: rule.sourceLayer,
      targetLayer: rule.targetLayer,
      targetFile: to,
      typeOnly: edge.typeOnly,
    },
    provenance: LAYER_DIRECTION_PROVENANCE,
  };
}

function edgeKey(from: string, to: string): string {
  return `${toPosix(from)} -> ${toPosix(to)}`;
}

function scopeFilter(detectorScope: DetectorScope): (finding: LayerDirectionViolation) => boolean {
  if (detectorScope.scopeMode === "current") return () => true;
  const changed = new Set(changedFilesFromScope(detectorScope).map((file) => toPosix(file.path)));
  return (finding) =>
    changed.has(finding.file) || (finding.relatedFiles ?? []).some((file) => changed.has(file));
}

function sortLayerDirectionFindings(
  findings: readonly LayerDirectionViolation[],
): LayerDirectionViolation[] {
  return [...findings].sort(
    (left, right) =>
      left.file.localeCompare(right.file, "en") || left.message.localeCompare(right.message, "en"),
  );
}

export function buildLayerDirectionGraphErrorFinding(error: string): LayerDirectionViolation {
  return {
    check: "layer-direction",
    file: ".",
    message: `layer-direction could not build the module graph (${error})`,
    hint: "report-only: re-run locally to inspect the failure; layer-direction is otherwise not reported for this run.",
  };
}
