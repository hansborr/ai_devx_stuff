#!/usr/bin/env node
/**
 * Read-only queries over the reviewed Phase 5 edge graph.
 *
 * This script reads edge-graph.json, live leaf headers, and generated catalogs.
 * It never writes pack state. Run `node <path>/query-edge-graph.mjs --check`
 * after changing this tool or the catalog renderer.
 */
import {
  CATEGORY_ORDER,
  categoryForKind,
  relationCell,
  relationToken,
  relationTokens,
} from "./edge-graph-relations.mjs";
import {
  MINIMUM_CONSTRAINT_NOTICE,
  NO_GATE_NOTICE,
  RETIRED_NUMBERS,
  catalogFiles,
  catalogForLeaf,
  catalogRows,
  catalogRowsByLeafFile,
  edgesBetween,
  fail,
  incidentEdgesForSet,
  leafByFile,
  leafByNumber,
  leaves,
  normalizedEdges,
  provenanceLabel,
  relationsForLeaf,
  resolveLeaf,
  uniqueLeaves,
} from "./pack-model.mjs";

const prefixedTokens = (relation, leaf, peer) => {
  const prefix = relation.provenance === "s3" ? `S3-${relation.relation}!` : "";
  return relationTokens(relation, leaf.file, peer.number).map((token) => `${prefix}${token}`);
};

const printMinimumConstraintNotice = () => console.log(`\n> ${MINIMUM_CONSTRAINT_NOTICE}`);

const describeSetConstraint =(normalized, sequences, proposedFiles, inFlightFiles) => {
  const orderedEndpoints = [...normalized.endpoints].sort((left, right) =>
    leafByFile.get(left).number.localeCompare(leafByFile.get(right).number),
  );
  const endpointLabels = orderedEndpoints.map((file) => {
    const leaf = leafByFile.get(file);
    const tokens = sequences.map((sequence) => {
      const otherFile = orderedEndpoints.find((endpoint) => endpoint !== file);
      const other = leafByFile.get(otherFile);
      const prefix = normalized.edge.provenance === "s3" ? `S3-${normalized.edge.kind}!` : "";
      return `${prefix}${relationToken(sequence, file, other.number)}`;
    });
    return `\`${leaf.number} ${[...new Set(tokens)].join(" ")}\``;
  });
  const externalFiles = orderedEndpoints.filter((file) => !proposedFiles.has(file));
  let scope;
  if (!externalFiles.length) {
    scope = "proposed ↔ proposed";
  } else {
    const external = leafByFile.get(externalFiles[0]);
    if (inFlightFiles.has(external.file)) {
      scope = `in-flight ${external.number} ${external.title}`;
    } else {
      const plan = external.planFile ? `; plan ${external.planFile}` : "; no plan";
      scope = `external ${external.number} ${external.title} (\`${external.area}\`; \`${catalogForLeaf(external)}\`${plan})`;
    }
  }
  return {
    key: endpointLabels.join(" ↔ "),
    body: `${endpointLabels.join(" ↔ ")} — ${scope}`,
  };
};

const provenanceLabels = (edges) => {
  if (edges.every((edge) => edge.provenance === "declared")) {
    return `declared ${edges.map((edge) => edge.id).join(", ")}`;
  }
  return [...new Set(edges.map(provenanceLabel))].join(" + ");
};

const renderSet = (proposed, inFlight) => {
  const proposedFiles = new Set(proposed.map((leaf) => leaf.file));
  const inFlightFiles = new Set(inFlight.map((leaf) => leaf.file));
  for (const file of proposedFiles) {
    if (inFlightFiles.has(file))
      fail(`leaf ${leafByFile.get(file).number} cannot be both proposed and in-flight`);
  }
  console.log("## Proposed lane gate");
  console.log(
    `\nProposed: ${proposed.map((leaf) => leaf.number).join(", ")} · In flight: ${inFlight.length ? inFlight.map((leaf) => leaf.number).join(", ") : "none"}`,
  );
  console.log(
    "\nProposed/in-flight entries are immediate lane gates. External entries are incident known constraints; confirm the peer's current state before opening lanes.",
  );
  const incident = incidentEdgesForSet(proposedFiles);
  if (!incident.length) {
    console.log(`\n**${NO_GATE_NOTICE}**`);
    return;
  }
  const byCategory = new Map(CATEGORY_ORDER.map(([key]) => [key, new Map()]));
  for (const normalized of incident) {
    const groupedSequences = new Map();
    for (const sequence of normalized.sequencing) {
      const category = categoryForKind(sequence.kind);
      const sequences = groupedSequences.get(category) ?? [];
      sequences.push(sequence);
      groupedSequences.set(category, sequences);
    }
    for (const [category, sequences] of groupedSequences) {
      const constraint = describeSetConstraint(
        normalized,
        sequences,
        proposedFiles,
        inFlightFiles,
      );
      const constraints = byCategory.get(category);
      const existing = constraints.get(constraint.key);
      if (existing) existing.edges.push(normalized.edge);
      else constraints.set(constraint.key, { ...constraint, edges: [normalized.edge] });
    }
  }
  for (const [key, title] of CATEGORY_ORDER) {
    console.log(`\n### ${title}`);
    if (key === "hard") {
      console.log(
        "\nTreat a listed order as a violation if the lane plan does not enforce its rendered `before`/`after` sequence.",
      );
    }
    const constraints = [...byCategory.get(key).values()];
    if (!constraints.length) console.log("\n_None._");
    else {
      const lines = constraints.map(
        (constraint) => `- ${constraint.body} · ${provenanceLabels(constraint.edges)}`,
      );
      console.log(`\n${lines.join("\n")}`);
    }
  }
  printMinimumConstraintNotice();
};

const renderExplain = (left, right) => {
  if (left.file === right.file) fail("explain requires two distinct leaf numbers");
  const matches = edgesBetween(left.file, right.file);
  console.log(`## ${left.number} ↔ ${right.number}`);
  console.log(`\n${left.title} ↔ ${right.title}`);
  if (!matches.length) {
    console.log(`\n**${NO_GATE_NOTICE}**`);
    return;
  }
  for (const normalized of matches) {
    const edge = normalized.edge;
    console.log(`\n### ${edge.id} — ${edge.kind}`);
    console.log(`\nProvenance: ${provenanceLabel(edge)} · Confidence: ${edge.confidence}`);
    console.log(`\nWarrant: ${edge.warrant}`);
    if (edge.adjudication?.subsumer) {
      console.log(
        `\nS3 subsumer: ${leafByFile.get(edge.adjudication.subsumer)?.number ?? edge.adjudication.subsumer}`,
      );
    }
    for (const sequence of normalized.sequencing) {
      const from = leafByFile.get(sequence.from);
      const to = leafByFile.get(sequence.to);
      console.log(
        `\n- Remedy \`${sequence.kind}\`: ${from.number} → ${to.number}. ${sequence.warrant}`,
      );
    }
    for (const superseded of edge.supersededDeclared ?? []) {
      console.log(
        `\n- Superseded declaration \`${superseded.inputId}\` (\`${superseded.kind}\`, ${superseded.confidence}): ${superseded.warrant}`,
      );
    }
    if (edge.directionOverride) {
      console.log(`\n- Direction override: \`${edge.directionOverride.id}\``);
      for (const authority of edge.directionOverride.authorities) {
        console.log(`  - ${authority.location}: ${authority.text}`);
      }
    }
  }
};

const runCheck = () => {
  const errors = [];
  const seenEdgeIds = new Set();
  for (const { edge } of normalizedEdges) {
    if (seenEdgeIds.has(edge.id)) errors.push(`${edge.id}: duplicate edge id`);
    seenEdgeIds.add(edge.id);
  }
  const singleLeafSetCountByEdge = new Map(normalizedEdges.map(({ edge }) => [edge.id, 0]));
  for (const leaf of leaves) {
    for (const { edge } of incidentEdgesForSet(new Set([leaf.file]))) {
      singleLeafSetCountByEdge.set(edge.id, singleLeafSetCountByEdge.get(edge.id) + 1);
    }
    const relations = relationsForLeaf(leaf.file);
    const rows = catalogRowsByLeafFile.get(leaf.file) ?? [];
    if (rows.length !== 1) {
      errors.push(`${leaf.file}: resolves to ${rows.length} catalogs, expected exactly one`);
      continue;
    }
    const row = rows[0];
    if (row.number !== leaf.number || row.severity !== leaf.severity || row.size !== leaf.size) {
      errors.push(`${leaf.file}: catalog inventory fields do not match the leaf header`);
    }
    for (const relation of relations) {
      const peer = leafByFile.get(relation.other);
      if (!peer) {
        errors.push(`${relation.edgeId}: ${leaf.file} has absent peer ${relation.other}`);
        continue;
      }
      const catalogTokens = new Set(row.relationCell.split(/\s+/u));
      for (const token of prefixedTokens(relation, leaf, peer)) {
        if (!catalogTokens.has(token)) {
          errors.push(
            `${relation.edgeId}: ${leaf.number} token ${token} is absent from its catalog row`,
          );
        }
      }
    }
    const derivedCell = relationCell(leaf, relations, leafByFile);
    if (derivedCell !== row.relationCell) {
      errors.push(`${leaf.file}: derived relation cell differs from ${row.catalogFile}`);
    }
  }
  for (const normalized of normalizedEdges) {
    if (normalized.endpoints.length !== 2 || normalized.endpoints[0] === normalized.endpoints[1]) {
      errors.push(`${normalized.edge.id}: expected two distinct endpoints`);
    }
    for (const endpoint of normalized.endpoints) {
      if (!leafByFile.has(endpoint))
        errors.push(`${normalized.edge.id}: absent endpoint ${endpoint}`);
    }
    if (singleLeafSetCountByEdge.get(normalized.edge.id) !== 2) {
      errors.push(
        `${normalized.edge.id}: surfaces in ${singleLeafSetCountByEdge.get(normalized.edge.id)} single-leaf set queries, expected 2`,
      );
    }
  }
  for (const row of catalogRows) {
    if (!leafByFile.has(row.file))
      errors.push(`${row.catalogFile}: row points to absent leaf ${row.file}`);
  }
  for (const number of RETIRED_NUMBERS) {
    if (leafByNumber.has(number)) errors.push(`${number}: retired number resolves as a live leaf`);
    if (catalogRows.some((row) => row.number === number)) {
      errors.push(`${number}: retired number resolves in a catalog`);
    }
  }
  console.log(
    `query edge graph: ${normalizedEdges.length} edges, ${leaves.length} live leaves, ${catalogFiles.length} catalogs; ${errors.length} error(s)`,
  );
  for (const error of errors) console.error(`  ERROR: ${error}`);
  process.exitCode = errors.length ? 1 : 0;
};

const usage = () => {
  console.log(`Usage:
  query-edge-graph.mjs set <NNN>... [--in-flight <NNN>...]
  query-edge-graph.mjs explain <NNN> <NNN>
  query-edge-graph.mjs --check`);
};

try {
  const args = process.argv.slice(2);
  const command = args.shift();
  switch (command) {
    case "set": {
      const marker = args.indexOf("--in-flight");
      if (args.filter((argument) => argument === "--in-flight").length > 1) {
        fail("set accepts --in-flight at most once");
      }
      const proposedArgs = marker === -1 ? args : args.slice(0, marker);
      const inFlightArgs = marker === -1 ? [] : args.slice(marker + 1);
      if (marker !== -1 && !inFlightArgs.length)
        fail("--in-flight requires at least one leaf number");
      renderSet(
        uniqueLeaves(proposedArgs, "set"),
        inFlightArgs.length ? uniqueLeaves(inFlightArgs, "in-flight") : [],
      );
      break;
    }
    case "explain":
      if (args.length !== 2) fail("explain requires exactly two leaf numbers");
      renderExplain(resolveLeaf(args[0]), resolveLeaf(args[1]));
      break;
    case "--check":
      if (args.length) fail("--check accepts no other arguments");
      runCheck();
      break;
    case undefined:
    case "--help":
    case "-h":
      usage();
      if (command === undefined) process.exitCode = 1;
      break;
    default:
      fail(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
