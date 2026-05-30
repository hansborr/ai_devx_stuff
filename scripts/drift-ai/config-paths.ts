import path from "node:path";

import { DriftAiError } from "./errors.js";
import { toPosix } from "./path-util.js";

export function normalizeRepoPath(value: string): string {
  return toPosix(value);
}

export function collapseRepoPath(value: string): string {
  const normalized = normalizeRepoPath(value.replace(/\\/gu, "/"));
  if (normalized.length === 0) return ".";
  return path.posix.normalize(normalized);
}

export function pathEscapesRepo(value: string): boolean {
  return value === ".." || value.startsWith("../") || value.startsWith("/");
}

export function normalizeRoot(value: string): string {
  const collapsed = collapseRepoPath(value);
  if (pathEscapesRepo(collapsed)) {
    throw new DriftAiError(`drift:ai config root '${value}' must stay inside the repo.`);
  }
  return collapsed;
}

export function normalizeSegment(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new DriftAiError(`drift:ai config ignore segment '${value}' must be one path segment.`);
  }
  return trimmed;
}

export function normalizePrefix(value: string): string {
  let normalized = value.split(path.sep).join("/").trim();
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  if (normalized.length === 0) {
    throw new DriftAiError("drift:ai config ignore prefixes must not be empty.");
  }
  return normalized;
}

export function normalizeGlob(value: string): string {
  const normalized = value.split(path.sep).join("/").trim();
  if (normalized.length === 0) {
    throw new DriftAiError("drift:ai config globs must not be empty.");
  }
  return normalized;
}

export function normalizePairPath(value: string, keyPath: string): string {
  const collapsed = collapseRepoPath(value);
  if (pathEscapesRepo(collapsed)) {
    throw new DriftAiError(`drift:ai config '${keyPath}' must stay inside the repo.`);
  }
  return collapsed;
}

export function normalizeExtension(value: string, keyPath: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length <= 1 ||
    !normalized.startsWith(".") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  ) {
    throw new DriftAiError(
      `drift:ai config '${keyPath}' entries must be extensions with a leading dot.`,
    );
  }
  return normalized;
}
