#!/usr/bin/env node
/**
 * Phase 5 step S0 mechanical extractor (dependency-free ESM; run with `bun <path>` or `node <path>`).
 *
 * Reads the frozen 270 leaves and three PLAN companions, extracts their headers,
 * section-tagged backtick path citations, intra-pack references, companion links,
 * and recorded provenance, then writes `working/phase5/s0-records.json`.
 *
 * `--check` re-derives that file, checks its structural invariants and pinned
 * citation locations, reports frozen-pack citation defects, and exits non-zero
 * only when the generated artifact or a structural invariant is inconsistent.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

const AUDIT_TARGET_SHA = "ebf096580b31f604861fadb3d4cbd4079da4f017";
const EXPECTED_FILE_COUNT = 273;
const EXPECTED_LEAF_COUNT = 270;
const EXPECTED_PLAN_COUNT = 3;

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const phase5Root = join(packRoot, "working", "phase5");
const outputPath = join(phase5Root, "s0-records.json");
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: packRoot,
  encoding: "utf8",
}).trim();
const packRepoPath = relative(repoRoot, packRoot).split("\\").join("/");

const git = (...args) =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const trackedPaths = git("ls-tree", "-r", "--name-only", "--full-tree", AUDIT_TARGET_SHA)
  .split("\n")
  .filter(Boolean)
  .sort();
const trackedPathSet = new Set(trackedPaths);
const trackedDirectories = new Set(
  trackedPaths.flatMap((path) => {
    const parts = path.split("/");
    return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join("/"));
  }),
);
const pinnedLineCounts = new Map();

const packFiles = readdirSync(packRoot)
  .filter((file) => /^\d{3}(?:-PLAN|-[^.]+)\.md$/.test(file))
  .sort();
const packFileSet = new Set(packFiles);
const planFiles = packFiles.filter((file) => /^\d{3}-PLAN\.md$/.test(file));
const leafFiles = packFiles.filter((file) => !/-PLAN\.md$/.test(file));

const sourcePaths = {
  triage: [
    "working/triage/batch1-candidates.json",
    "working/triage/batch1-judgments.json",
    "working/triage/batch1-verify.json",
    "working/triage/batch2-candidates.json",
    "working/triage/batch2-judgments.json",
    "working/triage/batch2-verify.json",
  ],
  promotionMaps: readdirSync(phase5Root)
    .filter((file) => /^promotion-map(?:-r\d+)?\.json$/.test(file))
    .sort((a, b) => {
      const roundOf = (file) => Number(/-r(\d+)/.exec(file)?.[1] ?? 1);
      return roundOf(a) - roundOf(b);
    })
    .map((file) => `working/phase5/${file}`),
};

const readJson = (packRelativePath) =>
  JSON.parse(readFileSync(join(packRoot, packRelativePath), "utf8"));

const triageBatches = sourcePaths.triage
  .filter((sourceFile) => /-candidates\.json$/.test(sourceFile))
  .map((sourceFile) => {
    const json = readJson(sourceFile);
    return {
      batch: json.batch,
      sourceFile,
      clusterNotes: json.clusterNotes,
    };
  });

const promotionOriginsByLeaf = new Map();
for (const mapSource of sourcePaths.promotionMaps) {
  const mapFile = basename(mapSource);
  const round = Number(/-r(\d+)/.exec(mapFile)?.[1] ?? 1);
  const suffix = round === 1 ? "" : `-r${round}`;
  const poolSource = `working/phase5/1c${suffix}/pooled-candidates.json`;
  const promotionMap = readJson(mapSource);
  const pool = readJson(poolSource);
  const candidatesById = new Map(
    pool.candidates.map((candidate) => [candidate.promotionId, candidate]),
  );

  for (const entry of promotionMap.entries) {
    const accepted = candidatesById.get(entry.promotionId);
    if (!accepted) throw new Error(`${mapSource}: missing pooled candidate ${entry.promotionId}`);
    if (!packFileSet.has(entry.leafFile)) {
      throw new Error(`${mapSource}: mapped leaf does not exist: ${entry.leafFile}`);
    }

    const joined = promotionOriginsByLeaf.get(entry.leafFile) ?? [];
    joined.push({
      round,
      promotionId: entry.promotionId,
      disposition: entry.ruling,
      mergedIntoPromotionId: null,
      promotionMapSource: mapSource,
      pooledCandidateSource: poolSource,
      rejectAuditSource: accepted.sourceFile ?? null,
      origins: accepted.origins ?? [],
    });

    for (const mergedId of entry.mergedPromotionIds ?? []) {
      const merged = candidatesById.get(mergedId);
      if (!merged) throw new Error(`${mapSource}: missing merged pooled candidate ${mergedId}`);
      joined.push({
        round,
        promotionId: mergedId,
        disposition: "merge-with-promotion",
        mergedIntoPromotionId: entry.promotionId,
        promotionMapSource: mapSource,
        pooledCandidateSource: poolSource,
        rejectAuditSource: merged.sourceFile ?? null,
        origins: merged.origins ?? [],
      });
    }
    promotionOriginsByLeaf.set(entry.leafFile, joined);
  }
}

const extensionsAtPin = new Set(
  trackedPaths.flatMap((path) => {
    const match = /(?:^|\/)[^/]+(\.[A-Za-z0-9][A-Za-z0-9.-]*)$/.exec(path);
    return match ? [match[1]] : [];
  }),
);
for (const extension of [".md", ".ts", ".tsx", ".js", ".mjs", ".json", ".sh", ".yml", ".yaml"]) {
  extensionsAtPin.add(extension);
}

const pinnedLineCount = (path) => {
  if (!pinnedLineCounts.has(path)) {
    const text = git("show", `${AUDIT_TARGET_SHA}:${path}`);
    const count = text === "" ? 0 : text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
    pinnedLineCounts.set(path, count);
  }
  return pinnedLineCounts.get(path);
};

const materializedLineCount = (path) => {
  const text = readFileSync(join(repoRoot, path), "utf8");
  return text === "" ? 0 : text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
};

const normalizeDisplayedPath = (displayedPath, sourceFile) => {
  let path = displayedPath.replace(/\\/g, "/");
  if (path.startsWith("/workspace/")) return path.slice("/workspace/".length);
  if (path.startsWith("./") || path.startsWith("../")) {
    return posix.normalize(posix.join(packRepoPath, posix.dirname(sourceFile), path));
  }
  return path.replace(/^\//, "");
};

const resolvePinnedPath = (displayedPath, sourceFile) => {
  const normalized = normalizeDisplayedPath(displayedPath, sourceFile);
  const suffix = normalized.replace(/^\.\//, "");
  const suffixCandidates = trackedPaths.filter(
    (path) => path === suffix || path.endsWith(`/${suffix}`),
  );
  const directorySuffix = suffix.replace(/\/$/, "");
  const directoryCandidates = [...trackedDirectories].filter(
    (path) => path === directorySuffix || path.endsWith(`/${directorySuffix}`),
  );
  if (trackedPathSet.has(normalized)) {
    return { resolution: "exact", resolvedPath: normalized, candidates: suffixCandidates };
  }
  if (trackedPaths.some((path) => path.startsWith(`${normalized}/`))) {
    return { resolution: "tree-directory", resolvedPath: normalized, candidates: [normalized] };
  }
  if (existsSync(join(repoRoot, normalized))) {
    return {
      resolution: "materialized-pin-path",
      resolvedPath: normalized,
      candidates: [normalized],
    };
  }
  if (suffixCandidates.length === 1) {
    return {
      resolution: "unique-suffix",
      resolvedPath: suffixCandidates[0],
      candidates: suffixCandidates,
    };
  }
  if (directoryCandidates.length === 1) {
    return {
      resolution: "unique-directory-suffix",
      resolvedPath: directoryCandidates[0],
      candidates: directoryCandidates,
    };
  }
  return {
    resolution:
      suffixCandidates.length || directoryCandidates.length ? "ambiguous-suffix" : "not-found",
    resolvedPath: null,
    candidates: [...suffixCandidates, ...directoryCandidates].sort(),
  };
};

const validateCitation = (citation) => {
  const existsAtPin = citation.resolvedPath !== null;
  const isDirectory = existsAtPin && statSync(join(repoRoot, citation.resolvedPath)).isDirectory();
  const lineCountAtPin =
    existsAtPin && citation.line !== null && !isDirectory
      ? trackedPathSet.has(citation.resolvedPath)
        ? pinnedLineCount(citation.resolvedPath)
        : materializedLineCount(citation.resolvedPath)
      : null;
  let issue = null;
  if (citation.line !== null && (!existsAtPin || isDirectory)) {
    issue =
      citation.resolution === "ambiguous-suffix"
        ? "path is ambiguous at the audit pin"
        : "path does not exist at the audit pin";
  } else if (
    citation.line !== null &&
    (citation.line < 1 || citation.endLine < citation.line || citation.endLine > lineCountAtPin)
  ) {
    issue = `line range ${citation.line}-${citation.endLine} is outside 1-${lineCountAtPin}`;
  }
  return {
    ...citation,
    existsAtPin,
    lineCountAtPin,
    validLocationAtPin: citation.line === null ? null : issue === null,
    issue,
  };
};

const parseCitationSpan = (raw, sourceFile) => {
  if (raw === "" || /^https?:\/\//.test(raw)) return null;
  const location = /^(.*?):(\d+(?:-\d+)?(?:,\s*\d+(?:-\d+)?)*)$/.exec(raw);
  if (/\s/.test(raw) && !location) return null;
  const displayedPath = location ? location[1] : raw;
  if (!displayedPath || /["'`()\[\]$|<>]/.test(displayedPath)) return null;

  const resolved = resolvePinnedPath(displayedPath, sourceFile);
  const recognizedPrefix =
    /^(?:\.{1,2}\/|\/workspace\/|packages\/|scripts\/|docs\/|e2e\/|tools\/|examples\/|eslint-|\.github\/|\.husky\/|\.claude\/|\.codex\/)/.test(
      displayedPath,
    );
  const extension = /([^/]+)(\.[A-Za-z0-9][A-Za-z0-9.-]*)$/.exec(displayedPath)?.[2];
  if (
    resolved.resolution === "not-found" &&
    !recognizedPrefix &&
    !(location && displayedPath.includes("/")) &&
    !(extension && extensionsAtPin.has(extension))
  ) {
    return null;
  }

  const ranges = location
    ? location[2].split(",").map((range) => {
        const [start, end = start] = range.trim().split("-").map(Number);
        return { line: start, endLine: end };
      })
    : [{ line: null, endLine: null }];
  return ranges.map((range, rangeIndex) =>
    validateCitation({
      raw,
      path: displayedPath,
      line: range.line,
      endLine: range.endLine,
      rangeIndex: location ? rangeIndex : null,
      rangeCount: location ? ranges.length : null,
      resolution: resolved.resolution,
      resolvedPath: resolved.resolvedPath,
      resolutionCandidates: resolved.candidates,
    }),
  );
};

const commonDirectorySegments = (left, right) => {
  const a = posix.dirname(left).split("/");
  const b = posix.dirname(right).split("/");
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count;
};

const resolveFromLeafContext = (citations) =>
  citations.map((citation, citationIndex) => {
    if (
      citation.resolution === "exact" &&
      (citation.validLocationAtPin !== false || citation.path.includes("/"))
    ) {
      return citation;
    }
    const candidates = new Set(citation.resolutionCandidates);
    for (const other of citations) {
      if (!other.resolvedPath) continue;
      if (posix.basename(other.resolvedPath) === posix.basename(citation.path))
        candidates.add(other.resolvedPath);
      const materialized = join(repoRoot, other.resolvedPath);
      if (existsSync(materialized) && statSync(materialized).isDirectory()) {
        const nested = posix.join(other.resolvedPath, citation.path);
        if (existsSync(join(repoRoot, nested))) candidates.add(nested);
      }
    }
    if (citation.resolvedPath) candidates.add(citation.resolvedPath);

    const scored = [...candidates]
      .filter(
        (candidate) =>
          existsSync(join(repoRoot, candidate)) &&
          !statSync(join(repoRoot, candidate)).isDirectory(),
      )
      .filter((candidate) => {
        if (citation.line === null) return true;
        const count = trackedPathSet.has(candidate)
          ? pinnedLineCount(candidate)
          : materializedLineCount(candidate);
        return citation.line >= 1 && citation.endLine >= citation.line && citation.endLine <= count;
      })
      .map((candidate) => {
        let score = 0;
        for (let otherIndex = 0; otherIndex < citations.length; otherIndex += 1) {
          if (otherIndex === citationIndex) continue;
          const other = citations[otherIndex];
          if (!other.resolvedPath) continue;
          const distance = Math.abs(other.sourceLine - citation.sourceLine) + 1;
          if (
            candidate === other.resolvedPath &&
            posix.basename(other.resolvedPath) === posix.basename(candidate)
          ) {
            score = Math.max(score, 100_000 / distance);
          }
          const materialized = join(repoRoot, other.resolvedPath);
          if (
            existsSync(materialized) &&
            statSync(materialized).isDirectory() &&
            candidate.startsWith(`${other.resolvedPath}/`)
          ) {
            score = Math.max(score, 100_000 / distance);
          }
          score = Math.max(
            score,
            (commonDirectorySegments(candidate, other.resolvedPath) * 100) / distance,
          );
        }
        return { candidate, score };
      })
      .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate));

    const best = scored[0];
    const runnerUp = scored[1];
    if (!best || best.score === 0 || (runnerUp && runnerUp.score === best.score)) return citation;
    if (citation.resolvedPath === best.candidate && citation.resolution !== "exact")
      return citation;
    return validateCitation({
      ...citation,
      resolution: "leaf-context",
      resolvedPath: best.candidate,
      resolutionCandidates: [...candidates].sort(),
    });
  });

const currentPackTarget = (target, sourceFile) => {
  const withoutFragment = target.split("#")[0].split("?")[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    decoded = withoutFragment;
  }
  const targetBasename = posix.basename(decoded);
  if (!/^\d{3}(?:-PLAN|-[^.]+)\.md$/.test(targetBasename)) return null;
  const normalized = posix.normalize(posix.join(posix.dirname(sourceFile), decoded));
  const isPackLocal = normalized === targetBasename;
  return {
    normalized,
    targetBasename,
    resolved: isPackLocal && packFileSet.has(targetBasename),
  };
};

const extractReferences = (text, sourceFile) => {
  const references = [];
  const lines = text.split("\n");
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const masked = [...line];
    const mask = (start, end) => {
      for (let i = start; i < end; i += 1) masked[i] = " ";
    };

    const linkPattern = /\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^)]*)?\)/g;
    for (const match of line.matchAll(linkPattern)) {
      const target = currentPackTarget(match[2], sourceFile);
      if (target) {
        references.push({
          kind: "markdown-link",
          raw: match[0],
          mentionedNumber: target.targetBasename.slice(0, 3),
          status: target.resolved ? "resolved" : "unresolved",
          targetFile: target.resolved ? target.targetBasename : null,
          linkTarget: match[2],
          sourceLine: index + 1,
        });
      }
      mask(match.index, match.index + match[0].length);
    }

    const codePattern = /`([^`\n]+)`/g;
    for (const match of line.matchAll(codePattern)) {
      const rawPath = match[1].split("#")[0];
      const targetBasename = posix.basename(rawPath);
      if (/^\d{3}(?:-PLAN|-[^.]+)\.md$/.test(targetBasename)) {
        const normalized = posix.normalize(posix.join(posix.dirname(sourceFile), rawPath));
        const resolved = normalized === targetBasename && packFileSet.has(targetBasename);
        references.push({
          kind: "backtick-filename",
          raw: match[0],
          mentionedNumber: targetBasename.slice(0, 3),
          status: resolved ? "resolved" : "unresolved",
          targetFile: resolved ? targetBasename : null,
          linkTarget: null,
          sourceLine: index + 1,
        });
      }
      mask(match.index, match.index + match[0].length);
    }

    const prose = masked.join("");
    const filenamePattern = /(?:\.\/)?(\d{3}(?:-PLAN|-[A-Za-z0-9-]+)\.md)\b/g;
    for (const match of prose.matchAll(filenamePattern)) {
      const targetFile = match[1];
      references.push({
        kind: "prose-filename",
        raw: match[0],
        mentionedNumber: targetFile.slice(0, 3),
        status: packFileSet.has(targetFile) ? "resolved" : "unresolved",
        targetFile: packFileSet.has(targetFile) ? targetFile : null,
        linkTarget: null,
        sourceLine: index + 1,
      });
    }

    const barePattern = /\bleaf(?:ves)?\s+(\d{1,3}(?:\s*(?:,|\/|and|or)\s*\d{1,3})*)/gi;
    for (const match of prose.matchAll(barePattern)) {
      for (const number of match[1].match(/\d{1,3}/g) ?? []) {
        references.push({
          kind: "bare-leaf-prose",
          raw: match[0],
          mentionedNumber: number.padStart(3, "0"),
          status: "ambiguous",
          targetFile: null,
          linkTarget: null,
          sourceLine: index + 1,
        });
      }
    }
  }
  return references;
};

const extractCitations = (text, sourceFile) => {
  const citations = [];
  const lines = text.split("\n");
  let section = "Preamble";
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) section = heading[1].replace(/[*_`]/g, "").trim();

    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const parsed = parseCitationSpan(match[1], sourceFile);
      if (parsed) {
        citations.push(
          ...parsed.map((citation) => ({ ...citation, section, sourceLine: index + 1 })),
        );
      }
    }
  }
  return resolveFromLeafContext(citations);
};

const parseHeader = (lines, prefix) => lines.find((line) => line.startsWith(prefix)) ?? null;

const parseFile = (file) => {
  const text = readFileSync(join(packRoot, file), "utf8");
  const lines = text.split("\n");
  const kind = /-PLAN\.md$/.test(file) ? "plan-companion" : "leaf";
  const number = file.slice(0, 3);
  const titleLine = parseHeader(lines, "# ") ?? "# ?";
  const title = titleLine.replace(/^#\s+(?:\d+|\d{3}-PLAN)\.\s*/, "").trim();
  const themeLine = parseHeader(lines, "Theme:");
  const sourceLine = parseHeader(lines, "Source:");
  const themeMatch = themeLine
    ? /^Theme:\s*(.*?)\s*·\s*Area:\s*(.*?)\s*·\s*Severity:\s*(.*?)\s*·\s*Size:\s*(.*?)\s*$/.exec(
        themeLine,
      )
    : null;
  if (kind === "leaf" && !themeMatch) throw new Error(`${file}: malformed or missing Theme header`);

  const sourceParts = sourceLine
    ? sourceLine
        .replace(/^Source:\s*/, "")
        .split(/\s*·\s*/)
        .map((part) => part.trim())
    : [];
  const confidencePart = sourceParts.find((part) => /^Confidence:\s*/.test(part));
  const parentLeafFile =
    kind === "plan-companion"
      ? (leafFiles.find((leaf) => leaf.startsWith(`${number}-`)) ?? null)
      : null;
  const planCompanionFile =
    kind === "leaf" && packFileSet.has(`${number}-PLAN.md`) ? `${number}-PLAN.md` : null;

  return {
    file,
    kind,
    number,
    leafNumber: Number(number),
    slug: kind === "leaf" ? file.slice(4, -3) : "PLAN",
    title,
    theme: themeMatch?.[1] ?? null,
    area: themeMatch?.[2] ?? null,
    severity: themeMatch?.[3] ?? null,
    size: themeMatch?.[4] ?? null,
    source: sourceLine
      ? {
          raw: sourceLine,
          name: sourceParts[0] ?? null,
          confidence: confidencePart?.replace(/^Confidence:\s*/, "") ?? null,
        }
      : null,
    parentLeafFile,
    planCompanionFile,
    origin: null,
    triageExpectedRelations: null,
    promotionOrigins: promotionOriginsByLeaf.get(file) ?? [],
    citations: extractCitations(text, file),
    intraPackReferences: extractReferences(text, file),
  };
};

const joinGaps = [
  {
    id: "phase4-candidate-to-leaf",
    affectedFiles:
      "Phase-4 leaves 001-203 (except exact later promotion augmentations recorded separately)",
    missingField: "origin",
    reason:
      "The surviving batch candidate, verify, judgment, and direction JSON records candidate/member provenance but no candidate-to-authored-leaf filename mapping. Title similarity and numeric order are not authoritative joins.",
    inspectedSources: sourcePaths.triage,
    representation: "origin is null; exact reject-audit promotions remain in promotionOrigins",
  },
  {
    id: "cluster-notes-to-expected-relations",
    affectedFiles: "all records",
    missingField: "triageExpectedRelations",
    reason:
      "batch1-candidates.json and batch2-candidates.json store clusterNotes as prose. Distilling relation pairs from that prose requires judgment and is not mechanical extraction.",
    representation:
      "triageExpectedRelations is null; clusterNotes are preserved verbatim in triageClusterNotes",
  },
];

const derive = () => ({
  header: {
    schemaVersion: 1,
    step: "S0-mechanical-extraction",
    generator: "working/phase5/build-s0.mjs",
    auditTargetSha: AUDIT_TARGET_SHA,
    fileCount: packFiles.length,
    leafCount: leafFiles.length,
    planCompanionCount: planFiles.length,
    citationValidationBasis:
      "tracked files come from the pinned Git tree; ignored generated/dependency paths are checked in the materialized checkout whose source and lockfile are at the pin",
  },
  sourceFiles: sourcePaths,
  joinGaps,
  triageClusterNotes: triageBatches,
  records: packFiles.map(parseFile),
});

const validateStructure = (artifact) => {
  const errors = [];
  const files = artifact.records.map((record) => record.file);
  const uniqueFiles = new Set(files);
  if (artifact.header.auditTargetSha !== AUDIT_TARGET_SHA)
    errors.push("header auditTargetSha is wrong");
  if (artifact.header.fileCount !== EXPECTED_FILE_COUNT)
    errors.push(
      `header fileCount is ${artifact.header.fileCount}, expected ${EXPECTED_FILE_COUNT}`,
    );
  if (artifact.records.length !== EXPECTED_FILE_COUNT)
    errors.push(`record count is ${artifact.records.length}, expected ${EXPECTED_FILE_COUNT}`);
  if (uniqueFiles.size !== artifact.records.length)
    errors.push("one or more pack files appear more than once");
  for (const file of packFiles)
    if (!uniqueFiles.has(file)) errors.push(`missing pack file record: ${file}`);

  const leaves = artifact.records.filter((record) => record.kind === "leaf");
  const leafNumbers = leaves.map((record) => record.leafNumber);
  if (leaves.length !== EXPECTED_LEAF_COUNT)
    errors.push(`leaf count is ${leaves.length}, expected ${EXPECTED_LEAF_COUNT}`);
  for (let number = 1; number <= EXPECTED_LEAF_COUNT; number += 1) {
    const occurrences = leafNumbers.filter((candidate) => candidate === number).length;
    if (occurrences !== 1)
      errors.push(`leaf number ${String(number).padStart(3, "0")} occurs ${occurrences} times`);
  }

  const plans = artifact.records.filter((record) => record.kind === "plan-companion");
  if (plans.length !== EXPECTED_PLAN_COUNT)
    errors.push(`plan count is ${plans.length}, expected ${EXPECTED_PLAN_COUNT}`);
  for (const record of artifact.records) {
    for (const reference of record.intraPackReferences) {
      if (reference.status === "resolved" && !packFileSet.has(reference.targetFile)) {
        errors.push(
          `${record.file}:${reference.sourceLine}: resolved reference target is absent: ${reference.targetFile}`,
        );
      }
      if (reference.status === "ambiguous" && reference.targetFile !== null) {
        errors.push(
          `${record.file}:${reference.sourceLine}: ambiguous reference claims ${reference.targetFile}`,
        );
      }
    }
  }
  return errors;
};

const summarize = (artifact, errors) => {
  const citations = artifact.records.flatMap((record) =>
    record.citations.map((citation) => ({ file: record.file, ...citation })),
  );
  const located = citations.filter((citation) => citation.line !== null);
  const invalid = located.filter((citation) => !citation.validLocationAtPin);
  const references = artifact.records.flatMap((record) => record.intraPackReferences);
  const promotionRows = artifact.records.flatMap((record) => record.promotionOrigins);
  const promotedLeaves = artifact.records.filter(
    (record) => record.kind === "leaf" && Number(record.number) >= 204,
  ).length;
  const augmentedHosts = artifact.records.filter((record) =>
    record.promotionOrigins.some((origin) => origin.disposition === "augment-existing-leaf"),
  ).length;

  console.log(
    `S0 check: ${artifact.records.length} files (${artifact.header.leafCount} leaves + ${artifact.header.planCompanionCount} plans); ${errors.length} structural error(s)`,
  );
  console.log(
    `citations: ${citations.length} backtick paths, ${located.length} with lines, ${invalid.length} invalid at ${AUDIT_TARGET_SHA.slice(0, 12)}`,
  );
  for (const citation of invalid) {
    console.log(
      `  - ${citation.file}:${citation.sourceLine} [${citation.section}] \`${citation.raw}\` — ${citation.issue}`,
    );
  }
  console.log(
    `references: ${references.filter((ref) => ref.status === "resolved").length} resolved, ${references.filter((ref) => ref.status === "ambiguous").length} ambiguous, ${references.filter((ref) => ref.status === "unresolved").length} unresolved`,
  );
  console.log(
    `promotion provenance: ${promotedLeaves} new leaves, ${augmentedHosts} augmented hosts, ${promotionRows.length} accepted/merged promotion rows`,
  );
  console.log(`join gaps: ${artifact.joinGaps.map((gap) => gap.id).join(", ")}`);
  for (const error of errors) console.error(`  ERROR: ${error}`);
};

const artifact = derive();
const structuralErrors = validateStructure(artifact);

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath)) {
    structuralErrors.unshift("s0-records.json does not exist");
  } else {
    const recorded = JSON.parse(readFileSync(outputPath, "utf8"));
    if (JSON.stringify(recorded) !== JSON.stringify(artifact)) {
      structuralErrors.unshift(
        "s0-records.json is stale or inconsistent with the mechanical derivation",
      );
    }
  }
  summarize(artifact, structuralErrors);
  process.exitCode = structuralErrors.length ? 1 : 0;
} else {
  if (structuralErrors.length) {
    summarize(artifact, structuralErrors);
    process.exitCode = 1;
  } else {
    writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
    summarize(artifact, []);
    console.log(`wrote ${relative(repoRoot, outputPath)}`);
  }
}
