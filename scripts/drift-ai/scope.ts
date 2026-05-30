import type { ChangedFile, ChangedFileStatus } from "./types.js";

export type ScopeMode = "changed" | "current";

export type ChangedScopeFile = {
  readonly scope: "changed";
  readonly path: string;
  readonly status: ChangedFileStatus;
  readonly previousPath?: string;
};

export type CurrentScopeFile = {
  readonly scope: "current";
  readonly path: string;
};

export type ScopeFile = ChangedScopeFile | CurrentScopeFile;

export type DetectorScope = {
  readonly scopeMode: ScopeMode;
  readonly files: readonly ScopeFile[];
};

export const BUILT_IN_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

export function toChangedScopeFile(file: ChangedFile): ChangedScopeFile {
  return {
    scope: "changed",
    path: file.path,
    status: file.status,
    ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
  };
}

export function toCurrentScopeFile(repoRelativePath: string): CurrentScopeFile {
  return {
    scope: "current",
    path: repoRelativePath,
  };
}

export function buildSourceExtensions(additional: readonly string[]): ReadonlySet<string> {
  const extensions = new Set(BUILT_IN_SOURCE_EXTENSIONS);
  for (const extension of additional) {
    const normalized = normalizeSourceExtension(extension);
    if (normalized.length > 1) extensions.add(normalized);
  }
  return extensions;
}

function normalizeSourceExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  if (normalized.length === 0) return "";
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}
