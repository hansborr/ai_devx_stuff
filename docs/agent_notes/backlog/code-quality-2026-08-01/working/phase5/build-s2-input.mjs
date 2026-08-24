#!/usr/bin/env node
/**
 * Phase 5 step S2 input builder (dependency-free ESM; run with `bun <path>` or `node <path>`).
 *
 * Reads `working/phase5/s0-records.json` and `s1-records.json`, derives the
 * global union of candidate-pair channels, and writes:
 *   working/phase5/s2-channels.json — deduplicated pairs with channel evidence;
 *   working/phase5/s2-digest.md     — compact, complete 270-leaf projection.
 *
 * `--check` re-derives both outputs, validates their structural invariants,
 * channel counts, path scale check, lexical coverage, and digest coverage, and
 * exits non-zero when either generated artifact is stale or invalid.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_LEAF_COUNT = 270;
const ORIGINAL_LEAF_COUNT = 203;
const LEXICAL_K = 5;
const phase5Root = dirname(fileURLToPath(import.meta.url));
const packRoot = join(phase5Root, "..", "..");
const s0Path = join(phase5Root, "s0-records.json");
const s1Path = join(phase5Root, "s1-records.json");
const channelsPath = join(phase5Root, "s2-channels.json");
const digestPath = join(phase5Root, "s2-digest.md");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const s0 = readJson(s0Path);
const s1 = readJson(s1Path);

const channelDefinitions = {
  c1: {
    name: "targetOps-write-write",
    rank: "precision",
    weight: 1,
    authoritative: true,
  },
  c2: {
    name: "targetOps-write-dependency-truth-source",
    rank: "precision",
    weight: 1,
    authoritative: true,
  },
  c3: {
    name: "evidence-path-overlap",
    rank: "recall",
    weight: 0.35,
    authoritative: true,
  },
  c4: {
    name: "lexical-top-k",
    rank: "recall",
    weight: 0.55,
    authoritative: true,
  },
  c5: {
    name: "resolved-intra-pack-reference",
    rank: "explicit",
    weight: 0.9,
    authoritative: true,
  },
  c6: {
    name: "triage-provenance",
    rank: "precision-with-partial-coverage",
    weight: 0.95,
    authoritative: true,
  },
  c7: {
    name: "contradicted-independence-claim",
    rank: "precision",
    weight: 1,
    authoritative: true,
  },
  c8: {
    name: "within-chunk-near-miss",
    rank: "reader-signal",
    weight: 0.4,
    authoritative: false,
  },
};

const evidenceTupleSchemas = {
  pair: "[left leaf number, right leaf number, channels]",
  c1: "[targetIndex id, left action+role@branch?, right action+role@branch?]",
  c2: "[targetIndex id, case code, left action+role@branch?, right action+role@branch?]; cases cvd=converge-vs-delete, tvd=truth-source-vs-delete, wd=write-vs-dependency, wt=write-vs-truth-source",
  c3: "[targetIndex id, mode bitmask] where 1=evidence/evidence, 2=left evidence/right write, 4=left write/right evidence",
  c4: "[nominating leaf number, neighbor rank, cosine score, top shared terms joined by comma]",
  c5: "[referencing leaf number, PLAN filename|null, reference kind initial, source line]; pair supplies the referenced leaf",
  c6: "promotion expected relation [p,promotionId,exact hint], batch overlap [b,from candidate,to candidate,relation,note], or triage relation [t,relation]",
  c7: "[claimant leaf, contradiction type, overlap targets or inbound relation tuple]; exact claim text is in independenceClaims",
  c8: "[S1 chunk, non-authoritative reason]",
};

const stopwords = new Set(
  `a about above across after again against all also am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just may me might more most must my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves add change changes code create current edit edits file files fix implementation keep leaf leaves make module move one package packages problem proposed remove replace repository script scripts single source test tests two use used using work`.split(
    /\s+/,
  ),
);

const byFile = new Map();
const byNumber = new Map();
const s0Leaves = s0.records.filter((record) => record.kind === "leaf");
const s1ByFile = new Map(s1.records.map((record) => [record.file, record]));
for (const mechanical of s0Leaves) {
  const enriched = s1ByFile.get(mechanical.file);
  if (!enriched) throw new Error(`S1 is missing ${mechanical.file}`);
  const record = { ...mechanical, ...enriched };
  byFile.set(record.file, record);
  byNumber.set(record.number, record);
}
const leaves = [...byFile.values()].sort((a, b) => a.leafNumber - b.leafNumber);

const normalizeTarget = (target) =>
  target.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");

const opEvidence = (op) => ({
  action: op.action,
  role: op.role,
  ...(op.branch === null || op.branch === undefined ? {} : { branch: op.branch }),
});

const pairKey = (left, right) =>
  [left.number, right.number].sort((a, b) => Number(a) - Number(b)).join("-");

const candidates = new Map();
const nominate = (left, right, channel, evidence) => {
  if (!left || !right || left.file === right.file) return;
  const ordered =
    left.leafNumber < right.leafNumber ? [left, right] : [right, left];
  const key = pairKey(...ordered);
  const candidate = candidates.get(key) ?? {
    pair: ordered.map((record) => record.number),
    channels: {},
  };
  const existing = candidate.channels[channel] ?? [];
  const serialized = JSON.stringify(evidence);
  if (!existing.some((item) => JSON.stringify(item) === serialized)) existing.push(evidence);
  candidate.channels[channel] = existing;
  candidates.set(key, candidate);
};

// Channel 1: exact targetOps write x write intersections.
for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < leaves.length; rightIndex += 1) {
    const left = leaves[leftIndex];
    const right = leaves[rightIndex];
    const rightWrites = new Map();
    for (const op of right.targetOps.filter((candidate) => candidate.role === "write")) {
      const target = normalizeTarget(op.target);
      const list = rightWrites.get(target) ?? [];
      list.push(op);
      rightWrites.set(target, list);
    }
    for (const leftOp of left.targetOps.filter((candidate) => candidate.role === "write")) {
      const target = normalizeTarget(leftOp.target);
      for (const rightOp of rightWrites.get(target) ?? []) {
        nominate(left, right, "c1", {
          target,
          left: opEvidence(leftOp),
          right: opEvidence(rightOp),
        });
      }
    }
  }
}

// Channel 2: exact write x dependency/truth-source intersections. Deletion of
// a consumed/convergence target is called out explicitly for S2.
for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < leaves.length; rightIndex += 1) {
    const left = leaves[leftIndex];
    const right = leaves[rightIndex];
    for (const leftOp of left.targetOps) {
      for (const rightOp of right.targetOps) {
        if (normalizeTarget(leftOp.target) !== normalizeTarget(rightOp.target)) continue;
        const roles = new Set([leftOp.role, rightOp.role]);
        if (!roles.has("write") || roles.size !== 2) continue;
        const dependencyOp = leftOp.role === "write" ? rightOp : leftOp;
        if (!new Set(["dependency", "truth-source"]).has(dependencyOp.role)) continue;
        const writeOp = leftOp.role === "write" ? leftOp : rightOp;
        nominate(left, right, "c2", {
          target: normalizeTarget(leftOp.target),
          case:
            writeOp.action === "delete"
              ? dependencyOp.role === "dependency"
                ? "converge-vs-delete"
                : "truth-source-vs-delete"
              : `write-vs-${dependencyOp.role}`,
          left: opEvidence(leftOp),
          right: opEvidence(rightOp),
        });
      }
    }
  }
}

const evidencePaths = (record) => {
  const paths = new Map();
  for (const citation of record.citations.filter((item) => item.section === "Evidence")) {
    const path = citation.resolvedPath ?? normalizeTarget(citation.path);
    if (!path || (!citation.resolvedPath && !path.includes("/"))) continue;
    const entry = paths.get(path) ?? { lines: [], resolutions: new Set() };
    if (citation.line !== null) entry.lines.push([citation.line, citation.endLine]);
    entry.resolutions.add(citation.resolution);
    paths.set(path, entry);
  }
  return paths;
};

const writeOpsByTarget = (record) => {
  const targets = new Map();
  for (const op of record.targetOps.filter((candidate) => candidate.role === "write")) {
    const target = normalizeTarget(op.target);
    const entries = targets.get(target) ?? [];
    entries.push(opEvidence(op));
    targets.set(target, entries);
  }
  return targets;
};

const pathIndexes = new Map(
  leaves.map((record) => [
    record.file,
    { evidence: evidencePaths(record), writes: writeOpsByTarget(record) },
  ]),
);

// Channel 3: shared evidence paths plus evidence x proposed-write overlaps.
// Keeping the match modes visible preserves the deliberately lower-weight
// docs/code sibling signal rather than disguising it as write x write.
const pathPairStats = (population) => {
  let anyEvidence = 0;
  let evidenceWrite = 0;
  let atLeastTwo = 0;
  for (let leftIndex = 0; leftIndex < population.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < population.length; rightIndex += 1) {
      const left = pathIndexes.get(population[leftIndex].file);
      const right = pathIndexes.get(population[rightIndex].file);
      const sharedEvidence = [...left.evidence.keys()].filter((path) =>
        right.evidence.has(path),
      );
      const cross = new Set([
        ...[...left.evidence.keys()].filter((path) => right.writes.has(path)),
        ...[...right.evidence.keys()].filter((path) => left.writes.has(path)),
      ]);
      if (sharedEvidence.length) anyEvidence += 1;
      if (cross.size) evidenceWrite += 1;
      if (new Set([...sharedEvidence, ...cross]).size >= 2) atLeastTwo += 1;
    }
  }
  return { anyEvidence, evidenceWrite, atLeastTwo };
};

const scaleCitationPaths = (record, section = null) =>
  new Set(
    record.citations
      .filter(
        (citation) =>
          (section === null || citation.section === section) &&
          /^(?:packages|scripts|docs|\.github|\.husky)\//.test(citation.path),
      )
      .map((citation) => citation.path),
  );

const pathScaleStats = (population) => {
  let sharingAnyCitedPath = 0;
  let sharingProposedDirectionPath = 0;
  let sharingAtLeastTwoPaths = 0;
  for (let leftIndex = 0; leftIndex < population.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < population.length; rightIndex += 1) {
      const left = population[leftIndex];
      const right = population[rightIndex];
      const leftAll = scaleCitationPaths(left);
      const rightAll = scaleCitationPaths(right);
      if ([...leftAll].some((path) => rightAll.has(path))) sharingAnyCitedPath += 1;
      const leftEvidence = scaleCitationPaths(left, "Evidence");
      const rightEvidence = scaleCitationPaths(right, "Evidence");
      const leftDirection = scaleCitationPaths(left, "Proposed direction");
      const rightDirection = scaleCitationPaths(right, "Proposed direction");
      const evidenceDirectionPaths = new Set([
        ...[...leftEvidence].filter((path) => rightDirection.has(path)),
        ...[...rightEvidence].filter((path) => leftDirection.has(path)),
      ]);
      if (evidenceDirectionPaths.size) sharingProposedDirectionPath += 1;
      if (evidenceDirectionPaths.size >= 2) sharingAtLeastTwoPaths += 1;
    }
  }
  return { sharingAnyCitedPath, sharingProposedDirectionPath, sharingAtLeastTwoPaths };
};

for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < leaves.length; rightIndex += 1) {
    const leftRecord = leaves[leftIndex];
    const rightRecord = leaves[rightIndex];
    const left = pathIndexes.get(leftRecord.file);
    const right = pathIndexes.get(rightRecord.file);
    const paths = new Set([
      ...[...left.evidence.keys()].filter((path) => right.evidence.has(path)),
      ...[...left.evidence.keys()].filter((path) => right.writes.has(path)),
      ...[...right.evidence.keys()].filter((path) => left.writes.has(path)),
    ]);
    for (const path of [...paths].sort()) {
      const modes = [];
      if (left.evidence.has(path) && right.evidence.has(path)) modes.push("evidence-evidence");
      if (left.evidence.has(path) && right.writes.has(path)) modes.push("left-evidence-right-write");
      if (right.evidence.has(path) && left.writes.has(path)) modes.push("left-write-right-evidence");
      nominate(leftRecord, rightRecord, "c3", {
        path,
        modes,
        ...(left.evidence.has(path) && left.evidence.get(path).lines.length
          ? { leftLines: left.evidence.get(path).lines }
          : {}),
        ...(right.evidence.has(path) && right.evidence.get(path).lines.length
          ? { rightLines: right.evidence.get(path).lines }
          : {}),
        ...(left.writes.has(path) ? { leftWrites: left.writes.get(path) } : {}),
        ...(right.writes.has(path) ? { rightWrites: right.writes.get(path) } : {}),
      });
    }
  }
}

const stem = (token) => {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
};

const lexicalText = (record) =>
  [
    record.title,
    record.theme,
    record.problemFingerprint.subject,
    record.problemFingerprint.mechanism,
    record.problemFingerprint.invariant,
    record.concreteEdit,
  ]
    .filter(Boolean)
    .join(" ");

const tokenize = (value) => {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return expanded
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !stopwords.has(token) && !/^\d+$/.test(token))
    .map(stem)
    .filter((token) => token.length >= 3 && !stopwords.has(token));
};

const termCounts = new Map();
const documentFrequency = new Map();
for (const record of leaves) {
  const counts = new Map();
  for (const token of tokenize(lexicalText(record))) counts.set(token, (counts.get(token) ?? 0) + 1);
  termCounts.set(record.file, counts);
  for (const token of counts.keys()) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
}

const vectors = new Map();
for (const record of leaves) {
  const vector = new Map();
  let magnitudeSquared = 0;
  for (const [token, count] of termCounts.get(record.file)) {
    const idf = Math.log((leaves.length + 1) / ((documentFrequency.get(token) ?? 0) + 1)) + 1;
    const value = (1 + Math.log(count)) * idf;
    vector.set(token, value);
    magnitudeSquared += value * value;
  }
  vectors.set(record.file, { terms: vector, magnitude: Math.sqrt(magnitudeSquared) });
}

const lexicalSimilarity = (left, right) => {
  const leftVector = vectors.get(left.file);
  const rightVector = vectors.get(right.file);
  let dot = 0;
  const shared = [];
  for (const [token, leftValue] of leftVector.terms) {
    const rightValue = rightVector.terms.get(token);
    if (rightValue === undefined) continue;
    const contribution = leftValue * rightValue;
    dot += contribution;
    shared.push([token, contribution]);
  }
  const denominator = leftVector.magnitude * rightVector.magnitude;
  return {
    score: denominator === 0 ? 0 : dot / denominator,
    sharedTerms: shared.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([token]) => token),
  };
};

const lexicalNeighborCounts = new Map(leaves.map((record) => [record.number, 0]));
for (const source of leaves) {
  const neighbors = leaves
    .filter((candidate) => candidate.file !== source.file)
    .map((candidate) => ({ candidate, ...lexicalSimilarity(source, candidate) }))
    .sort(
      (left, right) =>
        right.score - left.score || left.candidate.leafNumber - right.candidate.leafNumber,
    )
    .slice(0, LEXICAL_K);
  for (let index = 0; index < neighbors.length; index += 1) {
    const neighbor = neighbors[index];
    lexicalNeighborCounts.set(source.number, lexicalNeighborCounts.get(source.number) + 1);
    nominate(source, neighbor.candidate, "c4", {
      from: source.number,
      rank: index + 1,
      score: Number(neighbor.score.toFixed(4)),
      sharedTerms: neighbor.sharedTerms,
    });
  }
}

// Channel 5: every resolved pack reference. PLAN references resolve to their
// parent leaf because S2's population is the 270 leaves, not the companions.
for (const source of leaves) {
  for (const reference of source.intraPackReferences.filter((item) => item.status === "resolved")) {
    const exactTarget = s0.records.find((record) => record.file === reference.targetFile);
    const targetFile =
      exactTarget?.kind === "plan-companion" ? exactTarget.parentLeafFile : reference.targetFile;
    const target = byFile.get(targetFile);
    if (!target || target.file === source.file) continue;
    nominate(source, target, "c5", {
      from: source.number,
      referenced: reference.targetFile,
      kind: reference.kind,
      sourceLine: reference.sourceLine,
    });
  }
}

const sourceItemCache = new Map();
const sourceItem = (sourceItemId) => {
  if (sourceItemCache.has(sourceItemId)) return sourceItemCache.get(sourceItemId);
  const [source, selector] = sourceItemId.split("::");
  if (!source || !selector) return null;
  const sourcePath = join(packRoot, "working", source);
  if (!existsSync(sourcePath)) return null;
  let value = readJson(sourcePath);
  for (const match of selector.matchAll(/([A-Za-z0-9_-]+)|\[(\d+)\]/g)) {
    value = match[2] === undefined ? value?.[match[1]] : value?.[Number(match[2])];
  }
  sourceItemCache.set(sourceItemId, value ?? null);
  return value ?? null;
};

const triageCandidateFiles = s0.sourceFiles.triage.filter((path) => path.endsWith("-candidates.json"));
const triageCandidates = triageCandidateFiles.flatMap((path) => readJson(join(packRoot, path)).candidates);
const triageCandidateById = new Map(triageCandidates.map((candidate) => [candidate.id, candidate]));
const provenanceAliases = new Map();
let promotionOriginsInspected = 0;
for (const record of leaves.filter((candidate) => candidate.leafNumber >= 204)) {
  for (const origin of record.promotionOrigins.flatMap((promotion) => promotion.origins)) {
    promotionOriginsInspected += 1;
    const item = sourceItem(origin.sourceItemId);
    const candidateId = item?.candidateId ?? (triageCandidateById.has(item?.id) ? item.id : null);
    if (!candidateId) continue;
    for (const alias of [candidateId, ...(triageCandidateById.get(candidateId)?.members ?? [])]) {
      const records = provenanceAliases.get(alias) ?? [];
      if (!records.some((candidate) => candidate.file === record.file)) records.push(record);
      provenanceAliases.set(alias, records);
    }
  }
}

let triageExpectedRelationRows = 0;
for (const source of leaves.filter((record) => record.leafNumber >= 204)) {
  for (const relation of source.triageExpectedRelations ?? []) {
    triageExpectedRelationRows += 1;
    const target = byFile.get(relation.target) ?? byNumber.get(String(relation.target).padStart(3, "0"));
    if (!target) continue;
    nominate(source, target, "c6", {
      source: "triageExpectedRelations",
      relation,
    });
  }
}

const promotionPoolCache = new Map();
let promotionExpectedRelationRows = 0;
let promotionExpectedRelationResolvedPairs = 0;
for (const source of leaves.filter((record) => record.leafNumber >= 204)) {
  for (const promotion of source.promotionOrigins) {
    if (!promotionPoolCache.has(promotion.pooledCandidateSource)) {
      const pool = readJson(join(packRoot, promotion.pooledCandidateSource));
      promotionPoolCache.set(
        promotion.pooledCandidateSource,
        new Map(pool.candidates.map((candidate) => [candidate.promotionId, candidate])),
      );
    }
    const candidate = promotionPoolCache
      .get(promotion.pooledCandidateSource)
      .get(promotion.promotionId);
    for (const hint of candidate?.existingLeafHints ?? []) {
      promotionExpectedRelationRows += 1;
      const targetNumbers = new Set(
        [...hint.matchAll(/\bleaf\s+(\d{1,3})\b/gi)].map((match) =>
          String(Number(match[1])).padStart(3, "0"),
        ),
      );
      for (const targetNumber of targetNumbers) {
        const target = byNumber.get(targetNumber);
        if (!target || target.file === source.file) continue;
        promotionExpectedRelationResolvedPairs += 1;
        nominate(source, target, "c6", {
          source: "promotionOrigins.existingLeafHints",
          promotionId: promotion.promotionId,
          pooledCandidateSource: promotion.pooledCandidateSource,
          hint,
        });
      }
    }
  }
}

let batch1OverlapRows = 0;
let batch1OverlapResolvedPairs = 0;
for (const candidate of triageCandidates.filter((item) => item.batch1Overlap !== null && item.batch1Overlap !== undefined)) {
  batch1OverlapRows += 1;
  const sourceRecords = new Set([
    ...(provenanceAliases.get(candidate.id) ?? []),
    ...(candidate.members ?? []).flatMap((member) => provenanceAliases.get(member) ?? []),
  ]);
  const targetCandidate = triageCandidateById.get(candidate.batch1Overlap.batch1Id);
  const targetRecords = new Set([
    ...(provenanceAliases.get(candidate.batch1Overlap.batch1Id) ?? []),
    ...(targetCandidate?.members ?? []).flatMap((member) => provenanceAliases.get(member) ?? []),
  ]);
  for (const source of sourceRecords) {
    for (const target of targetRecords) {
      if (source.file === target.file) continue;
      batch1OverlapResolvedPairs += 1;
      nominate(source, target, "c6", {
        source: "batch1Overlap",
        fromCandidate: candidate.id,
        toCandidate: candidate.batch1Overlap.batch1Id,
        relation: candidate.batch1Overlap.relation,
        note: candidate.batch1Overlap.note,
      });
    }
  }
}

const claimTargetNumbers = (claim) => {
  const targets = new Set();
  const value = `${claim.strength} ${claim.text}`;
  for (const pattern of [/\b(\d{3})-[a-z0-9-]+\.md\b/gi, /\bleaf\s+(\d{1,3})\b/gi]) {
    for (const match of value.matchAll(pattern)) {
      const number = String(Number(match[1])).padStart(3, "0");
      if (byNumber.has(number)) targets.add(number);
    }
  }
  return targets;
};

const deniesSequencing = (claim) => {
  const value = `${claim.strength} ${claim.text}`.toLowerCase();
  if (
    /ordering-only|either order|preferred-order|qualified|merge friction|external-only|internal split|internal to|scope separation|semantic-only/.test(
      value,
    )
  )
    return false;
  if (/two slices|prior-pack|live 2026-07-25 pack/.test(value)) return false;
  return /no sequencing|no ordering|no (?:implementation |logical |semantic |additional )?(?:cross-leaf )?dependenc|independent|neither blocks nor is blocked|no ordering constraint/.test(
    value,
  );
};

const relationsTo = new Map();
for (const source of leaves) {
  for (const relation of source.relations) {
    const target = byFile.get(relation.target);
    if (!target || target.file === source.file) continue;
    const list = relationsTo.get(target.file) ?? [];
    list.push({ source, relation });
    relationsTo.set(target.file, list);
  }
}

const overlappingOps = (left, right) => {
  const evidence = [];
  for (const leftOp of left.targetOps) {
    for (const rightOp of right.targetOps) {
      if (normalizeTarget(leftOp.target) !== normalizeTarget(rightOp.target)) continue;
      if (leftOp.role !== "write" && rightOp.role !== "write") continue;
      evidence.push({
        target: normalizeTarget(leftOp.target),
        left: opEvidence(leftOp),
        right: opEvidence(rightOp),
      });
    }
  }
  return evidence;
};

let independenceClaimsConsidered = 0;
for (const claimant of leaves.filter((record) => record.independenceClaim !== null)) {
  if (!deniesSequencing(claimant.independenceClaim)) continue;
  independenceClaimsConsidered += 1;
  const namedTargets = claimTargetNumbers(claimant.independenceClaim);
  const appliesTo = (other) => namedTargets.size === 0 || namedTargets.has(other.number);
  for (const inbound of relationsTo.get(claimant.file) ?? []) {
    if (!appliesTo(inbound.source)) continue;
    nominate(claimant, inbound.source, "c7", {
      claimant: claimant.number,
      claim: claimant.independenceClaim,
      contradiction: "inbound-declared-relation",
      declaredBy: inbound.source.number,
      relation: inbound.relation,
    });
  }
  for (const other of leaves) {
    if (other.file === claimant.file || !appliesTo(other)) continue;
    const overlaps = overlappingOps(claimant, other);
    if (!overlaps.length) continue;
    nominate(claimant, other, "c7", {
      claimant: claimant.number,
      claim: claimant.independenceClaim,
      contradiction: "targetOps-overlap",
      overlaps,
    });
  }
}

// Channel 8: preserve S1's reader signal as explicitly non-authoritative.
for (const nearMiss of s1.withinChunkNearMisses) {
  const left = byFile.get(nearMiss.pair[0]);
  const right = byFile.get(nearMiss.pair[1]);
  if (!left || !right) continue;
  nominate(left, right, "c8", {
    chunk: nearMiss.chunk,
    reason: nearMiss.reason,
    nonAuthoritative: true,
  });
}

const pairs = [...candidates.values()].sort(
  (left, right) => Number(left.pair[0]) - Number(right.pair[0]) || Number(left.pair[1]) - Number(right.pair[1]),
);
for (const pair of pairs) {
  pair.channels = Object.fromEntries(
    Object.entries(pair.channels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([channel, evidence]) => [channel, evidence]),
  );
}

const channelCounts = Object.fromEntries(
  Object.keys(channelDefinitions).map((channel) => [
    channel,
    pairs.filter((pair) => pair.channels[channel] !== undefined).length,
  ]),
);
const channelEvidenceCounts = Object.fromEntries(
  Object.keys(channelDefinitions).map((channel) => [
    channel,
    pairs.reduce((count, pair) => count + (pair.channels[channel]?.length ?? 0), 0),
  ]),
);

const targetIndex = [
  ...new Set([
    ...leaves.flatMap((record) => record.targetOps.map((op) => normalizeTarget(op.target))),
    ...pairs.flatMap((pair) =>
      pair.channels.c3?.map((item) => normalizeTarget(item.path)) ?? [],
    ),
  ]),
].sort();
const targetIds = new Map(targetIndex.map((target, index) => [target, index]));
const targetId = (target) => {
  const id = targetIds.get(normalizeTarget(target));
  if (id === undefined) throw new Error(`target is absent from targetIndex: ${target}`);
  return id;
};

const compactOpCode = (op) =>
  `${{ create: "c", modify: "m", move: "v", delete: "d", consume: "x", document: "o" }[op.action]}${{ write: "w", dependency: "d", "truth-source": "t" }[op.role]}${op.branch === null || op.branch === undefined ? "" : `@${op.branch}`}`;

const compactEvidence = (channel, evidence) => {
  if (channel === "c1")
    return evidence.map((item) => [
      targetId(item.target),
      compactOpCode(item.left),
      compactOpCode(item.right),
    ]);
  if (channel === "c2")
    return evidence.map((item) => [
      targetId(item.target),
      {
        "converge-vs-delete": "cvd",
        "truth-source-vs-delete": "tvd",
        "write-vs-dependency": "wd",
        "write-vs-truth-source": "wt",
      }[item.case],
      compactOpCode(item.left),
      compactOpCode(item.right),
    ]);
  if (channel === "c3") {
    const modeCodes = {
      "evidence-evidence": 1,
      "left-evidence-right-write": 2,
      "left-write-right-evidence": 4,
    };
    return evidence.map((item) => [
      targetId(item.path),
      item.modes.reduce((mask, mode) => mask + modeCodes[mode], 0),
    ]);
  }
  if (channel === "c4")
    return evidence.map((item) => [
      Number(item.from),
      item.rank,
      item.score,
      item.sharedTerms.slice(0, 2).join(","),
    ]);
  if (channel === "c5")
    return evidence.map((item) => [
      Number(item.from),
      item.referenced.endsWith("-PLAN.md") ? item.referenced : null,
      item.kind.slice(0, 1),
      item.sourceLine,
    ]);
  if (channel === "c6")
    return evidence.map((item) =>
      item.source === "promotionOrigins.existingLeafHints"
        ? ["p", item.promotionId, item.hint]
        : item.source === "batch1Overlap"
          ? ["b", item.fromCandidate, item.toCandidate, item.relation, item.note]
          : ["t", item.relation],
    );
  if (channel === "c7")
    return evidence.map((item) => [
      item.claimant,
      item.contradiction,
      item.contradiction === "targetOps-overlap"
        ? [...new Set(item.overlaps.map((overlap) => targetId(overlap.target)))]
        : [
            Number(item.declaredBy),
            item.relation.kind,
            item.relation.confidence,
          ],
    ]);
  if (channel === "c8") return evidence.map((item) => [item.chunk, item.reason]);
  throw new Error(`cannot compact unknown channel ${channel}`);
};

const compactPairs = pairs.map((pair) => [
  Number(pair.pair[0]),
  Number(pair.pair[1]),
  Object.fromEntries(
    Object.entries(pair.channels).map(([channel, evidence]) => [
      channel,
      compactEvidence(channel, evidence),
    ]),
  ),
]);

const targetPrefixes = [
  "packages/client/src/",
  "packages/server/src/",
  "packages/shared/src/",
  "packages/client/",
  "packages/server/",
  "packages/shared/",
  "scripts/",
  "docs/",
  "working/",
];
const indexedTarget = (target) => {
  const index = targetPrefixes.findIndex((prefix) => target.startsWith(prefix));
  return index === -1 ? target : `${index}:${target.slice(targetPrefixes[index].length)}`;
};

const originalPopulation = leaves.filter((record) => record.leafNumber <= ORIGINAL_LEAF_COUNT);
const originalPathStats = pathScaleStats(originalPopulation);
const fullPathStats = pathScaleStats(leaves);
const fullChannel3Stats = pathPairStats(leaves);
const phase4JoinGap = s0.joinGaps.find((gap) => gap.id === "phase4-candidate-to-leaf");
const provenanceCoverage = {
  covered: "leaves 204-270 via exact promotionOrigins",
  coveredLeafCount: leaves.filter((record) => record.leafNumber >= 204).length,
  notCovered: "leaves 001-203",
  notCoveredLeafCount: leaves.filter((record) => record.leafNumber <= 203).length,
  reason: phase4JoinGap?.reason ?? "Phase-4 candidate-to-leaf join is unavailable",
  promotionOriginsInspected,
  recoveredCandidateAliases: provenanceAliases.size,
  triageExpectedRelationRows,
  promotionExpectedRelationRows,
  promotionExpectedRelationResolvedPairs,
  batch1OverlapRows,
  batch1OverlapResolvedPairs,
  note:
    "Channel c6 is evaluated only where promotionOrigins preserve an exact candidate join. It cannot apply the Phase-4 batch seam prior to leaves 001-203; a zero or small count is a known coverage limitation, not evidence that the seam is clean.",
};

const artifact = {
  header: {
    schemaVersion: 1,
    step: "S2-candidate-channels",
    generator: "working/phase5/build-s2-input.mjs",
    auditTargetSha: s0.header.auditTargetSha,
    leafCount: leaves.length,
    lexicalK: LEXICAL_K,
  },
  leafIndex: leaves.map((record) => record.file),
  targetPrefixes,
  targetIndex: targetIndex.map(indexedTarget),
  independenceClaims: Object.fromEntries(
    leaves
      .filter((record) => record.independenceClaim !== null && deniesSequencing(record.independenceClaim))
      .map((record) => [record.number, record.independenceClaim]),
  ),
  summary: {
    possiblePairs: (leaves.length * (leaves.length - 1)) / 2,
    candidatePairCount: pairs.length,
    channelCounts,
    channelEvidenceCounts,
    pathScaleCheck: {
      planBaseline: {
        population: 203,
        possiblePairs: 20503,
        sharingAnyCitedPath: 1204,
        sharingProposedDirectionPath: 469,
        sharingAtLeastTwoPaths: 60,
      },
      derivedOriginalPopulation: {
        population: originalPopulation.length,
        possiblePairs: (originalPopulation.length * (originalPopulation.length - 1)) / 2,
        ...originalPathStats,
        note:
          "Like-for-like compatibility check over root-qualified displayed citation paths after later augmentations: any shared citation; the Evidence-to-Proposed-direction subset; and >=2 paths in that subset.",
      },
      derivedFrozenPopulation: {
        population: leaves.length,
        possiblePairs: (leaves.length * (leaves.length - 1)) / 2,
        ...fullPathStats,
      },
      channel3FrozenPopulation: {
        ...fullChannel3Stats,
        note:
          "The emitted channel is broader than the compatibility check: normalized S0 Evidence paths plus evidence-to-S1-write intersections.",
      },
    },
    lexical: {
      method: "TF-IDF cosine over stemmed non-stopword tokens",
      fields: ["title", "theme", "problemFingerprint", "concreteEdit"],
      k: LEXICAL_K,
      nominations: [...lexicalNeighborCounts.values()].reduce((sum, count) => sum + count, 0),
    },
    channel6Coverage: provenanceCoverage,
  },
  channelDefinitions,
  evidenceTupleSchemas,
  pairs: compactPairs,
};

const compactOps = (record) => {
  const base = record.targetOps.filter((op) => op.branch === null || op.branch === undefined);
  const branches = new Map();
  for (const op of record.targetOps.filter((candidate) => candidate.branch !== null && candidate.branch !== undefined)) {
    const list = branches.get(op.branch) ?? [];
    list.push(op);
    branches.set(op.branch, list);
  }
  const render = (ops) =>
    ops
      .map(
        (op) => `p${targetId(op.target)}[${compactOpCode(op)}]`,
      )
      .join("; ") || "none";
  const parts = [];
  if (base.length) parts.push(`base:${render(base)}`);
  for (const [branch, ops] of branches) parts.push(`alt(${branch}):${render(ops)}`);
  return parts.join(" || ") || "none";
};

const digestBlocks = leaves.map((record) => {
  const fingerprint = record.problemFingerprint;
  const relations = record.relations.length
    ? record.relations
        .map((relation) => `${relation.kind}>${byFile.get(relation.target)?.number ?? relation.target}[${relation.confidence}]`)
        .join(";")
    : "-";
  return [
    `## ${record.number} \`${record.file}\``,
    `T: ${record.title}`,
    `M: ${record.theme} · ${record.area} · ${record.severity} · ${record.size}`,
    `F: ${fingerprint.subject} | ${fingerprint.mechanism} | ${fingerprint.invariant}`,
    `O: ${compactOps(record)}`,
    `R: ${relations}`,
  ].join("\n");
});

const digest = [
  "# S2 compact leaf digest",
  "",
  "Generated by `working/phase5/build-s2-input.mjs` from S0/S1. Fields: T=title, M=Theme · Area · Severity · Size, F=problem fingerprint subject | mechanism | invariant, O=targetOps, R=relations. `pN` identifies the exact target at zero-based `targetIndex[N]` in `s2-channels.json`. Op codes: c=create, m=modify, v=move, d=delete, x=consume, o=document; roles: w=write, d=dependency, t=truth-source. `base` is unconditional; each `alt(name)` is a separate alternative. Relations are kind>leaf[confidence].",
  "",
  ...digestBlocks.flatMap((block) => [block, ""]),
].join("\n");

const channelsText = `${JSON.stringify(artifact)}\n`;

const validate = () => {
  const errors = [];
  if (s0.header.leafCount !== EXPECTED_LEAF_COUNT) errors.push(`S0 has ${s0.header.leafCount} leaves`);
  if (s1.fileCount !== EXPECTED_LEAF_COUNT) errors.push(`S1 has ${s1.fileCount} leaves`);
  if (s0.header.auditTargetSha !== s1.auditTargetSha) errors.push("S0/S1 auditTargetSha mismatch");
  if (leaves.length !== EXPECTED_LEAF_COUNT) errors.push(`merged population has ${leaves.length} leaves`);
  if (new Set(leaves.map((record) => record.file)).size !== leaves.length) errors.push("duplicate leaf file");
  if (new Set(leaves.map((record) => record.number)).size !== leaves.length) errors.push("duplicate leaf number");
  for (let number = 1; number <= EXPECTED_LEAF_COUNT; number += 1) {
    const padded = String(number).padStart(3, "0");
    if (!byNumber.has(padded)) errors.push(`missing leaf ${padded}`);
  }
  const seenPairs = new Set();
  for (const pair of pairs) {
    const key = pair.pair.join("-");
    if (seenPairs.has(key)) errors.push(`duplicate pair ${key}`);
    seenPairs.add(key);
    if (Number(pair.pair[0]) >= Number(pair.pair[1])) errors.push(`unordered pair ${key}`);
    for (const [channel, evidence] of Object.entries(pair.channels)) {
      if (!channelDefinitions[channel]) errors.push(`${key}: unknown channel ${channel}`);
      if (!Array.isArray(evidence) || evidence.length === 0) errors.push(`${key}/${channel}: no evidence`);
      if (channel === "c1" && evidence.some((item) => !item.target || item.left.role !== "write" || item.right.role !== "write"))
        errors.push(`${key}/c1: malformed write x write evidence`);
      if (channel === "c2" && evidence.some((item) => !item.target || !item.case || item.left.role === item.right.role))
        errors.push(`${key}/c2: malformed write x dependency evidence`);
      if (channel === "c3" && evidence.some((item) => !item.path || !item.modes?.length))
        errors.push(`${key}/c3: malformed path evidence`);
      if (channel === "c4" && evidence.some((item) => !item.from || item.rank < 1 || item.rank > LEXICAL_K))
        errors.push(`${key}/c4: malformed lexical evidence`);
      if (channel === "c5" && evidence.some((item) => !item.from || !item.referenced || !item.sourceLine))
        errors.push(`${key}/c5: malformed reference evidence`);
      if (channel === "c6" && evidence.some((item) => !item.source))
        errors.push(`${key}/c6: malformed provenance evidence`);
      if (channel === "c7" && evidence.some((item) => !item.claimant || !item.claim || !item.contradiction))
        errors.push(`${key}/c7: malformed independence evidence`);
      if (channel === "c8" && evidence.some((item) => item.nonAuthoritative !== true || !item.reason))
        errors.push(`${key}/c8: malformed near-miss evidence`);
    }
  }
  for (const channel of Object.keys(channelDefinitions)) {
    const derivedCount = pairs.filter((pair) => pair.channels[channel]).length;
    if (derivedCount !== channelCounts[channel]) errors.push(`${channel}: summary count mismatch`);
  }
  for (const [number, count] of lexicalNeighborCounts) {
    if (count !== LEXICAL_K) errors.push(`${number}: ${count} lexical nominations, expected ${LEXICAL_K}`);
  }
  if (originalPopulation.length !== ORIGINAL_LEAF_COUNT) errors.push("path baseline population is not 203");
  if ((ORIGINAL_LEAF_COUNT * (ORIGINAL_LEAF_COUNT - 1)) / 2 !== 20503)
    errors.push("path baseline possible-pair arithmetic failed");
  for (const [field, baseline] of Object.entries({
    sharingAnyCitedPath: 1204,
    sharingProposedDirectionPath: 469,
    sharingAtLeastTwoPaths: 60,
  })) {
    const actual = originalPathStats[field];
    if (actual < baseline * 0.5 || actual > baseline * 2)
      errors.push(`path scale ${field} is wildly outside the plan baseline: ${actual}`);
  }
  const digestNumbers = [...digest.matchAll(/^## (\d{3}) `/gm)].map((match) => match[1]);
  if (digestNumbers.length !== EXPECTED_LEAF_COUNT) errors.push(`digest has ${digestNumbers.length} blocks`);
  if (new Set(digestNumbers).size !== EXPECTED_LEAF_COUNT) errors.push("digest has duplicate blocks");
  for (const record of leaves) {
    if (!digest.includes(`## ${record.number} \`${record.file}\``)) errors.push(`digest missing ${record.file}`);
    for (const op of record.targetOps) {
      const rendered = `p${targetId(op.target)}[${compactOpCode(op)}]`;
      if (!digest.includes(rendered)) errors.push(`digest missing op ${record.number}:${op.target}`);
    }
  }
  return errors;
};

const structuralErrors = validate();
const summarize = (errors) => {
  console.log(`S2 inputs: ${leaves.length} leaves, ${pairs.length} candidate pairs, ${errors.length} structural error(s)`);
  console.log(
    `channels: ${Object.entries(channelCounts).map(([channel, count]) => `${channel}=${count}`).join(", ")}`,
  );
  console.log(
    `path scale (original 203): ${originalPathStats.sharingAnyCitedPath}/${originalPathStats.sharingProposedDirectionPath}/${originalPathStats.sharingAtLeastTwoPaths}; plan rough check 1204/469/60`,
  );
  console.log(
    `channel 6: ${provenanceCoverage.coveredLeafCount} covered, ${provenanceCoverage.notCoveredLeafCount} uncovered, ${channelCounts.c6} pairs`,
  );
  console.log(
    `digest: ${Buffer.byteLength(digest, "utf8")} bytes, approximately ${Math.ceil(digest.length / 4)} tokens by the plan's chars/4 estimate`,
  );
  console.log(
    `combined generated inputs: ${Buffer.byteLength(channelsText, "utf8") + Buffer.byteLength(digest, "utf8")} bytes, approximately ${Math.ceil((channelsText.length + digest.length) / 4)} tokens`,
  );
  for (const error of errors) console.error(`  ERROR: ${error}`);
};

if (process.argv.includes("--check")) {
  if (!existsSync(channelsPath)) structuralErrors.unshift("s2-channels.json does not exist");
  else if (readFileSync(channelsPath, "utf8") !== channelsText)
    structuralErrors.unshift("s2-channels.json is stale or inconsistent with derivation");
  if (!existsSync(digestPath)) structuralErrors.unshift("s2-digest.md does not exist");
  else if (readFileSync(digestPath, "utf8") !== digest)
    structuralErrors.unshift("s2-digest.md is stale or inconsistent with derivation");
  summarize(structuralErrors);
  process.exitCode = structuralErrors.length ? 1 : 0;
} else if (structuralErrors.length) {
  summarize(structuralErrors);
  process.exitCode = 1;
} else {
  writeFileSync(channelsPath, channelsText);
  writeFileSync(digestPath, digest);
  summarize([]);
  console.log(`wrote ${relative(packRoot, channelsPath)}`);
  console.log(`wrote ${relative(packRoot, digestPath)}`);
}
