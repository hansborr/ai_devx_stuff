import type { Project } from "ts-morph";

import { declarationSpace } from "./declaration-utils.js";
import { getProjectSourceFile } from "./source-project.js";
import type { IntelResult } from "./types.js";
import type { WorkspaceResolver } from "./workspace-resolver.js";

export function queryExports(
  project: Project,
  resolver: WorkspaceResolver,
  file: string,
): IntelResult[] {
  const sourceFile = getProjectSourceFile(project, resolver.mapFileToSource(file));
  const sourceRelative = resolver.relative(sourceFile.getFilePath());
  const exported = sourceFile.getExportedDeclarations();
  const results: IntelResult[] = [];

  for (const [name, declarations] of exported) {
    const declaration = declarations[0];
    if (!declaration) continue;
    const declarationFile = resolver.relative(declaration.getSourceFile().getFilePath());
    const reexportText = declarationFile === sourceRelative ? "export" : "re-export";
    results.push({
      kind: "export",
      name,
      exportKind: `${declarationSpace(declaration)} ${reexportText}`,
    });
  }

  return results.sort(compareNamedResults);
}

function compareNamedResults(left: IntelResult, right: IntelResult): number {
  const leftName = "name" in left ? left.name : "";
  const rightName = "name" in right ? right.name : "";
  return leftName.localeCompare(rightName, "en");
}
