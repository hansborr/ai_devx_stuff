import { existsSync } from "node:fs";
import { join } from "node:path";

import { format } from "prettier";

import { compareByCodepoint } from "../../lib/codepoint-compare.js";

interface RelationGraph {
  dataScalarModels: string[];
  gatedModels: string[];
  gatedOperations: string[];
  payloadEnvelopeKeys: string[];
  repairSuggestions: Record<string, string>;
  models: Record<string, Record<string, string>>;
}

interface ParsedRelation {
  field: string;
  isList: boolean;
  source: string;
  target: string;
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareByCodepoint);
}

function modelNameForDelegate(delegate: string): string {
  return delegate.charAt(0).toUpperCase() + delegate.slice(1);
}

function markdownHeadingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/gu, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/gu, "-");
}

function markdownHeadingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^#{1,6} (.*)$/u)?.[1]?.trimEnd();
    if (heading !== undefined && heading !== "") anchors.add(markdownHeadingSlug(heading));
  }
  return anchors;
}

export function assertRepairSuggestionReferences(
  concurrencyGuide: string,
  repairSuggestions: ReadonlyMap<string, string>,
  repoRoot: string,
): void {
  const headingAnchors = markdownHeadingAnchors(concurrencyGuide);
  for (const [delegate, suggestion] of repairSuggestions) {
    const anchorMatches = [...suggestion.matchAll(/docs\/CONCURRENCY\.md#([\w-]+)/gu)];
    if (anchorMatches.length === 0) {
      throw new Error(
        `repair suggestion anchor for ${delegate} does not resolve to a ` +
          "docs/CONCURRENCY.md heading: (missing)",
      );
    }
    for (const anchorMatch of anchorMatches) {
      const fragment = anchorMatch[1];
      if (fragment === undefined || !headingAnchors.has(fragment)) {
        throw new Error(
          `repair suggestion anchor for ${delegate} does not resolve to a ` +
            `docs/CONCURRENCY.md heading: ${anchorMatch[0]}`,
        );
      }
    }

    for (const pathMatch of suggestion.matchAll(/\b(?:[\w.-]+\/)+[\w.-]+\.[\w-]+\b/gu)) {
      const repoPath = pathMatch[0];
      if (!existsSync(join(repoRoot, repoPath))) {
        throw new Error(`repair suggestion path for ${delegate} does not exist: ${repoPath}`);
      }
    }
  }
}

function schemaModelBodies(schema: string): Map<string, string> {
  const models = new Map<string, string>();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gmu)) {
    const name = match[1];
    const body = match[2];
    if (name !== undefined && body !== undefined) models.set(name, body);
  }
  return models;
}

function parseRelationField(
  source: string,
  rawLine: string,
  modelNames: ReadonlySet<string>,
): ParsedRelation | undefined {
  const line = rawLine.replace(/\/\/.*$/u, "").trim();
  if (line === "" || line.startsWith("@@")) return undefined;
  const [field, rawTarget] = line.split(/\s+/u);
  if (field === undefined || rawTarget === undefined) return undefined;
  const target = rawTarget.replace(/(?:\[\]|\?)$/u, "");
  if (!modelNames.has(target)) return undefined;
  return { field, isList: rawTarget.endsWith("[]"), source, target };
}

function parseRelations(models: ReadonlyMap<string, string>): ParsedRelation[] {
  const modelNames = new Set(models.keys());
  const relations: ParsedRelation[] = [];

  for (const [source, body] of models) {
    for (const rawLine of body.split("\n")) {
      const relation = parseRelationField(source, rawLine, modelNames);
      if (relation !== undefined) relations.push(relation);
    }
  }

  return relations;
}

function hasScalarField(body: string, fieldName: string, modelNames: ReadonlySet<string>): boolean {
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/u, "").trim();
    if (line === "" || line.startsWith("@@")) continue;
    const [field, rawTarget] = line.split(/\s+/u);
    if (field !== fieldName || rawTarget === undefined) continue;
    const target = rawTarget.replace(/(?:\[\]|\?)$/u, "");
    return !modelNames.has(target);
  }
  return false;
}

function assertNoAmbiguousScalarFields(
  modelBodies: ReadonlyMap<string, string>,
  dataScalarModels: readonly string[],
  modelNames: ReadonlySet<string>,
): void {
  const model = dataScalarModels.find((candidate) =>
    hasScalarField(modelBodies.get(candidate) ?? "", "where", modelNames),
  );
  if (model !== undefined) {
    throw new Error(
      `model ${model} has scalar fields data and where, which makes nested write payloads ambiguous`,
    );
  }
}

function assertNoToOneDataScalarTargets(
  relations: readonly ParsedRelation[],
  dataScalarModels: readonly string[],
  gatedModels: ReadonlySet<string>,
): void {
  const dataScalarSet = new Set(dataScalarModels);
  const relation = relations.find(
    (candidate) =>
      !candidate.isList &&
      dataScalarSet.has(candidate.target) &&
      !gatedModels.has(candidate.target),
  );
  if (relation !== undefined) {
    throw new Error(
      `to-one relation ${relation.source}.${relation.field} targets data-scalar model ${relation.target}, making nested update data ambiguous`,
    );
  }
}

function canReachGatedModel(
  start: string,
  relationsByModel: Readonly<Record<string, Readonly<Record<string, string>>>>,
  gatedModels: ReadonlySet<string>,
): boolean {
  const pending = [start];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const model = pending.pop();
    if (model === undefined || seen.has(model)) continue;
    if (gatedModels.has(model)) return true;
    seen.add(model);
    for (const target of Object.values(relationsByModel[model] ?? {})) pending.push(target);
  }
  return false;
}

function assertRepairSuggestionKeys(
  gatedDelegates: ReadonlySet<string>,
  repairSuggestions: ReadonlyMap<string, string>,
): void {
  const missing = sorted(gatedDelegates).filter((delegate) => !repairSuggestions.has(delegate));
  const unexpected = sorted(repairSuggestions.keys()).filter(
    (delegate) => !gatedDelegates.has(delegate),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      "repair suggestions must exactly match gated delegates " +
        `(missing: ${missing.join(", ") || "none"}; ` +
        `unexpected: ${unexpected.join(", ") || "none"})`,
    );
  }
}

export function buildRelationGraph(
  schema: string,
  gatedDelegates: readonly string[],
  gatedOperations: readonly string[],
  canonicalRepairSuggestions: ReadonlyMap<string, string>,
): RelationGraph {
  const gatedDelegateSet = new Set(gatedDelegates);
  assertRepairSuggestionKeys(gatedDelegateSet, canonicalRepairSuggestions);
  const repairSuggestions = Object.fromEntries(
    [...canonicalRepairSuggestions].sort(([left], [right]) => compareByCodepoint(left, right)),
  );

  const modelBodies = schemaModelBodies(schema);
  if (modelBodies.size === 0) throw new Error("schema contains no Prisma models");

  const gatedModels = sorted(gatedDelegates.map(modelNameForDelegate));
  const normalizedOperations = sorted(new Set(gatedOperations));
  const payloadEnvelopeKeys = sorted(new Set(["create", "data", ...normalizedOperations]));
  for (const model of gatedModels) {
    if (!modelBodies.has(model)) throw new Error(`gated model ${model} is absent from schema`);
  }

  const relations = parseRelations(modelBodies);
  const modelNames = new Set(modelBodies.keys());
  const allRelations: Record<string, Record<string, string>> = {};
  for (const model of sorted(modelBodies.keys())) {
    const modelRelations: Record<string, string> = {};
    const outgoing = relations
      .filter((relation) => relation.source === model)
      .sort((left, right) => compareByCodepoint(left.field, right.field));
    for (const relation of outgoing) modelRelations[relation.field] = relation.target;
    allRelations[model] = modelRelations;
  }

  const gatedSet = new Set(gatedModels);
  const reachableModels = new Set(
    sorted(modelBodies.keys()).filter((model) => canReachGatedModel(model, allRelations, gatedSet)),
  );
  const dataScalarModels = sorted(reachableModels).filter((model) =>
    hasScalarField(modelBodies.get(model) ?? "", "data", modelNames),
  );
  assertNoAmbiguousScalarFields(modelBodies, dataScalarModels, modelNames);
  assertNoToOneDataScalarTargets(relations, dataScalarModels, gatedSet);

  const reservedRelationFields = new Set(["data", "where"]);
  const graphModels: Record<string, Record<string, string>> = {};
  for (const model of sorted(reachableModels)) {
    const reachableRelations = Object.entries(allRelations[model] ?? {}).filter(([, target]) =>
      reachableModels.has(target),
    );
    for (const [field] of reachableRelations) {
      if (reservedRelationFields.has(field)) {
        throw new Error(
          `relation field ${model}.${field} collides with Prisma payload envelope syntax`,
        );
      }
    }
    graphModels[model] = Object.fromEntries(reachableRelations);
  }

  return {
    dataScalarModels,
    gatedModels,
    gatedOperations: normalizedOperations,
    payloadEnvelopeKeys,
    repairSuggestions,
    models: graphModels,
  };
}

export async function renderRelationGraph(graph: RelationGraph): Promise<string> {
  return format(
    JSON.stringify(
      {
        generatedBy: "scripts/codemods/concurrency-guard/generate-relation-graph.ts",
        ...graph,
      },
      undefined,
      2,
    ),
    { parser: "json" },
  );
}

export async function renderRelationGraphModule(graph: RelationGraph): Promise<string> {
  return format(
    `// Generated by scripts/codemods/concurrency-guard/generate-relation-graph.ts. Do not edit by hand.\n` +
      `const relationGraph = ${JSON.stringify(graph, undefined, 2)} as const;\n\n` +
      `export default relationGraph;\n`,
    { parser: "typescript", printWidth: 100 },
  );
}
