import type { DetectorScope } from "./scope.js";
import { toCurrentScopeFile } from "./scope.js";

export function currentDetectorScope(files: readonly string[]): DetectorScope {
  return { scopeMode: "current", files: files.map(toCurrentScopeFile) };
}
