#!/usr/bin/env node
/**
 * Phase 5 step 8 edge-graph and index-table builder (dependency-free ESM; run with `bun <path>` or `node <path>`).
 *
 * Reads `working/phase5/s1-records.json`, `s3-adjudication.json`, and the live
 * leaf headers, then writes `working/phase5/edge-graph.json`. It also refreshes
 * the catalog-routing region in `00-index.md` and the generated `LEAVES-*.md`
 * catalog pages without changing the hand-written scheduling prose.
 *
 * `--check` re-derives the graph and every generated Markdown output, validates
 * input accounting, retirement rewrites, live endpoints, per-leaf sequencing,
 * catalog assignment, and output freshness, and exits non-zero on any
 * structural failure.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { relationCell } from "./edge-graph-relations.mjs";

const EXPECTED_LIVE_LEAF_COUNT = 269;
const EXPECTED_S1_LEAF_COUNT = 271;
const CATALOG_REGION_BEGIN = "<!-- BEGIN GENERATED LEAF CATALOG ROUTING -->";
const CATALOG_REGION_END = "<!-- END GENERATED LEAF CATALOG ROUTING -->";
const CATALOG_PAGES = [
  {
    file: "LEAVES-SHARED.md",
    area: "shared",
    expectedCount: 22,
    ranges: [
      [21, 38],
      [221, 222],
      [240, 240],
      [250, 250],
    ],
  },
  {
    file: "LEAVES-SERVER.md",
    area: "server",
    expectedCount: 28,
    ranges: [
      [1, 20],
      [205, 205],
      [210, 212],
      [233, 234],
      [256, 257],
    ],
  },
  {
    file: "LEAVES-CLIENT-039-062.md",
    area: "client",
    expectedCount: 24,
    ranges: [[39, 62]],
  },
  {
    file: "LEAVES-CLIENT-213-270.md",
    area: "client",
    expectedCount: 24,
    ranges: [
      [213, 216],
      [226, 227],
      [235, 239],
      [241, 241],
      [247, 249],
      [252, 252],
      [258, 263],
      [269, 270],
    ],
  },
  {
    file: "LEAVES-TESTS.md",
    area: "tests",
    expectedCount: 16,
    ranges: [
      [63, 76],
      [242, 242],
      [264, 264],
    ],
  },
  {
    file: "LEAVES-E2E.md",
    area: "e2e",
    expectedCount: 3,
    ranges: [[77, 79]],
  },
  {
    file: "LEAVES-HARNESS-107-136.md",
    area: "harness",
    expectedCount: 30,
    ranges: [[107, 136]],
  },
  {
    file: "LEAVES-HARNESS-137-167.md",
    area: "harness",
    expectedCount: 30,
    ranges: [
      [137, 160],
      [162, 167],
    ],
  },
  {
    file: "LEAVES-HARNESS-168-271.md",
    area: "harness",
    expectedCount: 29,
    ranges: [
      [168, 177],
      [204, 204],
      [206, 209],
      [220, 220],
      [224, 225],
      [230, 232],
      [243, 243],
      [245, 246],
      [253, 255],
      [267, 267],
      [271, 271],
    ],
  },
  {
    file: "LEAVES-DOCS-080-097.md",
    area: "docs",
    expectedCount: 17,
    ranges: [
      [80, 95],
      [97, 97],
    ],
  },
  {
    file: "LEAVES-DOCS-098-266.md",
    area: "docs",
    expectedCount: 16,
    ranges: [
      [98, 106],
      [217, 218],
      [223, 223],
      [228, 228],
      [251, 251],
      [265, 266],
    ],
  },
  {
    file: "LEAVES-CROSS-CUTTING.md",
    area: "cross-cutting",
    expectedCount: 30,
    ranges: [
      [178, 203],
      [219, 219],
      [229, 229],
      [244, 244],
      [268, 268],
    ],
  },
];
const RETIREMENTS = new Map([
  ["096-per-worktree-guide-omits-mandatory.md", "198-worktree-provisioning-hard-wired.md"],
  ["161-drift-ai-executable-exposes-incoherent-23.md", "142-code-intelts-maintains-unused-pseudo-library.md"],
]);
const DIRECTION_OVERRIDES = [
  {
    id: "direction-171-182",
    kind: "prefersBefore",
    outputInputId: "d-182-02",
    corrected: {
      from: "182-logging-producers-their-auditor-separately.md",
      to: "171-logs-audit-business-event-taxonomy.md",
    },
    rawInputs: [
      {
        inputId: "d-171-01",
        from: "171-logs-audit-business-event-taxonomy.md",
        to: "182-logging-producers-their-auditor-separately.md",
        warrant:
          "Prefer landing leaf 182 first so this table imports the shared authz, mutation, and broadcast outcome tuples from `@musi/shared/logging-policy`.",
      },
      {
        inputId: "d-182-02",
        from: "182-logging-producers-their-auditor-separately.md",
        to: "171-logs-audit-business-event-taxonomy.md",
        warrant:
          "Preferred order is this leaf first, followed by leaf 171 importing the shared outcome tuples into its script-local family-policy table.",
      },
    ],
    authorities: [
      {
        location: "171-logs-audit-business-event-taxonomy.md:63-64",
        file: "171-logs-audit-business-event-taxonomy.md",
        startLine: 63,
        endLine: 64,
        text:
          "Prefer landing leaf 182 first so this table imports the shared authz, mutation, and broadcast outcome tuples from `@musi/shared/logging-policy`.",
      },
      {
        location: "182-logging-producers-their-auditor-separately.md:144-149",
        file: "182-logging-producers-their-auditor-separately.md",
        startLine: 144,
        endLine: 149,
        text:
          "Plan and land this work jointly with [171-logs-audit-business-event-taxonomy.md](./171-logs-audit-business-event-taxonomy.md). Preferred order is this leaf first, followed by leaf 171 importing the shared outcome tuples into its script-local family-policy table. If leaf 171 lands first, this leaf should replace its local outcome literals without moving its classification logic.",
      },
    ],
  },
  {
    id: "direction-061-189",
    kind: "prefersBefore",
    outputInputId: "d-189-01",
    corrected: {
      from: "061-rollmodetoggle-complete-production-orphan.md",
      to: "189-downstream-packages-keep-semantic-copies.md",
    },
    rawInputs: [
      {
        inputId: "d-189-01",
        from: "189-downstream-packages-keep-semantic-copies.md",
        to: "061-rollmodetoggle-complete-production-orphan.md",
        warrant:
          "Prefer landing 061-rollmodetoggle-complete-production-orphan.md first because it deletes the only production client component importing shared `RollMode`; otherwise skip that soon-to-be-deleted file during the move.",
      },
    ],
    authorities: [
      {
        location: "189-downstream-packages-keep-semantic-copies.md:142",
        file: "189-downstream-packages-keep-semantic-copies.md",
        startLine: 142,
        endLine: 142,
        text:
          "- Prefer landing [061-rollmodetoggle-complete-production-orphan.md](./061-rollmodetoggle-complete-production-orphan.md) first because it deletes the only production client component importing shared `RollMode`; otherwise skip that soon-to-be-deleted file during the move.",
      },
    ],
  },
  {
    id: "direction-094-220",
    kind: "prefersBefore",
    outputInputId: "d-220-02",
    corrected: {
      from: "094-two-documents-both-claim-be-authoritative.md",
      to: "220-add-a-joined-explain-view-for-harness-control.md",
    },
    rawInputs: [
      {
        inputId: "d-220-02",
        from: "220-add-a-joined-explain-view-for-harness-control.md",
        to: "094-two-documents-both-claim-be-authoritative.md",
        warrant:
          "094-two-documents-both-claim-be-authoritative.md settles which inventory is authoritative but does not provide a joined query.",
      },
    ],
    authorities: [
      {
        location: "220-add-a-joined-explain-view-for-harness-control.md:88-90",
        file: "220-add-a-joined-explain-view-for-harness-control.md",
        startLine: 88,
        endLine: 90,
        text:
          "- [094-two-documents-both-claim-be-authoritative.md](./094-two-documents-both-claim-be-authoritative.md) settles which inventory is authoritative but does not provide a joined query. Preserve that authority model.",
      },
    ],
  },
];

const phase5Root = dirname(fileURLToPath(import.meta.url));
const packRoot = join(phase5Root, "..", "..");
const s1Path = join(phase5Root, "s1-records.json");
const s3Path = join(phase5Root, "s3-adjudication.json");
const outputPath = join(phase5Root, "edge-graph.json");
const indexPath = join(packRoot, "00-index.md");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const s1 = readJson(s1Path);
const s3 = readJson(s3Path);
const indexSource = readFileSync(indexPath, "utf8");

const leafFiles = readdirSync(packRoot)
  .filter((file) => /^\d{3}-(?!PLAN).*\.md$/.test(file))
  .sort();
const leafFileSet = new Set(leafFiles);

const parseLeaf = (file) => {
  const source = readFileSync(join(packRoot, file), "utf8");
  const titleMatch = /^#\s+(\d+)\.\s+(.+)$/m.exec(source);
  const statusMatch = /^Status:\s+(.+)$/m.exec(source);
  const metadataMatch =
    /^Theme:\s+(.+?)\s+·\s+Area:\s+(.+?)\s+·\s+Severity:\s+(.+?)\s+·\s+Size:\s+(.+)$/m.exec(
      source,
    );
  if (!titleMatch || !statusMatch || !metadataMatch) {
    throw new Error(`${file}: incomplete leaf header`);
  }
  const number = String(Number(titleMatch[1])).padStart(3, "0");
  if (!file.startsWith(`${number}-`)) {
    throw new Error(`${file}: title number ${titleMatch[1]} does not match filename`);
  }
  return {
    file,
    number,
    title: titleMatch[2].trim(),
    status: statusMatch[1].trim(),
    theme: metadataMatch[1].trim(),
    area: metadataMatch[2].trim(),
    severity: metadataMatch[3].trim(),
    size: metadataMatch[4].trim(),
    planFile: existsSync(join(packRoot, `${number}-PLAN.md`)) ? `${number}-PLAN.md` : null,
  };
};

const liveLeaves = leafFiles.map(parseLeaf);
const liveLeafByFile = new Map(liveLeaves.map((leaf) => [leaf.file, leaf]));
const s1FileSet = new Set(s1.records.map((record) => record.file));
const normalizeEndpoint = (file) => RETIREMENTS.get(file) ?? file;
const hasRetiredEndpoint = (left, right) => RETIREMENTS.has(left) || RETIREMENTS.has(right);
const pairKey = (left, right) => [left, right].sort().join("|");
const numberOf = (file) => Number(/^([0-9]{3})-/.exec(file)?.[1] ?? Number.MAX_SAFE_INTEGER);
const orderedPair = (left, right) =>
  [left, right].sort((a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b));
const compactNumber = (file) => String(numberOf(file)).padStart(3, "0");

const inputDeclared = [];
for (const record of s1.records) {
  for (let index = 0; index < record.relations.length; index += 1) {
    const relation = record.relations[index];
    inputDeclared.push({
      inputId: `d-${record.file.slice(0, 3)}-${String(index + 1).padStart(2, "0")}`,
      from: record.file,
      to: relation.target,
      kind: relation.kind,
      confidence: relation.confidence,
      warrant: relation.sourceSentence,
    });
  }
}

const declaredInputById = new Map(inputDeclared.map((relation) => [relation.inputId, relation]));
const directionOverrideByInputId = new Map();
for (const override of DIRECTION_OVERRIDES) {
  for (const rawInput of override.rawInputs) {
    directionOverrideByInputId.set(rawInput.inputId, override);
  }
}

const inputS3 = [];
for (const component of s3.components) {
  for (const ruling of component.matrix) {
    if (ruling.relation === "distinct") continue;
    const remedyEdges = (component.remedy.edges ?? []).filter(
      (edge) => pairKey(edge.from, edge.to) === pairKey(...ruling.pair),
    );
    inputS3.push({
      inputId: `${component.assignment}-${ruling.pair.map(compactNumber).join("-")}`,
      assignment: component.assignment,
      pair: ruling.pair,
      kind: ruling.relation,
      subsumer: ruling.subsumer,
      s2Hypothesis: ruling.s2Hypothesis,
      agreesWithS2: ruling.agreesWithS2,
      warrant: ruling.reason,
      remedy: {
        kind: component.remedy.kind,
        detail: component.remedy.detail,
        edges: remedyEdges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          kind: edge.kind,
          warrant: edge.text,
          recordIn: edge.recordIn,
        })),
      },
    });
  }
}

const declaredByOriginalPair = new Map();
for (const relation of inputDeclared) {
  const key = pairKey(relation.from, relation.to);
  const relations = declaredByOriginalPair.get(key) ?? [];
  relations.push(relation);
  declaredByOriginalPair.set(key, relations);
}

const retirementActions = [];
const recordRetirement = (input, normalizedFrom, normalizedTo, disposition, extra = {}) => {
  if (input.from === normalizedFrom && input.to === normalizedTo) return;
  retirementActions.push({
    inputId: input.inputId,
    provenance: input.provenance,
    originalEndpoints: [input.from, input.to],
    normalizedEndpoints: [normalizedFrom, normalizedTo],
    relation: {
      kind: input.kind,
      confidence: input.confidence ?? "adjudicated",
      warrant: input.warrant,
    },
    disposition,
    ...extra,
  });
};

const edges = [];
const s3EdgeByOriginalPair = new Map();
const s3InputByOriginalPair = new Map(inputS3.map((ruling) => [pairKey(...ruling.pair), ruling]));
const s3InputDisposition = new Map();
for (const ruling of inputS3) {
  const [originalLeft, originalRight] = ruling.pair;
  const left = normalizeEndpoint(originalLeft);
  const right = normalizeEndpoint(originalRight);
  const originalKey = pairKey(originalLeft, originalRight);
  if (left === right) {
    s3InputDisposition.set(ruling.inputId, "dropped-internal");
    if (hasRetiredEndpoint(originalLeft, originalRight)) {
      recordRetirement(
        { ...ruling, from: originalLeft, to: originalRight, provenance: "s3" },
        left,
        right,
        "dropped-internal",
        { reason: "the S3 merge made this relation internal to the surviving leaf" },
      );
    }
    continue;
  }

  const endpoints = orderedPair(left, right);
  const sequencing = ruling.remedy.edges
    .map((edge) => ({
      from: normalizeEndpoint(edge.from),
      to: normalizeEndpoint(edge.to),
      kind: edge.kind,
      confidence: "adjudicated",
      warrant: edge.warrant,
      recordIn: edge.recordIn,
    }))
    .filter((edge) => edge.from !== edge.to);
  const edge = {
    id: `s3-${endpoints.map(compactNumber).join("-")}`,
    endpoints,
    directed: false,
    kind: ruling.kind,
    provenance: "s3",
    confidence: "adjudicated",
    warrant: ruling.warrant,
    adjudication: {
      assignment: ruling.assignment,
      s2Hypothesis: ruling.s2Hypothesis,
      agreesWithS2: ruling.agreesWithS2,
      subsumer: ruling.subsumer === null ? null : normalizeEndpoint(ruling.subsumer),
      remedy: ruling.remedy.kind,
      remedyDetail: ruling.remedy.detail,
    },
    sequencing,
    supersededDeclared: [],
  };
  edges.push(edge);
  s3EdgeByOriginalPair.set(originalKey, edge);
  s3InputDisposition.set(ruling.inputId, "emitted");
}

const declaredInputDisposition = new Map();
for (const relation of inputDeclared) {
  const normalizedRawFrom = normalizeEndpoint(relation.from);
  const normalizedRawTo = normalizeEndpoint(relation.to);
  const rawEndpointRetired = hasRetiredEndpoint(relation.from, relation.to);
  const directionOverride = directionOverrideByInputId.get(relation.inputId);
  const from = directionOverride
    ? normalizeEndpoint(directionOverride.corrected.from)
    : normalizedRawFrom;
  const to = directionOverride ? normalizeEndpoint(directionOverride.corrected.to) : normalizedRawTo;
  const ruling = s3EdgeByOriginalPair.get(pairKey(relation.from, relation.to));
  const coveringS3Input = s3InputByOriginalPair.get(pairKey(relation.from, relation.to));

  if (from === to) {
    declaredInputDisposition.set(relation.inputId, "dropped-internal");
    if (rawEndpointRetired) {
      recordRetirement(
        { ...relation, provenance: "declared" },
        normalizedRawFrom,
        normalizedRawTo,
        "dropped-internal",
        {
          reason: "the S3 merge made this declaration internal to the surviving leaf",
          ...(coveringS3Input ? { supersededByS3Input: coveringS3Input.inputId } : {}),
        },
      );
    }
    continue;
  }

  if (ruling) {
    ruling.supersededDeclared.push({
      inputId: relation.inputId,
      from,
      to,
      kind: relation.kind,
      confidence: relation.confidence,
      warrant: relation.warrant,
    });
    declaredInputDisposition.set(relation.inputId, "superseded");
    continue;
  }

  if (directionOverride && relation.inputId !== directionOverride.outputInputId) {
    declaredInputDisposition.set(relation.inputId, "overridden-collapsed");
    continue;
  }

  const endpoints = orderedPair(from, to);
  edges.push({
    id: relation.inputId,
    endpoints,
    from,
    to,
    directed: true,
    kind: relation.kind,
    provenance: "declared",
    confidence: relation.confidence,
    warrant: relation.warrant,
    ...(directionOverride
      ? {
          directionOverride: {
            id: directionOverride.id,
            rawInputIds: directionOverride.rawInputs.map((input) => input.inputId),
            authorities: directionOverride.authorities.map(({ location, text }) => ({
              location,
              text,
            })),
          },
        }
      : {}),
    sequencing: [
      {
        from,
        to,
        kind: relation.kind,
        confidence: relation.confidence,
        warrant: relation.warrant,
      },
    ],
    supersededDeclared: [],
  });
  declaredInputDisposition.set(relation.inputId, "emitted");
  if (rawEndpointRetired) {
    recordRetirement(
      { ...relation, provenance: "declared" },
      normalizedRawFrom,
      normalizedRawTo,
      "repointed",
      { reason: "the declared relation now targets the surviving merged host" },
    );
  }
}

edges.sort((left, right) => {
  const pairOrder =
    numberOf(left.endpoints[0]) - numberOf(right.endpoints[0]) ||
    numberOf(left.endpoints[1]) - numberOf(right.endpoints[1]);
  return pairOrder || left.provenance.localeCompare(right.provenance) || left.id.localeCompare(right.id);
});

const consequenceFor = (sequence, leafFile) => {
  const isFrom = sequence.from === leafFile;
  switch (sequence.kind) {
    case "requires":
      return isFrom ? "land after" : "land before";
    case "prefersBefore":
      return isFrom ? "prefer before" : "prefer after";
    case "prefersAfter":
      return isFrom ? "prefer after" : "prefer before";
    case "serialize":
    case "coLand":
    case "soft-sequencing":
      return "coordinate / do not run concurrently";
    case "rebaseOn":
      return isFrom ? "coordinate; rebase on outcome" : "coordinate; may require rebase";
    case "moots":
    case "moots-slice":
      return isFrom ? "resolve outcome first; may moot work" : "resolve outcome first; may be mooted";
    case "alternativeTo":
      return "choose one direction before scheduling";
    default:
      return "reconcile before scheduling";
  }
};

const sequencingByLeaf = new Map(liveLeaves.map((leaf) => [leaf.file, []]));
for (const edge of edges) {
  for (const leafFile of edge.endpoints) {
    const other = edge.endpoints.find((endpoint) => endpoint !== leafFile);
    const applicable = edge.sequencing.filter(
      (sequence) => sequence.from === leafFile || sequence.to === leafFile,
    );
    const sequencing = applicable.length
      ? applicable.map((sequence) => ({
          from: sequence.from,
          to: sequence.to,
          kind: sequence.kind,
          consequence: consequenceFor(sequence, leafFile),
          warrant: sequence.warrant,
        }))
      : [
          {
            from: edge.endpoints[0],
            to: edge.endpoints[1],
            kind: edge.kind,
            consequence: "reconcile before scheduling",
            warrant: edge.warrant,
          },
        ];
    sequencingByLeaf.get(leafFile).push({
      edgeId: edge.id,
      other,
      provenance: edge.provenance,
      relation: edge.kind,
      sequencing,
    });
  }
}

const byProvenance = Object.fromEntries(
  ["s3", "declared"].map((provenance) => [
    provenance,
    edges.filter((edge) => edge.provenance === provenance).length,
  ]),
);
const byKind = Object.fromEntries(
  [...new Set(edges.map((edge) => edge.kind))]
    .sort()
    .map((kind) => [kind, edges.filter((edge) => edge.kind === kind).length]),
);

const directionalArcs = [];
for (const edge of edges) {
  for (const sequence of edge.sequencing) {
    if (sequence.kind === "requires") {
      directionalArcs.push({ from: sequence.to, to: sequence.from, edgeId: edge.id });
    } else if (sequence.kind === "prefersBefore") {
      directionalArcs.push({ from: sequence.from, to: sequence.to, edgeId: edge.id });
    } else if (sequence.kind === "prefersAfter") {
      directionalArcs.push({ from: sequence.to, to: sequence.from, edgeId: edge.id });
    }
  }
}
const findDirectionalCycles = () => {
  const arcsByFrom = new Map();
  for (const arc of directionalArcs) {
    const outgoing = arcsByFrom.get(arc.from) ?? [];
    outgoing.push(arc);
    arcsByFrom.set(arc.from, outgoing);
  }
  const cycles = [];
  const visited = new Set();
  const active = new Map();
  const path = [];
  const visit = (leafFile) => {
    visited.add(leafFile);
    active.set(leafFile, path.length);
    for (const arc of arcsByFrom.get(leafFile) ?? []) {
      path.push(arc);
      if (!visited.has(arc.to)) visit(arc.to);
      else if (active.has(arc.to)) {
        const start = active.get(arc.to);
        cycles.push(path.slice(start).map(({ from, to, edgeId }) => ({ from, to, edgeId })));
      }
      path.pop();
    }
    active.delete(leafFile);
  };
  for (const leaf of liveLeaves) {
    if (!visited.has(leaf.file)) visit(leaf.file);
  }
  return cycles;
};
const directionalCycles = findDirectionalCycles();
const supersededDeclared = inputDeclared.filter((relation) =>
  inputS3.some((ruling) => pairKey(...ruling.pair) === pairKey(relation.from, relation.to)),
);
const supersededPairs = new Set(
  supersededDeclared.map((relation) => pairKey(relation.from, relation.to)),
);

const graphEdges = edges.map((edge) => {
  if (edge.provenance === "declared") {
    const { endpoints: _endpoints, directed: _directed, sequencing: _sequencing, ...outputEdge } =
      edge;
    return outputEdge;
  }
  const { directed: _directed, ...outputEdge } = edge;
  return {
    ...outputEdge,
    adjudication: {
      assignment: outputEdge.adjudication.assignment,
      subsumer: outputEdge.adjudication.subsumer,
      remedy: outputEdge.adjudication.remedy,
    },
    sequencing: outputEdge.sequencing.map(({ recordIn: _recordIn, ...sequence }) => sequence),
  };
});

const perLeafScheduling = (leafFile) => {
  const result = {};
  const add = (category, peer) => {
    const peers = result[category] ?? [];
    if (!peers.includes(peer)) peers.push(peer);
    result[category] = peers;
  };
  for (const relation of sequencingByLeaf.get(leafFile)) {
    const peer = compactNumber(relation.other);
    for (const sequence of relation.sequencing) {
      if (sequence.consequence.startsWith("land after")) add("landAfter", peer);
      else if (sequence.consequence.startsWith("land before")) add("landBefore", peer);
      else if (sequence.consequence.startsWith("prefer before")) add("preferBefore", peer);
      else if (sequence.consequence.startsWith("prefer after")) add("preferAfter", peer);
      else if (sequence.consequence.startsWith("coordinate")) add("coordinateWith", peer);
      else add("decideWith", peer);
    }
  }
  return result;
};

const graph = {
  contractVersion: 1,
  step: "edge-graph",
  auditTargetSha: s3.auditTargetSha,
  generatedFrom: {
    declaredRelations: "working/phase5/s1-records.json",
    adjudicatedRelations: "working/phase5/s3-adjudication.json",
    leafHeaders: "NNN-*.md",
    directionOverrides: "working/phase5/build-edge-graph.mjs#DIRECTION_OVERRIDES",
  },
  summary: {
    liveLeaves: liveLeaves.length,
    edges: edges.length,
    byProvenance,
    byKind,
    declaredRelationsInput: inputDeclared.length,
    s3NonDistinctInput: inputS3.length,
    declaredRelationsSuperseded: supersededDeclared.length,
    declaredPairsSuperseded: supersededPairs.size,
    retiredEndpointInputs: retirementActions.length,
    retiredRelationsRepointed: retirementActions.filter(
      (action) => action.disposition === "repointed",
    ).length,
    retiredRelationsDroppedInternal: retirementActions.filter(
      (action) => action.disposition === "dropped-internal",
    ).length,
    leavesWithSequencing: [...sequencingByLeaf.values()].filter((relations) => relations.length)
      .length,
    directionOverrides: DIRECTION_OVERRIDES.length,
    directionalArcs: directionalArcs.length,
    directionalAcyclic: directionalCycles.length === 0,
  },
  directionOverrides: DIRECTION_OVERRIDES.map((override) => ({
    id: override.id,
    kind: override.kind,
    rawInputIds: override.rawInputs.map((input) => input.inputId),
    corrected: override.corrected,
    authorities: override.authorities.map(({ location, text }) => ({ location, text })),
  })),
  retirements: [...RETIREMENTS].map(([retiredFile, survivingFile]) => ({
    retiredFile,
    survivingFile,
  })),
  retirementActions,
  edges: graphEdges,
  leafSequencing: Object.fromEntries(
    liveLeaves.map((leaf) => [leaf.file, perLeafScheduling(leaf.file)]),
  ),
};
const graphText = `${JSON.stringify(graph, null, 1)}\n`;

const escapeCell = (value) => String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const displayArea = (area) => (area === "e2e" ? "E2E" : area[0].toUpperCase() + area.slice(1));
const formatNumber = (number) => String(number).padStart(3, "0");
const numberInRanges = (number, ranges) =>
  ranges.some(([first, last]) => number >= first && number <= last);
const rangeLabel = (ranges) =>
  ranges
    .map(([first, last]) =>
      first === last ? formatNumber(first) : `${formatNumber(first)}–${formatNumber(last)}`,
    )
    .join(", ");
const leafMatchesCatalog = (leaf, catalog) =>
  leaf.area === catalog.area && numberInRanges(Number(leaf.number), catalog.ranges);
const leavesForCatalog = (catalog) => liveLeaves.filter((leaf) => leafMatchesCatalog(leaf, catalog));
const catalogAssignments = CATALOG_PAGES.map((catalog) => ({
  catalog,
  leaves: leavesForCatalog(catalog),
}));

const renderLeafTable = (leaves) => {
  const lines = [
    "|#|Leaf|Sev|Size|Relations / sequencing|",
    "|---|---|---|---|---|",
  ];
  for (const leaf of leaves) {
    lines.push(
      `|${leaf.number}|[${escapeCell(leaf.title)}](./${leaf.file})|${escapeCell(leaf.severity)}|${escapeCell(leaf.size)}|${escapeCell(relationCell(leaf, sequencingByLeaf.get(leaf.file), liveLeafByFile))}|`,
    );
  }
  return lines.join("\n");
};

const indexUpdated = /\bUpdated:\s*(\d{4}-\d{2}-\d{2})\b/u.exec(indexSource)?.[1];
const renderCatalogPage = (catalog, leaves) =>
  [
    `# ${displayArea(catalog.area)} leaf catalog — ${rangeLabel(catalog.ranges)}`,
    "",
    "Status: Done — generated reference catalog; canonical leaf status lives in 00-index.md",
    `Updated: ${indexUpdated ?? ""}`,
    "",
    "[Return to the canonical index and scheduling contract.](./00-index.md)",
    "",
    "This entire page is generated by `working/phase5/build-edge-graph.mjs`; do not edit it by hand.",
    "",
    "This catalog is a storage shard, not a scheduling boundary. Each row contains the complete known inbound and outbound relation tokens for that leaf, but a peer may live in any Area or catalog. Resolve every peer number across the full declared catalog set and read both leaves before delegation. Catalog membership and a blank relation cell do not prove safe parallelism.",
    "",
    renderLeafTable(leaves),
    "",
  ].join("\n");

const renderRootCatalogRegion = () => {
  const lines = catalogAssignments.map(({ catalog }) =>
    `<!-- backlog-lint-catalog: ${catalog.file} -->`,
  );
  lines.push(
    "",
    `**${liveLeaves.length} live leaves across ${catalogAssignments.length} generated catalogs.**`,
    "",
    "|Catalog|Area|Leaf count|Number range(s)|",
    "|---|---|---:|---|",
  );
  for (const { catalog, leaves } of catalogAssignments) {
    lines.push(
      `|[${catalog.file}](./${catalog.file})|${displayArea(catalog.area)}|${leaves.length}|${rangeLabel(catalog.ranges)}|`,
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
};

const generatedRegionState = (source, beginMarker, endMarker) => {
  const begin = source.indexOf(beginMarker);
  const end = source.indexOf(endMarker);
  return { begin, end, present: begin !== -1 && end !== -1 && begin < end };
};
const markerState = generatedRegionState(indexSource, CATALOG_REGION_BEGIN, CATALOG_REGION_END);
const generatedIndexRegion = renderRootCatalogRegion();
const refreshedIndex = markerState.present
  ? `${indexSource.slice(0, markerState.begin + CATALOG_REGION_BEGIN.length)}\n${generatedIndexRegion}${indexSource.slice(markerState.end)}`
  : indexSource;
const markdownOutputs = [
  { path: indexPath, text: refreshedIndex },
  ...catalogAssignments.map(({ catalog, leaves }) => ({
    path: join(packRoot, catalog.file),
    text: renderCatalogPage(catalog, leaves),
  })),
];

const validate = () => {
  const errors = [];
  if (process.argv.some((argument, index) => index > 1 && argument !== "--check")) {
    errors.push("unsupported argument; only --check is accepted");
  }
  if (s1.records.length !== EXPECTED_S1_LEAF_COUNT)
    errors.push(`S1 has ${s1.records.length} records, expected ${EXPECTED_S1_LEAF_COUNT}`);
  if (liveLeaves.length !== EXPECTED_LIVE_LEAF_COUNT)
    errors.push(`pack has ${liveLeaves.length} live leaves, expected ${EXPECTED_LIVE_LEAF_COUNT}`);
  if (indexUpdated === undefined) errors.push("00-index.md has no parseable Updated date");
  const catalogFiles = new Set();
  for (const catalog of CATALOG_PAGES) {
    if (catalogFiles.has(catalog.file)) errors.push(`duplicate catalog file ${catalog.file}`);
    catalogFiles.add(catalog.file);
    let previousLast = 0;
    for (const [first, last] of catalog.ranges) {
      if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || first > last) {
        errors.push(`${catalog.file}: invalid number range ${String(first)}-${String(last)}`);
      }
      if (first <= previousLast) errors.push(`${catalog.file}: number ranges overlap or are unsorted`);
      previousLast = last;
    }
  }
  for (let leftIndex = 0; leftIndex < CATALOG_PAGES.length; leftIndex += 1) {
    const left = CATALOG_PAGES[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < CATALOG_PAGES.length; rightIndex += 1) {
      const right = CATALOG_PAGES[rightIndex];
      if (left.area !== right.area) continue;
      const overlaps = left.ranges.some(([leftFirst, leftLast]) =>
        right.ranges.some(
          ([rightFirst, rightLast]) => leftFirst <= rightLast && rightFirst <= leftLast,
        ),
      );
      if (overlaps) errors.push(`${left.file} and ${right.file} overlap within Area ${left.area}`);
    }
  }
  for (const { catalog, leaves } of catalogAssignments) {
    if (!leaves.length) errors.push(`${catalog.file}: catalog is empty`);
    if (leaves.length !== catalog.expectedCount) {
      errors.push(
        `${catalog.file}: catalog has ${leaves.length} leaves, expected ${catalog.expectedCount}`,
      );
    }
  }
  for (const leaf of liveLeaves) {
    const matches = CATALOG_PAGES.filter((catalog) => leafMatchesCatalog(leaf, catalog));
    if (matches.length !== 1) {
      errors.push(`${leaf.file}: matches ${matches.length} catalog pages, expected exactly one`);
    }
  }
  const existingCatalogFiles = readdirSync(packRoot).filter((file) => /^LEAVES-.*\.md$/u.test(file));
  for (const file of existingCatalogFiles) {
    if (!catalogFiles.has(file)) errors.push(`unconfigured generated catalog exists: ${file}`);
  }
  const liveNumbers = new Set(liveLeaves.map((leaf) => leaf.number));
  for (let number = 1; number <= 270; number += 1) {
    const padded = String(number).padStart(3, "0");
    const expected = !new Set(["096", "161"]).has(padded);
    if (liveNumbers.has(padded) !== expected) errors.push(`unexpected live-number state for ${padded}`);
  }
  if (s3.validation.errors.length || s3.validation.warnings.length)
    errors.push("S3 source ledger carries validation errors or warnings");
  if (inputS3.length !== s3.summary.pairsRuled - s3.summary.byRelation.distinct)
    errors.push("S3 non-distinct input count does not match its summary");
  for (const [retired, survivor] of RETIREMENTS) {
    if (leafFileSet.has(retired)) errors.push(`retired leaf still exists: ${retired}`);
    if (!leafFileSet.has(survivor)) errors.push(`retirement survivor is missing: ${survivor}`);
    if (!s1FileSet.has(retired) || !s1FileSet.has(survivor))
      errors.push(`retirement mapping is not represented in S1: ${retired} -> ${survivor}`);
  }
  for (const action of retirementActions) {
    if (!action.originalEndpoints.some((endpoint) => RETIREMENTS.has(endpoint))) {
      errors.push(
        `${action.inputId}: retirement action does not name an endpoint present in RETIREMENTS`,
      );
    }
  }
  const expectedRetirementByInputId = new Map();
  const expectRetirement = (inputId, originalFrom, originalTo) => {
    if (!hasRetiredEndpoint(originalFrom, originalTo)) return;
    const normalizedFrom = normalizeEndpoint(originalFrom);
    const normalizedTo = normalizeEndpoint(originalTo);
    expectedRetirementByInputId.set(
      inputId,
      normalizedFrom === normalizedTo ? "dropped-internal" : "repointed",
    );
  };
  for (const ruling of inputS3) {
    expectRetirement(ruling.inputId, ...ruling.pair);
  }
  for (const relation of inputDeclared) {
    expectRetirement(relation.inputId, relation.from, relation.to);
  }

  const recordedRetirementByInputId = new Map();
  for (const action of retirementActions) {
    if (recordedRetirementByInputId.has(action.inputId)) {
      errors.push(`${action.inputId}: duplicate recorded retirement action`);
    }
    recordedRetirementByInputId.set(action.inputId, action.disposition);
  }
  for (const [inputId, expectedDisposition] of expectedRetirementByInputId) {
    const recordedDisposition = recordedRetirementByInputId.get(inputId);
    if (recordedDisposition === undefined) {
      errors.push(`${inputId}: raw retired-endpoint input has no recorded retirement action`);
    } else if (recordedDisposition !== expectedDisposition) {
      errors.push(
        `${inputId}: retirement disposition is ${recordedDisposition}, expected ${expectedDisposition} from raw endpoints`,
      );
    }
  }
  for (const inputId of recordedRetirementByInputId.keys()) {
    if (!expectedRetirementByInputId.has(inputId)) {
      errors.push(`${inputId}: recorded retirement action has no raw retired-endpoint input`);
    }
  }
  const expectedRepointed = [...expectedRetirementByInputId.values()].filter(
    (disposition) => disposition === "repointed",
  ).length;
  const expectedDroppedInternal = [...expectedRetirementByInputId.values()].filter(
    (disposition) => disposition === "dropped-internal",
  ).length;
  if (graph.summary.retiredEndpointInputs !== expectedRetirementByInputId.size) {
    errors.push(
      `retired-endpoint summary count is ${graph.summary.retiredEndpointInputs}, expected ${expectedRetirementByInputId.size} from raw inputs`,
    );
  }
  if (graph.summary.retiredRelationsRepointed !== expectedRepointed) {
    errors.push(
      `repointed retirement summary count is ${graph.summary.retiredRelationsRepointed}, expected ${expectedRepointed} from raw inputs`,
    );
  }
  if (graph.summary.retiredRelationsDroppedInternal !== expectedDroppedInternal) {
    errors.push(
      `dropped-internal retirement summary count is ${graph.summary.retiredRelationsDroppedInternal}, expected ${expectedDroppedInternal} from raw inputs`,
    );
  }
  const seenOverrideInputs = new Set();
  for (const override of DIRECTION_OVERRIDES) {
    const correctedPair = pairKey(override.corrected.from, override.corrected.to);
    if (override.corrected.from === override.corrected.to)
      errors.push(`${override.id}: corrected direction must have distinct endpoints`);
    if (!override.rawInputs.some(
      (input) => input.from !== override.corrected.from || input.to !== override.corrected.to,
    )) {
      errors.push(`${override.id}: override is no longer needed; all raw inputs already agree`);
    }
    if (!override.rawInputs.some((input) => input.inputId === override.outputInputId))
      errors.push(`${override.id}: output input is not among the pinned raw inputs`);
    for (const expected of override.rawInputs) {
      if (seenOverrideInputs.has(expected.inputId))
        errors.push(`${override.id}: duplicate override input ${expected.inputId}`);
      seenOverrideInputs.add(expected.inputId);
      const actual = declaredInputById.get(expected.inputId);
      if (!actual) {
        errors.push(`${override.id}: pinned raw input is missing: ${expected.inputId}`);
        continue;
      }
      if (
        actual.from !== expected.from ||
        actual.to !== expected.to ||
        actual.kind !== override.kind ||
        actual.warrant !== expected.warrant
      ) {
        errors.push(`${override.id}: ${expected.inputId} changed; review or retire the override`);
      }
      if (pairKey(actual.from, actual.to) !== correctedPair)
        errors.push(`${override.id}: ${expected.inputId} does not describe the corrected pair`);
    }
    for (const authority of override.authorities) {
      const lines = readFileSync(join(packRoot, authority.file), "utf8").split(/\r?\n/);
      const actual = lines
        .slice(authority.startLine - 1, authority.endLine)
        .map((line) => line.trim())
        .join(" ");
      if (!actual.includes(authority.text))
        errors.push(`${override.id}: deciding sentence changed at ${authority.location}`);
    }
  }
  for (const relation of inputDeclared) {
    if (!s1FileSet.has(relation.to)) errors.push(`${relation.inputId}: target is absent from S1`);
    if (!declaredInputDisposition.has(relation.inputId))
      errors.push(`${relation.inputId}: no declared-relation disposition`);
  }
  for (const ruling of inputS3) {
    if (!s3InputDisposition.has(ruling.inputId)) errors.push(`${ruling.inputId}: no S3 disposition`);
  }
  if (declaredInputDisposition.size !== inputDeclared.length)
    errors.push("declared-relation accounting is not one disposition per input");
  if (s3InputDisposition.size !== inputS3.length)
    errors.push("S3 accounting is not one disposition per non-distinct input");
  const edgeIds = new Set();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) errors.push(`duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (edge.endpoints.length !== 2 || edge.endpoints[0] === edge.endpoints[1])
      errors.push(`${edge.id}: edge must have two distinct endpoints`);
    for (const endpoint of edge.endpoints) {
      if (!leafFileSet.has(endpoint)) errors.push(`${edge.id}: endpoint is not a live leaf: ${endpoint}`);
    }
    if (edge.provenance === "declared" && s3EdgeByOriginalPair.has(pairKey(...edge.endpoints)))
      errors.push(`${edge.id}: declared edge survived an S3 ruling for the same pair`);
    for (const sequence of edge.sequencing) {
      if (!leafFileSet.has(sequence.from) || !leafFileSet.has(sequence.to))
        errors.push(`${edge.id}: sequencing endpoint is not a live leaf`);
    }
  }
  for (const cycle of directionalCycles) {
    errors.push(
      `directional cycle: ${cycle
        .map((arc) => `${compactNumber(arc.from)} -[${arc.edgeId}]-> ${compactNumber(arc.to)}`)
        .join("; ")}`,
    );
  }
  const liveFileByNumber = new Map(liveLeaves.map((leaf) => [leaf.number, leaf.file]));
  for (const [leafFile, scheduling] of Object.entries(graph.leafSequencing)) {
    if (!leafFileSet.has(leafFile)) errors.push(`per-leaf graph contains absent file ${leafFile}`);
    for (const [category, peers] of Object.entries(scheduling)) {
      if (
        !new Set([
          "landAfter",
          "landBefore",
          "preferBefore",
          "preferAfter",
          "coordinateWith",
          "decideWith",
        ]).has(category)
      ) {
        errors.push(`${leafFile}: unknown sequencing category ${category}`);
      }
      for (const peer of peers) {
        if (!liveFileByNumber.has(peer)) errors.push(`${leafFile}: absent peer number ${peer}`);
      }
    }
  }
  for (const leafFile of leafFileSet) {
    if (!Object.hasOwn(graph.leafSequencing, leafFile)) {
      errors.push(`per-leaf sequencing does not cover live leaf ${leafFile}`);
    }
  }
  const markerCount = [
    indexSource.includes(CATALOG_REGION_BEGIN),
    indexSource.includes(CATALOG_REGION_END),
  ].filter(Boolean).length;
  if (markerCount !== 2 || !markerState.present)
    errors.push("00-index.md has missing or malformed generated catalog-routing markers");
  return errors;
};

const structuralErrors = validate();
const summarize = (errors) => {
  console.log(
    `edge graph: ${graph.summary.edges} edges across ${graph.summary.liveLeaves} live leaves; ${errors.length} structural error(s)`,
  );
  console.log(
    `provenance: s3=${byProvenance.s3}, declared=${byProvenance.declared}; superseded declared=${graph.summary.declaredRelationsSuperseded} across ${graph.summary.declaredPairsSuperseded} pairs`,
  );
  console.log(
    `kinds: ${Object.entries(byKind)
      .map(([kind, count]) => `${kind}=${count}`)
      .join(", ")}`,
  );
  console.log(
    `retirements: ${graph.summary.retiredRelationsRepointed} repointed, ${graph.summary.retiredRelationsDroppedInternal} dropped as internal`,
  );
  console.log(
    `direction overrides: ${DIRECTION_OVERRIDES.length}; directional graph: ${directionalArcs.length} arcs, ${directionalCycles.length ? `${directionalCycles.length} cycle(s)` : "acyclic"}`,
  );
  console.log(
    `leaf catalogs: ${liveLeaves.length} rows across ${catalogAssignments.length} pages; root routing ${markerState.present ? "present" : "missing"}`,
  );
  for (const error of errors) console.error(`  ERROR: ${error}`);
};

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath)) structuralErrors.unshift("edge-graph.json does not exist");
  else if (readFileSync(outputPath, "utf8") !== graphText)
    structuralErrors.unshift("edge-graph.json is stale or inconsistent with derivation");
  for (const output of markdownOutputs) {
    if (!existsSync(output.path)) {
      structuralErrors.unshift(`${relative(packRoot, output.path)} does not exist`);
    } else if (readFileSync(output.path, "utf8") !== output.text) {
      structuralErrors.unshift(`${relative(packRoot, output.path)} is stale or inconsistent`);
    }
  }
  summarize(structuralErrors);
  process.exitCode = structuralErrors.length ? 1 : 0;
} else if (structuralErrors.length) {
  summarize(structuralErrors);
  process.exitCode = 1;
} else {
  writeFileSync(outputPath, graphText);
  for (const output of markdownOutputs) writeFileSync(output.path, output.text);
  summarize([]);
  console.log(`wrote ${relative(packRoot, outputPath)}`);
  for (const output of markdownOutputs) console.log(`wrote ${basename(output.path)}`);
}
