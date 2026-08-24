import type { DriftAiLayerDirectionConfig, DriftAiLayerDirectionRule } from "./config.js";
import type { ModuleEdge, ModuleGraph, ModuleGraphRunner } from "./import-cycles-graph.js";
import { toPosix } from "./path-util.js";
import { changedFilesFromScope, type DetectorScope } from "./scope.js";
import type { DriftFinding, FindingProvenance } from "./types.js";

export type LayerDirectionViolation = DriftFinding & {
  readonly check: "layer-direction";
};

export type LayerDirectionServices = {
  readonly moduleGraph: ModuleGraphRunner;
  readonly pathExists: (relativePath: string) => boolean;
  readonly tsconfigOverride: string | null;
};

const LAYER_DIRECTION_PROVENANCE: FindingProvenance = {
  configSource: "drift-baseline",
  tool: "ts-morph",
  configPath: "server layer-direction rules",
};

export function buildLayerDirectionFindings(
  graph: ModuleGraph,
  detectorScope: DetectorScope,
  config: DriftAiLayerDirectionConfig,
): LayerDirectionViolation[] {
  const inScope = scopeFilter(detectorScope);
  const allowedEdges = new Set(config.allowedEdges.map(([from, to]) => edgeKey(from, to)));
  const findings: LayerDirectionViolation[] = [];
  for (const [rawFrom, edges] of graph.edges) {
    const from = toPosix(rawFrom);
    for (const edge of edges) {
      const finding = findingForEdge(from, edge, config.rules, allowedEdges);
      if (finding !== null && inScope(finding)) findings.push(finding);
    }
  }
  return sortLayerDirectionFindings(findings);
}

// Rule ids whose configured prefixes match zero files in the resolved module
// graph. Such a rule cannot produce a finding no matter what the repo does, so
// its silence is not evidence — the check surfaces these on stderr rather than
// letting a mistyped prefix read as a clean layering verdict.
export function findInertLayerDirectionRuleIds(
  graph: ModuleGraph,
  rules: readonly DriftAiLayerDirectionRule[],
): readonly string[] {
  const files = new Set<string>();
  for (const [rawFrom, edges] of graph.edges) {
    files.add(toPosix(rawFrom));
    for (const edge of edges) files.add(toPosix(edge.to));
  }
  const matchesAny = (prefix: string): boolean => {
    for (const file of files) {
      if (file.startsWith(prefix)) return true;
    }
    return false;
  };
  return rules
    .filter((rule) => !matchesAny(rule.sourcePrefix) || !matchesAny(rule.targetPrefix))
    .map((rule) => rule.id);
}

function findingForEdge(
  from: string,
  edge: ModuleEdge,
  rules: readonly DriftAiLayerDirectionRule[],
  allowedEdges: ReadonlySet<string>,
): LayerDirectionViolation | null {
  const to = toPosix(edge.to);
  if (allowedEdges.has(edgeKey(from, to))) return null;
  const rule = rules.find(
    (candidate) => from.startsWith(candidate.sourcePrefix) && to.startsWith(candidate.targetPrefix),
  );
  if (rule === undefined) return null;
  const typeOnly = edge.typeOnly ? "type-only " : "";
  // The surrounding message grammar (including the historical "server"
  // qualifier) is frozen so findings stay byte-stable across the config
  // extraction; the layer labels themselves are free strings from config.
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
