import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  DEFAULT_DRIFT_AI_CONFIG,
  matchesAnyGlob,
  pathHasAnyPrefix,
  pathHasAnySegment,
} from "./config.js";
import { DriftAiError } from "./errors.js";
import {
  type ChangedFile,
  type ChangedFileStatus,
  DEFAULT_IGNORE_EXTENSIONS,
  DEFAULT_IGNORE_FILES,
} from "./types.js";

export type GitRunner = (args: readonly string[]) => string;

export function defaultGitRunner(): GitRunner {
  return (args) => execFileSync("git", [...args], { encoding: "utf8" });
}

export function resolveRepoRoot(git: GitRunner): string {
  try {
    const out = git(["rev-parse", "--show-toplevel"]).trim();
    if (out.length > 0) return out;
  } catch {
    // Fall through to process.cwd().
  }
  return process.cwd();
}

export function resolveBaseRef(base: string, git: GitRunner): string {
  for (const candidate of [base, `origin/${base}`]) {
    try {
      git(["rev-parse", "--verify", candidate]);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  throw new DriftAiError(
    `drift:ai: neither '${base}' nor 'origin/${base}' exists. Pass --base <ref> with a reachable ref.`,
  );
}

export function resolveMergeBase(ref: string, git: GitRunner): string {
  try {
    const out = git(["merge-base", ref, "HEAD"]).trim();
    if (out.length > 0) return out;
  } catch {
    // Fall through to the explicit drift:ai error below.
  }
  throw new DriftAiError(`drift:ai: could not find a merge base between '${ref}' and HEAD.`);
}

type NameStatusCode = "A" | "C" | "M" | "R" | "D";

export function parseNameStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/u, "");
    if (line.length === 0) continue;
    const [statusField, first, second] = line.split("\t");
    const code = nameStatusCode(statusField);
    if (code === undefined || first === undefined || first.length === 0) continue;
    const status = mapStatus(code);
    if (second) {
      files.push({ path: second, status, previousPath: first });
    } else {
      files.push({ path: first, status });
    }
  }
  return files;
}

function nameStatusCode(statusField: string | undefined): NameStatusCode | undefined {
  const code = statusField?.[0];
  if (code === "A" || code === "C" || code === "M" || code === "R" || code === "D") return code;
  return undefined;
}

function mapStatus(code: NameStatusCode): ChangedFileStatus {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "D":
      return "deleted";
  }
}

export function isIgnoredPath(filePath: string, ignore = DEFAULT_DRIFT_AI_CONFIG.ignore): boolean {
  const normalized = filePath.split(path.sep).join("/");
  const ignoredSegments = new Set(ignore.segments);
  if (pathHasAnySegment(normalized, ignoredSegments)) return true;
  if (pathHasAnyPrefix(normalized, ignore.prefixes)) return true;
  if (matchesAnyGlob(normalized, ignore.globs)) return true;
  if (DEFAULT_IGNORE_FILES.includes(path.basename(normalized))) return true;
  const ext = path.extname(normalized).toLowerCase();
  if (DEFAULT_IGNORE_EXTENSIONS.includes(ext)) return true;
  return false;
}

export function filterScope(
  files: readonly ChangedFile[],
  ignore = DEFAULT_DRIFT_AI_CONFIG.ignore,
): ChangedFile[] {
  return files.filter((file) => !isIgnoredPath(file.path, ignore));
}

export function discoverChangedFiles(ref: string, git: GitRunner): ChangedFile[] {
  const changed = parseNameStatus(git(["diff", "--name-status", ref]));
  const untracked = parseUntrackedFiles(git(["ls-files", "--others", "--exclude-standard"]));
  const merged = new Map<string, ChangedFile>();
  for (const file of changed) {
    merged.set(file.path, file);
  }
  for (const file of untracked) {
    if (!merged.has(file.path)) merged.set(file.path, file);
  }
  return [...merged.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

function parseUntrackedFiles(output: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const raw of output.split("\n")) {
    const filePath = raw.replace(/\r$/u, "");
    if (filePath.length === 0) continue;
    files.push({ path: filePath, status: "added" });
  }
  return files;
}
