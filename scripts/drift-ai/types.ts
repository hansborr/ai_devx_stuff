import type { ScopeFile, ScopeMode } from "./scope.js";

export type DriftCheckId = "duplicates" | "ghost-files" | "comments" | "suppressions";

export const ALL_CHECKS: readonly DriftCheckId[] = [
  "duplicates",
  "ghost-files",
  "comments",
  "suppressions",
];

export type ChangedFileStatus = "added" | "modified" | "renamed" | "copied" | "deleted";

export type ChangedFile = {
  readonly path: string;
  readonly status: ChangedFileStatus;
  readonly previousPath?: string;
};

export type DriftFinding = {
  readonly check: DriftCheckId;
  readonly file: string;
  readonly message: string;
  readonly hint?: string;
  readonly relatedFiles?: readonly string[];
  readonly details?: Readonly<Record<string, string | number | boolean | readonly string[]>>;
};

export type DriftReport = {
  readonly schemaVersion: 1;
  readonly scopeMode: ScopeMode;
  readonly base: string | null;
  readonly resolvedRef: string | null;
  readonly roots: readonly string[];
  readonly configPath: string | null;
  readonly enabledChecks: readonly DriftCheckId[];
  readonly skippedChecks: readonly DriftCheckId[];
  readonly scope: readonly ScopeFile[];
  readonly findings: readonly DriftFinding[];
};

export type DriftFindingChunk = {
  readonly schemaVersion: 1;
  readonly scopeMode: ScopeMode;
  readonly roots: readonly string[];
  readonly enabledChecks: readonly DriftCheckId[];
  readonly totalFindings: number;
  readonly chunkSize: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly check: DriftCheckId;
  readonly findings: readonly DriftFinding[];
};

export type DriftChunkManifestEntry = {
  readonly index: number;
  readonly path: string;
  readonly check: DriftCheckId;
  readonly findingCount: number;
};

export type DriftChunkManifest = {
  readonly schemaVersion: 1;
  readonly scopeMode: ScopeMode;
  readonly roots: readonly string[];
  readonly enabledChecks: readonly DriftCheckId[];
  readonly totalFindings: number;
  readonly chunkSize: number;
  readonly chunks: readonly DriftChunkManifestEntry[];
};

export type CliOptions = {
  readonly scopeMode: ScopeMode;
  readonly base: string;
  readonly baseExplicit: boolean;
  readonly checks: readonly DriftCheckId[];
  readonly format: "text" | "json";
  readonly roots: readonly string[];
  readonly configPath?: string;
  readonly outputPath?: string;
  readonly chunkDir?: string;
  readonly chunkSize?: number;
};

export const DEFAULT_BASE = "main";
export const DEFAULT_SCOPE_MODE: ScopeMode = "changed";
export const DEFAULT_CHUNK_SIZE = 75;

export const DEFAULT_IGNORE_DIR_PREFIXES: readonly string[] = [
  "node_modules/",
  "vendor/",
  "dist/",
  "build/",
  "coverage/",
  ".next/",
  "out/",
  "target/",
  "generated/",
  "reports/",
  "tmp/",
  ".git/",
  ".husky/",
  ".claude/worktrees/",
];

export const DEFAULT_IGNORE_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".pdf",
  ".lock",
];

export const DEFAULT_IGNORE_FILES: readonly string[] = [
  "bun.lock",
  "package-lock.json",
  "yarn.lock",
];
