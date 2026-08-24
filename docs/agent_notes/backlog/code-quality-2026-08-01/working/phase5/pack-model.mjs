/**
 * Shared read-only model of the pack: leaf headers, generated catalog rows, and
 * the reviewed edge graph.
 *
 * Both pack tools read the same three sources — `query-edge-graph.mjs` renders
 * scheduling gates from them and `../../drain.mjs` renders the drain surface —
 * so the parsing lives here once. This module never writes pack state.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const phase5Root = dirname(fileURLToPath(import.meta.url));
export const packRoot = dirname(dirname(phase5Root));

/**
 * Leaves retired by S3 merges into surviving leaves 198 and 142. The numbering
 * holes are deliberate and must never be renumbered or recreated.
 */
export const RETIRED_NUMBERS = new Set(["096", "161"]);

export const MINIMUM_CONSTRAINT_NOTICE =
  "This graph is a minimum known constraint set, not proof of independence; still check ordinary collisions against in-flight work and the separate 2026-07-25 pack.";
export const NO_GATE_NOTICE = `No known graph gate. ${MINIMUM_CONSTRAINT_NOTICE}`;

export const fail = (message) => {
  throw new Error(message);
};

const graphPath = join(phase5Root, "edge-graph.json");
export const graph = JSON.parse(readFileSync(graphPath, "utf8"));

const leafFiles = readdirSync(packRoot)
  .filter((file) => /^\d{3}-(?!PLAN).*\.md$/u.test(file))
  .sort();

const parseLeaf = (file) => {
  const source = readFileSync(join(packRoot, file), "utf8");
  const titleMatch = /^#\s+(\d+)\.\s+(.+)$/mu.exec(source);
  const statusMatch = /^Status:\s+(.+)$/mu.exec(source);
  const metadataMatch =
    /^Theme:\s+(.+?)\s+·\s+Area:\s+(.+?)\s+·\s+Severity:\s+(.+?)\s+·\s+Size:\s+(.+)$/mu.exec(
      source,
    );
  if (!titleMatch || !statusMatch || !metadataMatch) fail(`${file}: incomplete leaf header`);
  const number = String(Number(titleMatch[1])).padStart(3, "0");
  if (!file.startsWith(`${number}-`)) fail(`${file}: title number does not match filename`);
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

export const leaves = leafFiles.map(parseLeaf);
export const leafByFile = new Map(leaves.map((leaf) => [leaf.file, leaf]));
export const leafByNumber = new Map(leaves.map((leaf) => [leaf.number, leaf]));

export const catalogFiles = readdirSync(packRoot)
  .filter((file) => /^LEAVES-.*\.md$/u.test(file))
  .sort();

export const catalogRows = [];
for (const catalogFile of catalogFiles) {
  const source = readFileSync(join(packRoot, catalogFile), "utf8");
  for (const line of source.split(/\r?\n/u)) {
    const match =
      /^\|(\d{3})\|\[(.*)\]\(\.\/(\d{3}-(?!PLAN)[^)]+\.md)\)\|([^|]*)\|([^|]*)\|(.*)\|$/u.exec(
        line,
      );
    if (!match) continue;
    catalogRows.push({
      number: match[1],
      file: match[3],
      severity: match[4],
      size: match[5],
      relationCell: match[6],
      catalogFile,
    });
  }
}

export const catalogRowsByLeafFile = new Map();
for (const row of catalogRows) {
  const rows = catalogRowsByLeafFile.get(row.file) ?? [];
  rows.push(row);
  catalogRowsByLeafFile.set(row.file, rows);
}

const edgeEndpoints = (edge) => edge.endpoints ?? [edge.from, edge.to];
const edgeSequencing = (edge) =>
  edge.sequencing ?? [
    {
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      confidence: edge.confidence,
      warrant: edge.warrant,
    },
  ];

export const normalizedEdges = graph.edges.map((edge) => ({
  edge,
  endpoints: edgeEndpoints(edge),
  sequencing: edgeSequencing(edge),
}));

export const relationsForLeaf = (leafFile) => {
  const relations = [];
  for (const normalized of normalizedEdges) {
    if (!normalized.endpoints.includes(leafFile)) continue;
    const other = normalized.endpoints.find((endpoint) => endpoint !== leafFile);
    const applicable = normalized.sequencing.filter(
      (sequence) => sequence.from === leafFile || sequence.to === leafFile,
    );
    relations.push({
      edgeId: normalized.edge.id,
      edge: normalized.edge,
      other,
      provenance: normalized.edge.provenance,
      relation: normalized.edge.kind,
      sequencing: applicable.length
        ? applicable
        : [
            {
              from: normalized.endpoints[0],
              to: normalized.endpoints[1],
              kind: normalized.edge.kind,
              confidence: normalized.edge.confidence,
              warrant: normalized.edge.warrant,
            },
          ],
    });
  }
  return relations;
};

export const catalogForLeaf = (leaf) => {
  const rows = catalogRowsByLeafFile.get(leaf.file) ?? [];
  return rows.length === 1 ? rows[0].catalogFile : null;
};

export const normalizeNumber = (raw) => {
  if (!/^\d{1,3}$/u.test(raw)) fail(`invalid leaf number: ${raw}`);
  return raw.padStart(3, "0");
};

export const resolveLeaf = (raw) => {
  const number = normalizeNumber(raw);
  if (RETIRED_NUMBERS.has(number)) fail(`leaf ${number} is retired and has no scheduling unit`);
  const leaf = leafByNumber.get(number);
  if (!leaf) fail(`unknown leaf number: ${number}`);
  return leaf;
};

export const uniqueLeaves = (rawNumbers, label) => {
  if (!rawNumbers.length) fail(`${label} requires at least one leaf number`);
  const result = [];
  const seen = new Set();
  for (const raw of rawNumbers) {
    const leaf = resolveLeaf(raw);
    if (seen.has(leaf.number)) fail(`duplicate ${label} leaf: ${leaf.number}`);
    seen.add(leaf.number);
    result.push(leaf);
  }
  return result;
};

export const incidentEdgesForSet = (proposedFiles) =>
  normalizedEdges.filter((normalized) =>
    normalized.endpoints.some((endpoint) => proposedFiles.has(endpoint)),
  );

/** Every reviewed or declared edge whose endpoints all fall inside this pair. */
export const edgesBetween = (leftFile, rightFile) => {
  const pair = new Set([leftFile, rightFile]);
  return normalizedEdges.filter((normalized) =>
    normalized.endpoints.every((endpoint) => pair.has(endpoint)),
  );
};

export const provenanceLabel = (edge) => {
  if (edge.provenance !== "s3") return `declared ${edge.id}`;
  const details = [
    `S3 ${edge.kind}`,
    edge.adjudication?.assignment,
    edge.adjudication?.remedy,
  ].filter(Boolean);
  return details.join(" · ");
};

/** Slice ids declared by a plan's `## Slices` table, in table order. */
export const planSliceIds = (number) => {
  const planPath = join(packRoot, `${number}-PLAN.md`);
  if (!existsSync(planPath)) return [];
  const source = readFileSync(planPath, "utf8");
  const ids = [];
  let inSlices = false;
  for (const line of source.split(/\r?\n/u)) {
    if (/^##\s/u.test(line)) {
      inSlices = /^##\s+Slices\b/u.test(line);
      continue;
    }
    if (!inSlices || !line.startsWith("|")) continue;
    const first = line.slice(1, line.indexOf("|", 1)).trim();
    const match = /^(S\d+|\d+\.\d+)\b/u.exec(first.replaceAll("*", ""));
    if (match) ids.push(match[1]);
  }
  return ids;
};
