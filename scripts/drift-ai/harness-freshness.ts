// Harness inventory freshness sensor. Keeps docs/ai-harness.md and the
// docs/guides inventory aligned without making the report a blocking gate.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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

type RepoFileReader = (filePath: string) => string | undefined;
type DirectoryListing = (directory: string) => readonly string[];
export type PathExists = (repoRelativePath: string, kind: HarnessFreshnessPathKind) => boolean;
type PathIgnored = (repoRelativePath: string) => boolean;

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

const DEFAULT_HARNESS_PATH = "docs/ai-harness.md";
const DEFAULT_GUIDES_DIR = "docs/guides";
const PATH_LIKE_RE =
  /^[A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)+(?:\/|\.[A-Za-z0-9][A-Za-z0-9_-]*)$/u;
const GUIDE_REFERENCE_RE = /docs\/guides\/[A-Za-z0-9._-]+\.md/gu;
const INLINE_BACKTICK_RE = /`([^`\n]+)`/gu;

export function runHarnessFreshnessCheck(
  options: RunHarnessFreshnessCheckOptions = {},
): HarnessFreshnessFinding[] {
  const repoRoot = options.repoRoot ?? process.cwd();
  const harnessPath = normalizeConfiguredPath(options.harnessPath ?? DEFAULT_HARNESS_PATH);
  const guidesDir = stripTrailingSlash(normalizeConfiguredPath(options.guidesDir ?? DEFAULT_GUIDES_DIR));
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
    defaultPathIgnored(repoRoot, backtickPathIgnoreCandidates(backtickPaths));

  return [
    ...unreferencedGuideFindings(harnessPath, guidePaths, guideReferences),
    ...staleBacktickPathFindings(harnessPath, backtickPaths, pathExists, isIgnored),
    ...missingReferencedGuideFindings(harnessPath, guideReferences, guidePathSet),
  ];
}

export function formatHarnessFreshnessText(findings: readonly HarnessFreshnessFinding[]): string {
  const lines = ["drift:ai harness-freshness (report-only)"];
  if (findings.length === 0) {
    lines.push("OK: no findings from check: harness-freshness");
    return lines.join("\n");
  }
  for (const finding of findings) {
    lines.push(`WARN harness-freshness: ${finding.file} — ${finding.message}`);
    if (finding.hint) lines.push(`  FIX: ${finding.hint}`);
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

function discoverGuidePaths(
  guidesDir: string,
  listDirectory: DirectoryListing,
): readonly string[] {
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
  let inFence = false;
  for (const [lineIndex, line] of markdown.split("\n").entries()) {
    if (/^ {0,3}```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const match of line.matchAll(INLINE_BACKTICK_RE)) {
      const raw = match[1];
      if (raw === undefined) continue;
      const pathReference = parseBacktickPath(raw);
      if (pathReference === undefined) continue;
      references.push({ ...pathReference, line: lineIndex + 1 });
    }
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

function normalizeConfiguredPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function defaultFileReader(repoRoot: string): RepoFileReader {
  const root = path.resolve(repoRoot);
  return (filePath) => {
    const target = safeRepoPath(root, filePath);
    if (target === undefined) return undefined;
    try {
      return readFileSync(target, "utf8");
    } catch {
      return undefined;
    }
  };
}

function defaultDirectoryListing(repoRoot: string): DirectoryListing {
  const root = path.resolve(repoRoot);
  return (directory) => {
    const target = safeRepoPath(root, directory);
    if (target === undefined) return [];
    try {
      return readdirSync(target, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort(compareStrings);
    } catch {
      return [];
    }
  };
}

function defaultPathExists(repoRoot: string): PathExists {
  const root = path.resolve(repoRoot);
  return (repoRelativePath, kind) => {
    const target = safeRepoPath(root, stripTrailingSlash(repoRelativePath));
    if (target === undefined) return false;
    try {
      const stat = statSync(target);
      return kind === "file" ? stat.isFile() : stat.isDirectory();
    } catch {
      return false;
    }
  };
}

function defaultPathIgnored(repoRoot: string, candidatePaths: readonly string[]): PathIgnored {
  const root = path.resolve(repoRoot);
  const candidates = [...new Set(candidatePaths)].sort(compareStrings);
  if (candidates.length === 0) return () => false;
  const result = spawnSync("git", ["check-ignore", "--stdin", "-v"], {
    cwd: root,
    encoding: "utf8",
    input: `${candidates.join("\n")}\n`,
  });
  if (result.error !== undefined) {
    throw new Error(`harness-freshness could not run git check-ignore: ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    const detail = result.stderr.trim();
    throw new Error(
      [
        "harness-freshness git check-ignore failed",
        detail.length === 0 ? undefined : detail,
      ]
        .filter((line) => line !== undefined)
        .join(": "),
    );
  }
  const ignoredPaths = parseIgnoredPaths(result.stdout);
  return (repoRelativePath) => ignoredPaths.has(stripTrailingSlash(repoRelativePath));
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

function parseIgnoredPaths(output: string): ReadonlySet<string> {
  const ignoredPaths = new Set<string>();
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const pathSeparatorIndex = line.lastIndexOf("\t");
    if (pathSeparatorIndex < 0) continue;
    const ignoredPath = normalizeConfiguredPath(line.slice(pathSeparatorIndex + 1));
    ignoredPaths.add(ignoredPath);
    ignoredPaths.add(stripTrailingSlash(ignoredPath));
  }
  return ignoredPaths;
}

function safeRepoPath(root: string, repoRelativePath: string): string | undefined {
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const target = path.resolve(root, repoRelativePath);
  if (target !== root && !target.startsWith(rootWithSep)) return undefined;
  return target;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, "en");
}
