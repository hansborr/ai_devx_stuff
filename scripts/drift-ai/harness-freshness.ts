// Harness inventory freshness sensor. Keeps docs/ai-harness.md and the
// docs/guides inventory aligned without making the report a blocking gate.

import path from "node:path";

import { extractInlineCodeTokens } from "./backtick-paths.js";
import { formatFindingLines } from "./finding-lines.js";
import {
  defaultPathIgnored,
  normalizeConfiguredPath,
  type PathIgnored,
  stripTrailingSlash,
} from "./repo-ignore.js";
import {
  compareStrings,
  defaultDirectoryListing,
  defaultFileReader,
  defaultPathExists,
  type DirectoryListing,
  type PathExists,
  type RepoFileReader,
} from "./repo-io.js";

export type HarnessFreshnessPathKind = "file" | "directory";

type HarnessFreshnessCategory =
  | "missing-harness"
  | "missing-referenced-guide"
  | "stale-backtick-path"
  | "unreferenced-guide";

export type HarnessFreshnessFinding = {
  readonly check: "harness-freshness";
  readonly file: string;
  readonly message: string;
  readonly hint?: string;
  readonly details: {
    readonly category: HarnessFreshnessCategory;
    readonly line?: number;
    readonly path?: string;
  };
};

export type RunHarnessFreshnessCheckOptions = {
  readonly repoRoot?: string;
  readonly harnessPath?: string;
  readonly guidesDir?: string;
  readonly readFile?: RepoFileReader;
  readonly listDirectory?: DirectoryListing;
  readonly pathExists?: PathExists;
  readonly isIgnored?: PathIgnored;
};

type GuideReference = {
  readonly path: string;
  readonly line: number;
};

type BacktickPathReference = {
  readonly path: string;
  readonly kind: HarnessFreshnessPathKind;
  readonly line: number;
};

// Musi-specific defaults. This subcommand intentionally stays outside the
// portable default check surface; callers that need another layout can use the
// existing harnessPath/guidesDir options directly.
const DEFAULT_HARNESS_PATH = "docs/ai-harness.md";
const DEFAULT_GUIDES_DIR = "docs/guides";
const PATH_LIKE_RE = /^[\w.@-]+(?:\/[\w.@-]+)+(?:\/|\.[A-Za-z0-9][\w-]*)$/u;
const GUIDE_REFERENCE_RE = /docs\/guides\/[\w.-]+\.md/gu;

export function runHarnessFreshnessCheck(
  options: RunHarnessFreshnessCheckOptions = {},
): HarnessFreshnessFinding[] {
  const repoRoot = options.repoRoot ?? process.cwd();
  const harnessPath = normalizeConfiguredPath(options.harnessPath ?? DEFAULT_HARNESS_PATH);
  const guidesDir = stripTrailingSlash(
    normalizeConfiguredPath(options.guidesDir ?? DEFAULT_GUIDES_DIR),
  );
  const readFile = options.readFile ?? defaultFileReader(repoRoot);
  const listDirectory = options.listDirectory ?? defaultDirectoryListing(repoRoot);
  const pathExists = options.pathExists ?? defaultPathExists(repoRoot);
  const harness = readFile(harnessPath);
  if (harness === undefined) {
    return [
      {
        check: "harness-freshness",
        file: harnessPath,
        message: "harness inventory file is missing or unreadable",
        hint: "restore docs/ai-harness.md before auditing guide freshness.",
        details: { category: "missing-harness", path: harnessPath },
      },
    ];
  }

  const guidePaths = discoverGuidePaths(guidesDir, listDirectory);
  const guidePathSet = new Set(guidePaths);
  const guideReferences = extractGuideReferences(harness);
  const backtickPaths = extractBacktickPathReferences(harness);
  const isIgnored =
    options.isIgnored ??
    defaultPathIgnored(repoRoot, backtickPathIgnoreCandidates(backtickPaths), "harness-freshness");

  return [
    ...unreferencedGuideFindings(harnessPath, guidePaths, guideReferences),
    ...staleBacktickPathFindings(harnessPath, backtickPaths, pathExists, isIgnored),
    ...missingReferencedGuideFindings(harnessPath, guideReferences, guidePathSet),
  ];
}

function backtickPathIgnoreCandidates(
  backtickPaths: readonly BacktickPathReference[],
): readonly string[] {
  const candidates = new Set<string>();
  for (const reference of backtickPaths) {
    candidates.add(reference.path);
    candidates.add(stripTrailingSlash(reference.path));
  }
  return [...candidates];
}

// harness-freshness IS a trusted findings stream (unlike the hotspots advisory),
// so its JSON stays findings-shaped. Emitted when the subcommand is run with
// --format json (the shared subcommand parser; backlog tasks 40 / 50-M4).
export function formatHarnessFreshnessJson(findings: readonly HarnessFreshnessFinding[]): string {
  return JSON.stringify(
    { check: "harness-freshness", findingCount: findings.length, findings },
    null,
    2,
  );
}

export function formatHarnessFreshnessText(findings: readonly HarnessFreshnessFinding[]): string {
  const lines = ["drift:ai harness-freshness (report-only)"];
  if (findings.length === 0) {
    lines.push("OK: no findings from check: harness-freshness");
    return lines.join("\n");
  }
  for (const finding of findings) {
    lines.push(...formatFindingLines(finding));
  }
  return lines.join("\n");
}

function unreferencedGuideFindings(
  harnessPath: string,
  guidePaths: readonly string[],
  guideReferences: readonly GuideReference[],
): HarnessFreshnessFinding[] {
  const referenced = new Set(guideReferences.map((reference) => reference.path));
  return guidePaths
    .filter((guidePath) => !referenced.has(guidePath))
    .map((guidePath) => ({
      check: "harness-freshness",
      file: guidePath,
      message: `guide is not referenced by ${harnessPath}`,
      hint: `add the guide to ${harnessPath} or remove the stale guide file.`,
      details: {
        category: "unreferenced-guide",
        path: guidePath,
      },
    }));
}

function staleBacktickPathFindings(
  harnessPath: string,
  backtickPaths: readonly BacktickPathReference[],
  pathExists: PathExists,
  isIgnored: PathIgnored,
): HarnessFreshnessFinding[] {
  const findings: HarnessFreshnessFinding[] = [];
  const emitted = new Set<string>();
  for (const reference of backtickPaths) {
    const lookupPath = stripTrailingSlash(reference.path);
    if (isIgnored(lookupPath)) continue;
    if (pathExists(lookupPath, reference.kind)) continue;
    const key = `${reference.line}:${reference.kind}:${reference.path}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    findings.push({
      check: "harness-freshness",
      file: `${harnessPath}:${reference.line}`,
      message: `backtick path ${reference.path} does not resolve to a ${reference.kind}`,
      hint: "update or remove the stale path reference.",
      details: {
        category: "stale-backtick-path",
        line: reference.line,
        path: reference.path,
      },
    });
  }
  return findings;
}

function missingReferencedGuideFindings(
  harnessPath: string,
  guideReferences: readonly GuideReference[],
  guidePathSet: ReadonlySet<string>,
): HarnessFreshnessFinding[] {
  const findings: HarnessFreshnessFinding[] = [];
  const emitted = new Set<string>();
  for (const reference of guideReferences) {
    if (guidePathSet.has(reference.path)) continue;
    const key = `${reference.line}:${reference.path}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    findings.push({
      check: "harness-freshness",
      file: `${harnessPath}:${reference.line}`,
      message: `references missing guide ${reference.path}`,
      hint: `restore the guide file or update ${harnessPath}.`,
      details: {
        category: "missing-referenced-guide",
        line: reference.line,
        path: reference.path,
      },
    });
  }
  return findings;
}

function discoverGuidePaths(guidesDir: string, listDirectory: DirectoryListing): readonly string[] {
  return listDirectory(guidesDir)
    .filter((entry) => entry.endsWith(".md") && !entry.includes("/"))
    .map((entry) => `${guidesDir}/${entry}`)
    .sort(compareStrings);
}

function extractGuideReferences(markdown: string): readonly GuideReference[] {
  const references: GuideReference[] = [];
  for (const [lineIndex, line] of markdown.split("\n").entries()) {
    for (const match of line.matchAll(GUIDE_REFERENCE_RE)) {
      const matchedPath = match[0];
      if (matchedPath.length === 0) continue;
      references.push({ path: matchedPath, line: lineIndex + 1 });
    }
  }
  return references;
}

function extractBacktickPathReferences(markdown: string): readonly BacktickPathReference[] {
  const references: BacktickPathReference[] = [];
  for (const token of extractInlineCodeTokens(markdown)) {
    const pathReference = parseBacktickPath(token.raw);
    if (pathReference === undefined) continue;
    references.push({ ...pathReference, line: token.line });
  }
  return references;
}

function parseBacktickPath(raw: string): Omit<BacktickPathReference, "line"> | undefined {
  if (raw.trim() !== raw) return undefined;
  if (raw.length === 0 || /\s/u.test(raw)) return undefined;
  const normalized = normalizeBacktickPath(raw);
  if (normalized === undefined || !normalized.includes("/")) return undefined;
  if (!PATH_LIKE_RE.test(normalized)) return undefined;
  if (normalized.endsWith("/")) return { path: normalized, kind: "directory" };
  return { path: normalized, kind: "file" };
}

function normalizeBacktickPath(value: string): string | undefined {
  const posixValue = value.replaceAll("\\", "/");
  if (posixValue.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(posixValue)) {
    return undefined;
  }
  const hadTrailingSlash = posixValue.endsWith("/");
  const normalized = path.posix.normalize(posixValue);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return undefined;
  }
  if (hadTrailingSlash && !normalized.endsWith("/")) return `${normalized}/`;
  return normalized;
}
