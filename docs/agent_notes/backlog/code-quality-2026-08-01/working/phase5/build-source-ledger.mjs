#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const EXPECTED = {
  wave1Files: 9,
  wave2Files: 9,
  cuts: 248,
  drops: 250,
  batch1Rejected: 9,
  batch1VerifyRejected: 2,
  batch1JudgeRejected: 7,
  batch2JudgeRejected: 14,
  acceptedRefutations: 5,
  overrides: 2,
  structuredKills: 28,
  rawRecords: 526,
  cutsByLane: {
    "01": 30,
    "02": 23,
    "03": 27,
    "04": 12,
    "05": 57,
    "06": 30,
    "07": 29,
    "08": 19,
    "09": 21,
  },
};

const ACCEPTED_REFUTATION_IDS = ["D-033", "D-082", "D-093", "D-094", "D-139"];
const OVERRIDE_IDS = ["D-115", "D-121"];
const LINEAGE_VALUES = new Set([
  "eligible",
  "already-promoted",
  "already-dismissed",
  "superseded-by-later-round",
  "duplicate-occurrence",
  "meta-disposition",
  "sampled",
  "not-sampled",
]);
const MAX_D_REFS = 20;
const MAX_D_CLAIMANTS = 30;

function fail(message) {
  throw new Error(`source-ledger assertion failed: ${message}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
}

function assertSet(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${label}: expected [${expectedSorted.join(", ")}], got [${actualSorted.join(", ")}]`);
  }
}

function readJson(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${relativePath}: could not read valid JSON (${error.message})`);
  }
}

function parseArguments(argv) {
  let round = 1;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      console.log("Usage: bun build-source-ledger.mjs [--round N]");
      process.exit(0);
    }
    if (argument === "--round") {
      const value = argv[index + 1];
      if (!value) fail("--round requires a positive integer");
      round = Number(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--round=")) {
      round = Number(argument.slice("--round=".length));
      continue;
    }
    fail(`unknown argument ${argument}`);
  }
  if (!Number.isSafeInteger(round) || round < 1) fail(`--round: expected a positive integer, got ${round}`);
  return { round };
}

function findRepoRoot(startDirectory) {
  let current = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(current, ".git")) && fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) fail(`could not find repository root from ${startDirectory}`);
    current = parent;
  }
}

function jsonPointer(...segments) {
  return `/${segments.map((segment) => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function sourceItemId(sourceFile, arrayName, index) {
  return `${sourceFile}::${arrayName}[${index}]`;
}

function laneNumber(lane, label) {
  const match = /^lane-(\d{2})-/.exec(lane ?? "");
  if (!match) fail(`${label}: malformed lane ${JSON.stringify(lane)}`);
  return match[1];
}

function unique(values) {
  return [...new Set(values)];
}

function compareIds(left, right) {
  return left.localeCompare(right, "en", { numeric: true });
}

function normalizeText(value) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/^dismissed:\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOP_WORDS = new Set(
  "a an and are as at be became been being beside between both but by can could despite do does each for from has have in inside into is it its no not of on one or remain remains same should than that the their them these they this three through to two under use uses was were while with without".split(
    " ",
  ),
);

function stemToken(token) {
  return token.replace(/(?:ization|ations|ation|ments|ment|ingly|edly|ing|ied|ies|ed|es|s)$/, "");
}

function comparisonTokens(value) {
  const titlePart = value.replace(/^dismissed:\s*/i, "").split(/\s+[—–]\s+/, 1)[0];
  return new Set(
    normalizeText(titlePart)
      .split(" ")
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
      .map(stemToken)
      .filter((token) => token.length > 1),
  );
}

function tokenDice(left, right) {
  const leftTokens = comparisonTokens(left);
  const rightTokens = comparisonTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return { score: 0, shared: [] };
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).sort();
  return { score: (2 * shared.length) / (leftTokens.size + rightTokens.size), shared };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function waveRound(sourceFile) {
  if (sourceFile.startsWith("wave-1/")) return 0;
  if (sourceFile.endsWith("-r2.json")) return 2;
  if (sourceFile.endsWith("-micro.json")) return 3;
  return 1;
}

function cq25RefsFromText(value) {
  return unique(value.match(/CQ25-\d+/g) ?? []).sort(compareIds);
}

function candidateRefs(candidate, memberFindings) {
  const refs = [...(candidate.priorPackRefs ?? [])];
  for (const finding of memberFindings) {
    if (finding.priorPackOverlap?.ref) refs.push(finding.priorPackOverlap.ref);
  }
  return unique(refs).sort(compareIds);
}

function projectMemberFinding(findingRecord) {
  const finding = findingRecord.finding;
  return {
    findingId: finding.id,
    sourceFile: findingRecord.sourceFile,
    jsonPointer: findingRecord.jsonPointer,
    title: finding.title,
    area: finding.area,
    category: finding.category,
    problem: finding.problem,
    evidence: finding.evidence,
  };
}

function readInputs(repoRoot, workingRoot) {
  const listWaveFiles = (directory) =>
    fs
      .readdirSync(path.join(repoRoot, workingRoot, directory))
      .filter((name) => name.endsWith(".json"))
      .sort(compareIds)
      .map((name) => `${directory}/${name}`);

  const wave1Files = listWaveFiles("wave-1");
  const wave2Files = listWaveFiles("wave-2");
  assertEqual(wave1Files.length, EXPECTED.wave1Files, `${workingRoot}/wave-1 JSON file count`);
  assertEqual(wave2Files.length, EXPECTED.wave2Files, `${workingRoot}/wave-2 JSON file count`);

  const waveFiles = [...wave1Files, ...wave2Files];
  const waves = waveFiles.map((sourceFile) => ({ sourceFile, json: readJson(repoRoot, `${workingRoot}/${sourceFile}`) }));
  for (const { sourceFile, json } of waves) {
    if (!Array.isArray(json.findings)) fail(`${workingRoot}/${sourceFile} findings: expected an array`);
    if (!Array.isArray(json.coverage?.cut)) fail(`${workingRoot}/${sourceFile} coverage.cut: expected an array`);
    if (!json.coverage.cut.every((entry) => typeof entry === "string")) {
      fail(`${workingRoot}/${sourceFile} coverage.cut: expected every entry to be a bare string`);
    }
    if (!Array.isArray(json.droppedAsPriorPackDuplicate)) {
      fail(`${workingRoot}/${sourceFile} droppedAsPriorPackDuplicate: expected an array`);
    }
  }

  const triageFiles = {
    batch1Candidates: "triage/batch1-candidates.json",
    batch2Candidates: "triage/batch2-candidates.json",
    batch1Rejected: "triage/batch1-rejected.json",
    batch2Rejected: "triage/batch2-rejected.json",
    batch1Verify: "triage/batch1-verify.json",
    batch2Verify: "triage/batch2-verify.json",
    batch2Directions: "triage/batch2-directions.json",
  };
  const triage = Object.fromEntries(
    Object.entries(triageFiles).map(([name, sourceFile]) => [name, readJson(repoRoot, `${workingRoot}/${sourceFile}`)]),
  );
  return { waves, waveFiles, triage, triageFiles };
}

function assertGroundTruth(inputs, workingRoot) {
  const { waves, triage, triageFiles } = inputs;
  const cutCount = waves.reduce((count, wave) => count + wave.json.coverage.cut.length, 0);
  const dropCount = waves.reduce((count, wave) => count + wave.json.droppedAsPriorPackDuplicate.length, 0);
  assertEqual(cutCount, EXPECTED.cuts, `${workingRoot} wave coverage.cut total`);
  assertEqual(dropCount, EXPECTED.drops, `${workingRoot} wave droppedAsPriorPackDuplicate total`);

  assertEqual(triage.batch1Rejected.rejected?.length, EXPECTED.batch1Rejected, `${triageFiles.batch1Rejected} rejected[]`);
  assertEqual(
    triage.batch1Rejected.rejected.filter((row) => row.stage === "verify").length,
    EXPECTED.batch1VerifyRejected,
    `${triageFiles.batch1Rejected} rejected[stage=verify]`,
  );
  assertEqual(
    triage.batch1Rejected.rejected.filter((row) => row.stage === "judge").length,
    EXPECTED.batch1JudgeRejected,
    `${triageFiles.batch1Rejected} rejected[stage=judge]`,
  );
  assertEqual(triage.batch2Rejected.rejected?.length, EXPECTED.batch2JudgeRejected, `${triageFiles.batch2Rejected} rejected[]`);
  assertEqual(
    triage.batch2Rejected.rejected.filter((row) => row.stage === "judge").length,
    EXPECTED.batch2JudgeRejected,
    `${triageFiles.batch2Rejected} rejected[stage=judge]`,
  );

  const reviews = triage.batch2Directions.refuteReviews;
  assertEqual(reviews?.length, 7, `${triageFiles.batch2Directions} refuteReviews[]`);
  const accepted = reviews.filter((row) => row.verdict === "accept");
  const overrides = reviews.filter((row) => row.verdict === "override");
  assertEqual(accepted.length, EXPECTED.acceptedRefutations, `${triageFiles.batch2Directions} accepted refutations`);
  assertEqual(overrides.length, EXPECTED.overrides, `${triageFiles.batch2Directions} override refutations`);
  assertSet(
    accepted.map((row) => row.candidateId),
    ACCEPTED_REFUTATION_IDS,
    `${triageFiles.batch2Directions} accepted refutation ids`,
  );
  assertSet(
    overrides.map((row) => row.candidateId),
    OVERRIDE_IDS,
    `${triageFiles.batch2Directions} override ids`,
  );

  for (const [name, verify] of [
    [triageFiles.batch1Verify, triage.batch1Verify],
    [triageFiles.batch2Verify, triage.batch2Verify],
  ]) {
    if (!Array.isArray(verify.results)) fail(`${name} results: expected an array`);
    if (verify.results.some((row) => Object.hasOwn(row, "verdict"))) {
      fail(`${name} results: expected refuted/evidenceHolds booleans and no verdict key`);
    }
  }

  const cutsByLane = Object.fromEntries(Object.keys(EXPECTED.cutsByLane).map((lane) => [lane, 0]));
  for (const { sourceFile, json } of waves) {
    const lane = laneNumber(json.lane, `${sourceFile} lane`);
    cutsByLane[lane] += json.coverage.cut.length;
  }
  for (const [lane, expected] of Object.entries(EXPECTED.cutsByLane)) {
    assertEqual(cutsByLane[lane], expected, `wave coverage.cut lane ${lane}`);
  }

  assertEqual(
    EXPECTED.batch1Rejected + EXPECTED.batch2JudgeRejected + EXPECTED.acceptedRefutations,
    EXPECTED.structuredKills,
    "structured kill arithmetic",
  );
  assertEqual(cutCount + dropCount + EXPECTED.structuredKills, EXPECTED.rawRecords, "raw record arithmetic");
}

function buildIndexes(inputs, workingRoot) {
  const findingById = new Map();
  for (const { sourceFile, json } of inputs.waves) {
    json.findings.forEach((finding, index) => {
      if (findingById.has(finding.id)) fail(`duplicate wave finding id ${finding.id}`);
      if (!Array.isArray(finding.evidence)) fail(`${sourceFile} finding ${finding.id}: evidence must be an array`);
      findingById.set(finding.id, {
        finding,
        lane: json.lane,
        laneNumber: laneNumber(json.lane, `${sourceFile} finding ${finding.id}`),
        sourceFile,
        jsonPointer: jsonPointer("findings", index),
        waveRound: waveRound(sourceFile),
      });
    });
  }

  const candidateById = new Map();
  const candidateByMember = new Map();
  for (const [sourceFile, candidateFile] of [
    [inputs.triageFiles.batch1Candidates, inputs.triage.batch1Candidates],
    [inputs.triageFiles.batch2Candidates, inputs.triage.batch2Candidates],
  ]) {
    candidateFile.candidates.forEach((candidate, index) => {
      if (!Array.isArray(candidate.members)) fail(`${sourceFile} candidate ${candidate.id}: expected members[]`);
      if (Object.hasOwn(candidate, "memberFindingIds")) {
        fail(`${sourceFile} candidate ${candidate.id}: tree unexpectedly contains memberFindingIds; extractor expects members`);
      }
      if (candidateById.has(candidate.id)) fail(`duplicate candidate id ${candidate.id}`);
      const record = { candidate, sourceFile, jsonPointer: jsonPointer("candidates", index) };
      candidateById.set(candidate.id, record);
      for (const member of candidate.members) {
        if (!findingById.has(member)) fail(`${sourceFile} candidate ${candidate.id}: unresolved member ${member}`);
        if (candidateByMember.has(member)) fail(`wave finding ${member} belongs to more than one candidate`);
        candidateByMember.set(member, record);
      }
    });
  }
  assertEqual(candidateByMember.size, findingById.size, "candidate membership coverage over wave findings");
  return { findingById, candidateById, candidateByMember };
}

function createBaseRow({ sourceFile, pointer, index, lane, sourceClass, originalTitle, originalText }) {
  return {
    sourceItemId: sourceItemId(sourceFile, pointer.replace(/^\//, "").replaceAll("/", "."), index),
    sourceFile,
    jsonPointer: jsonPointer(...pointer.split("/").filter(Boolean), index),
    sourceIndex: index,
    lane,
    laneNumber: laneNumber(lane, `${sourceFile}${pointer}/${index}`),
    sourceClass,
    originalTitle,
    originalText,
    rejectionStage: null,
    rejectionReason: null,
    candidateId: null,
    memberFindingIds: [],
    memberFindings: [],
    area: null,
    category: null,
    problem: null,
    cq25Ref: null,
    cq25Refs: [],
    lineage: null,
    lineageMethod: null,
    lineageEvidence: null,
    sampling: null,
    samplingRounds: [],
  };
}

function buildStructuredKillRows(inputs, indexes) {
  const killSources = [
    {
      sourceFile: inputs.triageFiles.batch1Rejected,
      pointer: "/rejected",
      rows: inputs.triage.batch1Rejected.rejected,
      stage: (row) => row.stage,
    },
    {
      sourceFile: inputs.triageFiles.batch2Rejected,
      pointer: "/rejected",
      rows: inputs.triage.batch2Rejected.rejected,
      stage: (row) => row.stage,
    },
    {
      sourceFile: inputs.triageFiles.batch2Directions,
      pointer: "/refuteReviews",
      rows: inputs.triage.batch2Directions.refuteReviews.filter((row) => row.verdict === "accept"),
      stage: () => "refute-review",
      originalIndexes: inputs.triage.batch2Directions.refuteReviews,
    },
  ];
  const rows = [];
  for (const source of killSources) {
    for (const [localIndex, kill] of source.rows.entries()) {
      const candidateRecord = indexes.candidateById.get(kill.candidateId);
      if (!candidateRecord) fail(`${source.sourceFile} ${kill.candidateId}: candidate id did not resolve`);
      const candidate = candidateRecord.candidate;
      const memberRecords = candidate.members.map((id) => indexes.findingById.get(id));
      const lanes = unique(memberRecords.map((record) => record.lane));
      if (lanes.length !== 1) fail(`${source.sourceFile} ${kill.candidateId}: structured kill spans lanes ${lanes.join(", ")}`);
      const sourceIndex = source.originalIndexes ? source.originalIndexes.findIndex((row) => row.candidateId === kill.candidateId) : localIndex;
      const refs = candidateRefs(candidate, memberRecords.map((record) => record.finding));
      const memberFindings = memberRecords.map(projectMemberFinding);
      const row = createBaseRow({
        sourceFile: source.sourceFile,
        pointer: source.pointer,
        index: sourceIndex,
        lane: lanes[0],
        sourceClass: "structured-kill",
        originalTitle: candidate.title,
        originalText: candidate.title,
      });
      Object.assign(row, {
        rejectionStage: source.stage(kill),
        rejectionReason: kill.reason,
        candidateId: candidate.id,
        memberFindingIds: [...candidate.members],
        memberFindings,
        area: candidate.area,
        category: candidate.category,
        problem: candidate.problemSummary,
        cq25Ref: refs.length === 1 ? refs[0] : null,
        cq25Refs: refs,
        lineage: "sampled",
        lineageMethod: "rule",
        lineageEvidence: "exhaustive-structured-kill",
        sampling: {
          disposition: "sampled",
          rank: null,
          selectionReason: "exhaustive-structured-kill",
          round: 1,
        },
        samplingRounds: [
          { disposition: "sampled", rank: null, selectionReason: "exhaustive-structured-kill", round: 1 },
        ],
      });
      rows.push(row);
    }
  }
  assertEqual(rows.length, EXPECTED.structuredKills, "structured kill ledger rows");
  return rows;
}

function buildCutAndDropRows(inputs) {
  const cutRows = [];
  const dropRows = [];
  for (const { sourceFile, json } of inputs.waves) {
    json.coverage.cut.forEach((text, index) => {
      const refs = cq25RefsFromText(text);
      const row = createBaseRow({
        sourceFile,
        pointer: "/coverage/cut",
        index,
        lane: json.lane,
        sourceClass: "cut",
        originalTitle: text,
        originalText: text,
      });
      row.rejectionStage = "wave-cut";
      row.rejectionReason = text;
      row.cq25Ref = refs.length === 1 ? refs[0] : null;
      row.cq25Refs = refs;
      row.waveRound = waveRound(sourceFile);
      cutRows.push(row);
    });

    json.droppedAsPriorPackDuplicate.forEach((drop, index) => {
      if (!drop || typeof drop.title !== "string" || typeof drop.ref !== "string" || typeof drop.reason !== "string") {
        fail(`${sourceFile} droppedAsPriorPackDuplicate[${index}]: expected {title, ref, reason} strings`);
      }
      const row = createBaseRow({
        sourceFile,
        pointer: "/droppedAsPriorPackDuplicate",
        index,
        lane: json.lane,
        sourceClass: "prior-pack-drop",
        originalTitle: drop.title,
        originalText: drop.title,
      });
      Object.assign(row, {
        rejectionStage: "prior-pack-dedup",
        rejectionReason: drop.reason,
        cq25Ref: drop.ref,
        cq25Refs: [drop.ref],
        lineage: "sampled",
        lineageMethod: "rule",
        lineageEvidence: "exhaustive-prior-pack-drop",
        sampling: {
          disposition: "sampled",
          rank: null,
          selectionReason: "exhaustive-prior-pack-drop",
          round: 1,
        },
        samplingRounds: [
          { disposition: "sampled", rank: null, selectionReason: "exhaustive-prior-pack-drop", round: 1 },
        ],
      });
      dropRows.push(row);
    });
  }
  assertEqual(cutRows.length, EXPECTED.cuts, "cut ledger rows");
  assertEqual(dropRows.length, EXPECTED.drops, "prior-pack drop ledger rows");
  return { cutRows, dropRows };
}

function classifyCuts(cutRows, indexes) {
  const needsReview = [];
  const firstExactOccurrence = new Map();
  const findings = [...indexes.findingById.values()];

  for (const row of cutRows) {
    const normalized = normalizeText(row.originalText);
    const firstOccurrence = firstExactOccurrence.get(normalized);
    if (firstOccurrence) {
      row.lineage = "duplicate-occurrence";
      row.lineageMethod = "exact-match";
      row.lineageEvidence = `duplicate of ${firstOccurrence}`;
      continue;
    }
    firstExactOccurrence.set(normalized, row.sourceItemId);

    if (row.sourceFile === "wave-2/lane-06-topup.json") {
      row.lineage = "superseded-by-later-round";
      row.lineageMethod = "rule";
      row.lineageEvidence = "lane06-round2-revisit-all-13";
      continue;
    }
    if (row.sourceFile.endsWith("-r2.json")) {
      if (/^No promotable candidate was omitted for the soft cap\.?$/i.test(row.originalText)) {
        row.lineage = "meta-disposition";
        row.lineageMethod = "rule";
        row.lineageEvidence = "round2-soft-cap-completeness-marker";
      } else {
        row.lineage = "already-dismissed";
        row.lineageMethod = "rule";
        row.lineageEvidence = "round2-explicit-cut-disposition";
      }
      continue;
    }
    if (/^No additional featureIdeas remain untriaged:/i.test(row.originalText)) {
      row.lineage = "meta-disposition";
      row.lineageMethod = "rule";
      row.lineageEvidence = "feature-idea-completeness-marker";
      continue;
    }
    const coveredMatch = /fully covered by banked (L\d{2}-\d{3})/i.exec(row.originalText);
    if (coveredMatch) {
      row.lineage = "already-promoted";
      row.lineageMethod = "rule";
      row.lineageEvidence = `explicitly covered by ${coveredMatch[1].toUpperCase()}`;
      continue;
    }
    if (/folded into the broader .*finding/i.test(row.originalText)) {
      row.lineage = "already-promoted";
      row.lineageMethod = "rule";
      row.lineageEvidence = "explicitly-folded-into-broader-finding";
      continue;
    }

    const laterFindings = findings.filter(
      (finding) => finding.lane === row.lane && finding.waveRound > row.waveRound,
    );
    const matches = laterFindings
      .map((finding) => {
        const similarity = tokenDice(row.originalText, finding.finding.title);
        return { finding, ...similarity };
      })
      .sort((left, right) => right.score - left.score || compareIds(left.finding.finding.id, right.finding.finding.id));
    const best = matches[0];
    const second = matches[1];
    if (best && normalizeText(row.originalText) === normalizeText(best.finding.finding.title)) {
      const candidate = indexes.candidateByMember.get(best.finding.finding.id).candidate;
      row.lineage = candidate.isStructuredKill ? "already-dismissed" : "already-promoted";
      row.lineageMethod = "exact-match";
      row.lineageEvidence = `${best.finding.finding.id} score=1.000`;
      continue;
    }

    const margin = best ? best.score - (second?.score ?? 0) : 0;
    if (best && best.score >= 0.44 && margin >= 0.15 && best.shared.length >= 2) {
      const candidate = indexes.candidateByMember.get(best.finding.finding.id).candidate;
      row.lineage = candidate.isStructuredKill ? "already-dismissed" : "already-promoted";
      row.lineageMethod = "fuzzy-match";
      row.lineageEvidence = `${best.finding.finding.id} score=${best.score.toFixed(3)} margin=${margin.toFixed(3)} shared=${best.shared.join(",")}`;
      continue;
    }

    if (best && best.score >= 0.3 && best.shared.length >= 2) {
      row.lineage = "eligible";
      row.lineageMethod = "fuzzy-match";
      row.lineageEvidence = `${best.finding.finding.id} score=${best.score.toFixed(3)} below-confidence-threshold`;
      needsReview.push({
        sourceItemId: row.sourceItemId,
        nearMatch: {
          findingId: best.finding.finding.id,
          title: best.finding.finding.title,
          sourceFile: best.finding.sourceFile,
          score: Number(best.score.toFixed(3)),
          nextBestScore: Number((second?.score ?? 0).toFixed(3)),
          sharedTokens: best.shared,
        },
        reason:
          margin < 0.15
            ? "near-match lacks a decisive score margin; lineage remains eligible"
            : "near-match is below the conservative promotion threshold; lineage remains eligible",
      });
      continue;
    }

    row.lineage = "eligible";
    row.lineageMethod = "rule";
    row.lineageEvidence = "no-resolved-lineage-match";
  }
  return needsReview;
}

function rationalePriority(text) {
  if (/soft[- ]cap|cut below .*cap|omitted for .*cap/i.test(text)) {
    return { bucket: 0, label: "explicit-soft-cap-overflow" };
  }
  const rationaleMarkers = /\b(?:because|due to|already|routed|excluded|overlap|covered|lower[- ]value|lacked|despite|while|but|rather than|did not|does not|cannot|remain(?:ed|s)?)\b|[—–;:]/i;
  const words = normalizeText(text).split(" ").filter(Boolean).length;
  if (words < 12 || !rationaleMarkers.test(text)) return { bucket: 1, label: "weak-or-absent-rationale" };
  return { bucket: 2, label: "deterministic-fill" };
}

function samplingComparator(left, right) {
  return (
    left.samplingPriority.bucket - right.samplingPriority.bucket ||
    left.stableRankKey - right.stableRankKey ||
    compareIds(left.sourceItemId, right.sourceItemId)
  );
}

function previousRoundsFor(row, previousLedger, round) {
  if (round === 1) return [];
  const previous = previousLedger.rowsById.get(row.sourceItemId);
  if (!previous) fail(`round ${round}: existing ledger is missing ${row.sourceItemId}`);
  if (previous.sourceClass !== row.sourceClass || previous.originalText !== row.originalText) {
    fail(`round ${round}: source row changed for ${row.sourceItemId}; regenerate round 1 and review the drift`);
  }
  return (previous.samplingRounds ?? []).filter((entry) => entry.round < round);
}

function applySampling(cutRows, previousLedger, round) {
  const eligibleRows = cutRows.filter((row) => row.lineage === "eligible");
  const candidatesByLane = new Map();
  for (const row of eligibleRows) {
    row.samplingRounds = previousRoundsFor(row, previousLedger, round);
    const previouslySampled = row.samplingRounds.find((entry) => entry.disposition === "sampled");
    if (previouslySampled) {
      row.sampling = previouslySampled;
      if (!previousLedger.needsReviewIds.has(row.sourceItemId)) row.lineage = "sampled";
      continue;
    }
    const laneRows = candidatesByLane.get(row.laneNumber) ?? [];
    row.samplingPriority = rationalePriority(row.originalText);
    row.stableRankKey = stableHash(row.sourceItemId);
    laneRows.push(row);
    candidatesByLane.set(row.laneNumber, laneRows);
  }

  const laneBudgets = new Map();
  let unusedCapacity = 0;
  const selected = new Set();
  for (const lane of Object.keys(EXPECTED.cutsByLane).sort()) {
    const rows = (candidatesByLane.get(lane) ?? []).sort(samplingComparator);
    const target = Math.max(4, Math.ceil(0.2 * rows.length));
    const selectionCount = Math.min(target, rows.length);
    laneBudgets.set(lane, { target, selectionCount });
    unusedCapacity += target - selectionCount;
    rows.forEach((row, index) => {
      row.roundRank = index + 1;
      if (index < selectionCount) selected.add(row.sourceItemId);
    });
  }

  if (unusedCapacity > 0) {
    const redistributionPool = [...candidatesByLane.values()]
      .flat()
      .filter((row) => !selected.has(row.sourceItemId))
      .sort(samplingComparator);
    for (const row of redistributionPool.slice(0, unusedCapacity)) selected.add(row.sourceItemId);
  }

  for (const rows of candidatesByLane.values()) {
    for (const row of rows) {
      const isSelected = selected.has(row.sourceItemId);
      const baselineSelected = row.roundRank <= laneBudgets.get(row.laneNumber).selectionCount;
      const sampling = {
        disposition: isSelected ? "sampled" : "not-sampled",
        rank: row.roundRank,
        selectionReason: isSelected
          ? `${baselineSelected ? "per-lane-budget" : "redistributed-unused-capacity"}:${row.samplingPriority.label}`
          : `outside-round-${round}-budget`,
        round,
      };
      row.samplingRounds.push(sampling);
      row.sampling = sampling;
      if (!previousLedger.needsReviewIds.has(row.sourceItemId)) row.lineage = sampling.disposition;
      delete row.samplingPriority;
      delete row.stableRankKey;
      delete row.roundRank;
    }
  }
}

function parseCorpus(repoRoot, workingRoot) {
  const corpusFile = `${workingRoot}/dedup-corpus.md`;
  const text = fs.readFileSync(path.join(repoRoot, corpusFile), "utf8");
  const records = new Map();
  let constraintDefaults = false;
  for (const [index, line] of text.split("\n").entries()) {
    if (line.startsWith("## 3. CONSTRAINTS.md rulings")) constraintDefaults = true;
    if (line.startsWith("## 4. Do-not-reopen")) constraintDefaults = false;
    const id = /^- \*\*(CQ25-\d+)\*\*/.exec(line)?.[1];
    if (!id) continue;

    let anchors = [];
    const parenthesisStarts = [...line.matchAll(/ \(/g)].map((match) => match.index + 1);
    const suffixStart = parenthesisStarts.reverse().find((start) => line.slice(start).includes(".md §"));
    if (suffixStart !== undefined) {
      const suffix = line.slice(suffixStart + 1).replace(/\)\.?$/, "");
      const anchorPattern = /(?:^|; )([^;]+?\.md) § (.*?)(?=; [^;]+?\.md § |$)/g;
      anchors = [...suffix.matchAll(anchorPattern)].map((match) => ({
        sourceDocument: match[1],
        sourceHeading: match[2],
      }));
    } else if (constraintDefaults) {
      anchors = [
        { sourceDocument: "CONSTRAINTS.md", sourceHeading: "Constraints on future proposals" },
      ];
    }
    records.set(id, { id, corpusLine: index + 1, anchors });
  }
  return { corpusFile, records };
}

function splitDocumentGroup(group) {
  const units = [];
  let current = { sourceDocument: group.sourceDocument, entries: [], splitReason: null };
  const flush = () => {
    if (current.entries.length === 0) return;
    units.push(current);
    current = { sourceDocument: group.sourceDocument, entries: [], splitReason: "source-document-exceeds-cap" };
  };
  for (const refGroup of group.refGroups) {
    const claimantSlices = [];
    for (let index = 0; index < refGroup.rows.length; index += MAX_D_CLAIMANTS) {
      claimantSlices.push(refGroup.rows.slice(index, index + MAX_D_CLAIMANTS));
    }
    for (const claimantRows of claimantSlices) {
      const prospectiveRefs = unique([...current.entries.map((entry) => entry.ref), refGroup.ref]);
      const prospectiveClaimants = current.entries.reduce((count, entry) => count + entry.rows.length, 0) + claimantRows.length;
      if (prospectiveRefs.length > MAX_D_REFS || prospectiveClaimants > MAX_D_CLAIMANTS) flush();
      current.entries.push({ ref: refGroup.ref, rows: claimantRows });
      if (claimantSlices.length > 1) current.splitReason = "single-ref-exceeds-claimant-cap";
    }
  }
  flush();
  if (units.length === 1) {
    units[0].splitReason = null;
  } else {
    for (const unit of units) unit.splitReason ??= "source-document-exceeds-cap";
  }
  return units;
}

function buildDGrouping(dropRows, corpus, repoRoot) {
  const unresolved = [];
  const documentMap = new Map();
  for (const row of dropRows) {
    const malformed = !/^CQ25-\d+$/.test(row.cq25Ref);
    const corpusRecord = malformed ? null : corpus.records.get(row.cq25Ref);
    const validAnchors = (corpusRecord?.anchors ?? []).map((anchor) => {
      const livePath = `docs/agent_notes/backlog/code-quality-2026-07-25/${anchor.sourceDocument}`;
      return { ...anchor, livePath, exists: fs.existsSync(path.join(repoRoot, livePath)) };
    });
    row.dGrouping = {
      corpusLine: corpusRecord?.corpusLine ?? null,
      sourceAnchors: validAnchors,
      primarySourceDocument: validAnchors[0]?.sourceDocument ?? null,
      primaryLivePath: validAnchors[0]?.livePath ?? null,
    };
    if (malformed || !corpusRecord || validAnchors.length === 0 || !validAnchors[0].exists) {
      const reason = malformed
        ? "malformed-ref"
        : !corpusRecord
          ? "ref-not-found-in-dedup-corpus"
          : validAnchors.length === 0
            ? "dedup-corpus-record-has-no-resolvable-anchor"
            : "primary-live-source-document-missing";
      unresolved.push({
        sourceItemId: row.sourceItemId,
        ref: row.cq25Ref,
        reason,
        corpusLine: corpusRecord?.corpusLine ?? null,
        sourceAnchors: validAnchors,
      });
      continue;
    }
    const key = validAnchors[0].sourceDocument;
    const documentRows = documentMap.get(key) ?? [];
    documentRows.push(row);
    documentMap.set(key, documentRows);
  }

  const groups = [...documentMap.entries()]
    .sort(([left], [right]) => compareIds(left, right))
    .map(([sourceDocument, rows]) => ({
      sourceDocument,
      refGroups: [...Map.groupBy(rows, (row) => row.cq25Ref).entries()]
        .sort(([left], [right]) => compareIds(left, right))
        .map(([ref, refRows]) => ({ ref, rows: refRows.sort((left, right) => compareIds(left.sourceItemId, right.sourceItemId)) })),
    }));
  const units = groups.flatMap(splitDocumentGroup).sort((left, right) => {
    const leftClaimants = left.entries.reduce((count, entry) => count + entry.rows.length, 0);
    const rightClaimants = right.entries.reduce((count, entry) => count + entry.rows.length, 0);
    return rightClaimants - leftClaimants || right.entries.length - left.entries.length || compareIds(left.sourceDocument, right.sourceDocument);
  });

  const chunks = [];
  for (const unit of units) {
    const unitRefs = unique(unit.entries.map((entry) => entry.ref));
    const unitClaimants = unit.entries.reduce((count, entry) => count + entry.rows.length, 0);
    let chunk = chunks.find(
      (candidate) =>
        unique([...candidate.refs, ...unitRefs]).length <= MAX_D_REFS &&
        candidate.claimantIds.length + unitClaimants <= MAX_D_CLAIMANTS,
    );
    if (!chunk) {
      chunk = { refs: [], claimantIds: [], documents: [] };
      chunks.push(chunk);
    }
    chunk.refs = unique([...chunk.refs, ...unitRefs]).sort(compareIds);
    chunk.claimantIds.push(...unit.entries.flatMap((entry) => entry.rows.map((row) => row.sourceItemId)));
    chunk.claimantIds.sort(compareIds);
    chunk.documents.push({
      sourceDocument: unit.sourceDocument,
      livePath: `docs/agent_notes/backlog/code-quality-2026-07-25/${unit.sourceDocument}`,
      refs: unitRefs,
      claimantCount: unitClaimants,
      splitReason: unit.splitReason,
    });
    chunk.documents.sort((left, right) => compareIds(left.sourceDocument, right.sourceDocument));
  }

  const proposedChunks = chunks.map((chunk, index) => ({
    chunkId: `D-${String(index + 1).padStart(2, "0")}`,
    refCount: chunk.refs.length,
    claimantCount: chunk.claimantIds.length,
    refs: chunk.refs,
    claimantSourceItemIds: chunk.claimantIds,
    documents: chunk.documents,
  }));
  for (const chunk of proposedChunks) {
    if (chunk.refCount > MAX_D_REFS || chunk.claimantCount > MAX_D_CLAIMANTS) {
      fail(`${chunk.chunkId}: D grouping cap exceeded (${chunk.refCount} refs, ${chunk.claimantCount} claimants)`);
    }
  }
  const groupedCount = proposedChunks.reduce((count, chunk) => count + chunk.claimantCount, 0);
  assertEqual(groupedCount + unresolved.length, dropRows.length, "D grouping claimant reconciliation");
  return {
    groupingKey: "primary resolved live source document (first corpus anchor)",
    caps: { refsPerChunk: MAX_D_REFS, claimantsPerChunk: MAX_D_CLAIMANTS },
    proposedChunks,
    unresolved,
  };
}

function loadPreviousLedger(repoRoot, outputFile, round) {
  if (round === 1) return { rowsById: new Map(), needsReviewIds: new Set() };
  if (!fs.existsSync(path.join(repoRoot, outputFile))) fail(`round ${round}: existing ${outputFile} is required`);
  const ledger = readJson(repoRoot, outputFile);
  if (!Number.isSafeInteger(ledger.round) || ledger.round > round) {
    fail(`round ${round}: existing ledger round must be <= ${round}, got ${ledger.round}`);
  }
  return {
    rowsById: new Map(ledger.rows.map((row) => [row.sourceItemId, row])),
    needsReviewIds: new Set((ledger.needsReview ?? []).map((entry) => entry.sourceItemId)),
  };
}

function buildSummary(rows, cutRows, needsReview, dGrouping, round) {
  const perLane = {};
  for (const lane of Object.keys(EXPECTED.cutsByLane).sort()) {
    const laneCuts = cutRows.filter((row) => row.laneNumber === lane);
    const totalEligibleCuts = laneCuts.filter((row) => row.sampling !== null);
    const eligibleCuts = totalEligibleCuts.filter((row) =>
      row.samplingRounds.some((entry) => entry.round === round),
    );
    perLane[lane] = {
      lane: laneCuts[0]?.lane ?? null,
      rawCuts: laneCuts.length,
      eligibleCuts: eligibleCuts.length,
      totalEligibleCuts: totalEligibleCuts.length,
      sampledCutsThisRound: eligibleCuts.filter(
        (row) => row.sampling.disposition === "sampled" && row.sampling.round === round,
      ).length,
      sampledCutsTotal: totalEligibleCuts.filter((row) => row.sampling.disposition === "sampled").length,
      notSampledCuts: totalEligibleCuts.filter((row) => row.sampling.disposition === "not-sampled").length,
      structuredKills: rows.filter((row) => row.sourceClass === "structured-kill" && row.laneNumber === lane).length,
    };
  }
  const lineageHistogram = Object.fromEntries(
    [...LINEAGE_VALUES].map((lineage) => [lineage, rows.filter((row) => row.lineage === lineage).length]),
  );
  return {
    rawTotals: {
      cuts: rows.filter((row) => row.sourceClass === "cut").length,
      structuredKills: rows.filter((row) => row.sourceClass === "structured-kill").length,
      priorPackDrops: rows.filter((row) => row.sourceClass === "prior-pack-drop").length,
      records: rows.length,
    },
    perLane,
    lineageHistogram,
    needsReview: needsReview.length,
    proposedDChunks: dGrouping.proposedChunks.length,
    unresolvedDClaimants: dGrouping.unresolved.length,
  };
}

function assertOutput(rows, cutRows, summary) {
  assertEqual(rows.length, EXPECTED.rawRecords, "ledger row count");
  assertEqual(new Set(rows.map((row) => row.sourceItemId)).size, rows.length, "unique sourceItemId count");
  for (const row of rows) {
    if (!LINEAGE_VALUES.has(row.lineage)) fail(`${row.sourceItemId}: invalid or missing lineage ${row.lineage}`);
    if (!new Set(["rule", "exact-match", "fuzzy-match"]).has(row.lineageMethod)) {
      fail(`${row.sourceItemId}: invalid or missing lineageMethod ${row.lineageMethod}`);
    }
    if (typeof row.lineageEvidence !== "string" || row.lineageEvidence.length === 0) {
      fail(`${row.sourceItemId}: missing lineageEvidence`);
    }
  }
  for (const row of cutRows.filter((candidate) => candidate.sampling !== null)) {
    if (!new Set(["sampled", "not-sampled"]).has(row.sampling.disposition)) {
      fail(`${row.sourceItemId}: eligible cut lacks sampled/not-sampled disposition`);
    }
    if (!Number.isSafeInteger(row.sampling.rank) || row.sampling.rank < 1) {
      fail(`${row.sourceItemId}: eligible cut lacks a positive deterministic rank`);
    }
    if (!Number.isSafeInteger(row.sampling.round) || row.sampling.round < 1 || !row.sampling.selectionReason) {
      fail(`${row.sourceItemId}: eligible cut lacks round or selection reason`);
    }
  }
  assertEqual(summary.rawTotals.cuts, EXPECTED.cuts, "summary cut count");
  assertEqual(summary.rawTotals.structuredKills, EXPECTED.structuredKills, "summary structured kill count");
  assertEqual(summary.rawTotals.priorPackDrops, EXPECTED.drops, "summary prior-pack drop count");
  assertEqual(summary.rawTotals.records, EXPECTED.rawRecords, "summary record count");
}

function printSummary(summary, round) {
  console.log(`source ledger round ${round}`);
  console.log(
    `raw: ${summary.rawTotals.cuts} cuts + ${summary.rawTotals.structuredKills} structured kills + ${summary.rawTotals.priorPackDrops} prior-pack drops = ${summary.rawTotals.records}`,
  );
  console.log("lane  raw-cuts  eligible  sampled-this-round  sampled-total  kills");
  for (const [lane, counts] of Object.entries(summary.perLane)) {
    console.log(
      `${lane.padEnd(4)}  ${String(counts.rawCuts).padStart(8)}  ${String(counts.eligibleCuts).padStart(8)}  ${String(counts.sampledCutsThisRound).padStart(18)}  ${String(counts.sampledCutsTotal).padStart(13)}  ${String(counts.structuredKills).padStart(5)}`,
    );
  }
  console.log(
    `lineage: ${Object.entries(summary.lineageHistogram)
      .map(([lineage, count]) => `${lineage}=${count}`)
      .join(", ")}`,
  );
  console.log(`needsReview: ${summary.needsReview}`);
  console.log(`D chunks: ${summary.proposedDChunks} (${summary.unresolvedDClaimants} unresolved claimants)`);
}

function main() {
  const { round } = parseArguments(process.argv.slice(2));
  const repoRoot = findRepoRoot(process.cwd());
  const workingRoot = "docs/agent_notes/backlog/code-quality-2026-08-01/working";
  const outputFile = `${workingRoot}/phase5/source-ledger.json`;
  const inputs = readInputs(repoRoot, workingRoot);
  assertGroundTruth(inputs, workingRoot);
  const indexes = buildIndexes(inputs, workingRoot);

  const structuredKillRows = buildStructuredKillRows(inputs, indexes);
  const killIds = new Set(structuredKillRows.map((row) => row.candidateId));
  for (const candidateRecord of indexes.candidateById.values()) {
    candidateRecord.candidate.isStructuredKill = killIds.has(candidateRecord.candidate.id);
  }
  const { cutRows, dropRows } = buildCutAndDropRows(inputs);
  const needsReview = classifyCuts(cutRows, indexes);
  const previousLedger = loadPreviousLedger(repoRoot, outputFile, round);
  previousLedger.needsReviewIds = new Set(needsReview.map((entry) => entry.sourceItemId));
  applySampling(cutRows, previousLedger, round);

  const corpus = parseCorpus(repoRoot, workingRoot);
  const dGrouping = buildDGrouping(dropRows, corpus, repoRoot);
  const rows = [...cutRows, ...structuredKillRows, ...dropRows].sort((left, right) => compareIds(left.sourceItemId, right.sourceItemId));
  const summary = buildSummary(rows, cutRows, needsReview, dGrouping, round);
  assertOutput(rows, cutRows, summary);

  const ledger = {
    schemaVersion: 1,
    round,
    generatedBy: `${workingRoot}/phase5/build-source-ledger.mjs`,
    inputs: {
      waveFiles: inputs.waveFiles,
      triageFiles: Object.values(inputs.triageFiles),
      dedupCorpus: corpus.corpusFile,
    },
    samplingPolicy: {
      perLane: "max(4, ceil(0.2 * eligible cuts remaining at the start of the round))",
      redistribution:
        "Unused per-lane capacity is reassigned globally by the same rank, prioritizing explicit soft-cap overflow, then weak/absent rationale, then deterministic fill.",
      rank:
        "Ascending priority bucket, then unsigned FNV-1a(sourceItemId), then sourceItemId; no RNG, clock, or filesystem order is used.",
      needsReview:
        "Ambiguous near-matches retain lineage=eligible while sampling.disposition records sampled/not-sampled; resolve needsReview before dispatch.",
    },
    summary,
    needsReview,
    dGrouping,
    rows,
  };
  fs.writeFileSync(path.join(repoRoot, outputFile), `${JSON.stringify(ledger, null, 2)}\n`);
  printSummary(summary, round);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
