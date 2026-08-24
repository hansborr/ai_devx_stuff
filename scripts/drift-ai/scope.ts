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

export type ChangedDetectorScope = {
  readonly scopeMode: "changed";
  readonly files: readonly ChangedScopeFile[];
};

export type CurrentDetectorScope = {
  readonly scopeMode: "current";
  readonly files: readonly CurrentScopeFile[];
};

export type DetectorScope = ChangedDetectorScope | CurrentDetectorScope;

// Source-extension truth lives in the shared taxonomy module
// (scripts/lib/path-taxonomy.ts); these re-exports keep this module the
// import surface for the scope model, so configured additions route through
// one place and flow to every consumer that builds its set here.
export {
  buildScopeSourceExtensions as buildSourceExtensions,
  SCOPE_BUILT_IN_SOURCE_EXTENSIONS as BUILT_IN_SOURCE_EXTENSIONS,
} from "../lib/path-taxonomy.js";

export function toChangedScopeFile(file: ChangedFile): ChangedScopeFile {
  return {
    scope: "changed",
    path: file.path,
    status: file.status,
    ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
  };
}

export function changedFilesFromScope(detectorScope: ChangedDetectorScope): ChangedFile[] {
  return detectorScope.files.map((file) => ({
    path: file.path,
    status: file.status,
    ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
  }));
}

export function toCurrentScopeFile(repoRelativePath: string): CurrentScopeFile {
  return {
    scope: "current",
    path: repoRelativePath,
  };
}
