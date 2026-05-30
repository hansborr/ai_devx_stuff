import { execFileSync } from "node:child_process";

import { DEFAULT_DRIFT_AI_CONFIG } from "./config.js";
import { isPathIgnored } from "./config-match.js";
import { DriftAiError } from "./errors.js";
import { type ChangedFile, type ChangedFileStatus } from "./types.js";

export type GitRunner = (args: readonly string[]) => string;

const SHALLOW_OR_BLOBLESS_CHANGED_SCOPE_MESSAGE =
  "drift:ai: changed scope needs full git history; this looks like a shallow/blobless clone. Run `git fetch --unshallow` (or use `--scope current`).";

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
  return isPathIgnored(filePath, ignore);
}

export function filterScope(
  files: readonly ChangedFile[],
  ignore = DEFAULT_DRIFT_AI_CONFIG.ignore,
): ChangedFile[] {
  return files.filter((file) => !isIgnoredPath(file.path, ignore));
}

export function discoverChangedFiles(ref: string, git: GitRunner): ChangedFile[] {
  ensureChangedScopeCanDiff(git);
  const changed = parseNameStatus(runChangedDiff(ref, git));
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

function ensureChangedScopeCanDiff(git: GitRunner): void {
  try {
    if (git(["rev-parse", "--is-shallow-repository"]).trim() === "true") {
      throw new DriftAiError(SHALLOW_OR_BLOBLESS_CHANGED_SCOPE_MESSAGE);
    }
  } catch (err) {
    if (err instanceof DriftAiError) throw err;
    // Older Git versions or unusual repo states may not support this probe.
    // The diff wrapper below is the authoritative fallback.
  }
}

function runChangedDiff(ref: string, git: GitRunner): string {
  try {
    return git(["diff", "--name-status", ref]);
  } catch (err) {
    if (isShallowOrBloblessDiffError(err)) {
      throw new DriftAiError(SHALLOW_OR_BLOBLESS_CHANGED_SCOPE_MESSAGE);
    }
    throw err;
  }
}

function isShallowOrBloblessDiffError(err: unknown): boolean {
  if (hasSignal(err, "SIGSEGV")) return true;
  const text = errorText(err).toLowerCase();
  return [
    "segmentation fault",
    "bad tree object",
    "bad object",
    "missing blob",
    "unable to read tree",
    "unable to read sha1 file",
    "not a tree object",
  ].some((fragment) => text.includes(fragment));
}

function hasSignal(err: unknown, signal: string): boolean {
  return typeof err === "object" && err !== null && "signal" in err && err.signal === signal;
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) parts.push(err.message);
  if (typeof err === "object" && err !== null) {
    appendErrorPayload(parts, "stderr" in err ? err.stderr : undefined);
    appendErrorPayload(parts, "stdout" in err ? err.stdout : undefined);
  }
  return parts.join("\n");
}

function appendErrorPayload(parts: string[], payload: unknown): void {
  if (payload === undefined || payload === null) return;
  if (typeof payload === "string") {
    parts.push(payload);
    return;
  }
  if (payload instanceof Uint8Array) {
    parts.push(Buffer.from(payload).toString("utf8"));
  }
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
