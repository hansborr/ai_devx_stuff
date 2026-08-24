// `git blame --line-porcelain` parser for the stale-markers lens. Resolves the
// INTRODUCTION date / author / sha of each line in a file so a marker can be aged.
//
// Cost discipline (same posture as the thrash lens disclosing blame cost): blame is
// expensive, so the lens only calls this for files that ALREADY contain a marker
// (gated behind the cheap in-memory scan), and on a blobless partial clone the lens
// skips blame entirely and discloses that ages are unavailable. This module just
// parses; the cost gate + blobless gate live in the reducer.
//
// The porcelain format emits, per blamed line: a header `<sha> <orig> <final>
// <group-count>`, then (only the first time a commit appears) `author <name>`,
// `author-time <epoch>`, etc., then a tab-prefixed content line. git caches commit
// metadata, so later lines of the same commit emit a SHORT header with no author
// block — we cache the metadata by sha and reuse it, matching git's own behavior.

import { execFileSync } from "node:child_process";

import { type GitRunner } from "./git-changed-scope.js";

// `--line-porcelain` emits a full metadata block per line, so a large file's blame
// easily exceeds Node's 1 MB execFile default — which would throw and silently
// degrade the file to age-unknown. Raise the buffer to match the knip runner's
// generous bound so big files still resolve. cwd anchors the repo-relative pathspec.
const BLAME_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

// `stdio` pipes stderr (rather than inheriting it) so git's expected `fatal:` noise
// for an uncommitted/renamed/unblameable path stays silent — the parser already
// degrades such a file to age-unknown.
export function defaultBlameGitRunner(repoRoot: string): GitRunner {
  return (args) =>
    execFileSync("git", [...args], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: BLAME_MAX_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
    });
}

export type LineIntroduction = {
  readonly sha: string;
  readonly author: string;
  readonly introducedAtMs: number; // author-time epoch in ms; NaN if git omitted it
};

export type BlameLineIntroductionsOptions = {
  readonly git: GitRunner;
  readonly path: string; // repo-relative path to blame
};

// 1-based line number → its introducing commit. Empty when blame fails (uncommitted
// file, unreadable path, or a git error) so the caller degrades to "age unknown".
export function blameLineIntroductions(
  options: BlameLineIntroductionsOptions,
): Map<number, LineIntroduction> {
  const output = runBlame(options);
  if (output === null) return new Map();
  return parsePorcelain(output);
}

function runBlame(options: BlameLineIntroductionsOptions): string | null {
  try {
    // `--` separates flags from the pathspec so a path that looks like a flag is
    // still treated as a path; the runner was anchored when it was constructed.
    return options.git(["blame", "--line-porcelain", "HEAD", "--", options.path]);
  } catch {
    return null;
  }
}

type CommitMeta = { readonly author: string; readonly introducedAtMs: number };

// Parse line-porcelain output line-wise. A header line `<40-hex> <orig> <final>
// [count]` opens a blamed line; the following `author` / `author-time` fields (when
// present) define that commit's metadata, cached by sha for short-header reuse; the
// tab-prefixed content line closes it.
function parsePorcelain(output: string): Map<number, LineIntroduction> {
  const byLine = new Map<number, LineIntroduction>();
  const metaBySha = new Map<string, { author: string; introducedAtMs: number }>();
  let currentSha: string | null = null;
  let currentFinalLine: number | null = null;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const header = parseHeader(line);
    if (header !== null) {
      currentSha = header.sha;
      currentFinalLine = header.finalLine;
      if (!metaBySha.has(header.sha)) {
        metaBySha.set(header.sha, { author: "", introducedAtMs: Number.NaN });
      }
      continue;
    }
    if (currentSha === null) continue;
    applyField(metaBySha.get(currentSha), line);
    if (line.startsWith("\t") && currentFinalLine !== null) {
      const meta = metaBySha.get(currentSha);
      if (meta !== undefined) {
        byLine.set(currentFinalLine, { sha: currentSha, ...metaSnapshot(meta) });
      }
      currentFinalLine = null;
    }
  }
  return byLine;
}

function metaSnapshot(meta: CommitMeta): CommitMeta {
  return { author: meta.author, introducedAtMs: meta.introducedAtMs };
}

// A porcelain header starts with a hex sha followed by space-separated decimal line
// numbers. SHA-1 repos use 40-char IDs; SHA-256 repos use 64-char IDs — accept both
// (and abbreviated/test shas) by matching 6–64 hex chars.
const HEADER_PATTERN = /^([0-9a-f]{6,64}) (\d+) (\d+)(?: \d+)?$/u;

function parseHeader(line: string): { sha: string; finalLine: number } | null {
  const match = HEADER_PATTERN.exec(line);
  if (match === null) return null;
  const sha = match[1] ?? "";
  const finalLine = Number(match[3]);
  if (!Number.isInteger(finalLine)) return null;
  return { sha, finalLine };
}

function applyField(
  meta: { author: string; introducedAtMs: number } | undefined,
  line: string,
): void {
  if (meta === undefined) return;
  if (line.startsWith("author ")) {
    meta.author = line.slice("author ".length).trim();
    return;
  }
  if (line.startsWith("author-time ")) {
    const epoch = Number(line.slice("author-time ".length).trim());
    meta.introducedAtMs = Number.isFinite(epoch) ? epoch * 1000 : Number.NaN;
  }
}
