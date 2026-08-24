import path from "node:path";

import type { ImportSpecifierInfo } from "../lib/codemod-imports.js";
import { fail } from "./errors.js";
import type { ImportGroup } from "./types.js";

function importSpecifierText(specifier: ImportSpecifierInfo, declarationTypeOnly: boolean): string {
  const typePrefix = !declarationTypeOnly && specifier.isTypeOnly ? "type " : "";
  if (specifier.imported === specifier.local) return `${typePrefix}${specifier.local}`;
  return `${typePrefix}${specifier.imported} as ${specifier.local}`;
}

export function groupImportSpecifier(
  groups: Map<string, ImportGroup>,
  source: string,
  declarationTypeOnly: boolean,
  specifier: ImportSpecifierInfo,
): void {
  const key = `named\0${source}\0${String(declarationTypeOnly)}`;
  const current = groups.get(key);
  if (current?.kind === "named") {
    current.specifiers.push(specifier);
    return;
  }
  groups.set(key, {
    kind: "named",
    source,
    declarationTypeOnly,
    specifiers: [specifier],
  });
}

export function groupDefaultImport(
  groups: Map<string, ImportGroup>,
  source: string,
  declarationTypeOnly: boolean,
  local: string,
  filePath: string,
  lineNumber: number,
  root: string,
): void {
  const key = `default\0${source}\0${String(declarationTypeOnly)}`;
  const current = groups.get(key);
  if (current?.kind === "default") {
    if (current.local === local) return;
    fail(
      `${path.relative(root, filePath)}:${String(
        lineNumber,
      )} default export from ${source} would need multiple local names.`,
    );
  }
  groups.set(key, { kind: "default", source, declarationTypeOnly, local });
}

export function groupNamespaceImport(
  groups: Map<string, ImportGroup>,
  source: string,
  declarationTypeOnly: boolean,
  local: string,
): void {
  const key = `namespace\0${source}\0${String(declarationTypeOnly)}\0${local}`;
  if (groups.has(key)) return;
  groups.set(key, { kind: "namespace", source, declarationTypeOnly, local });
}

function importGroupKindRank(group: ImportGroup): string {
  if (group.kind === "default") return "1";
  if (group.kind === "named") return "2";
  return "3";
}

export function importGroupSortKey(group: ImportGroup): string {
  const kindRank = importGroupKindRank(group);
  const local = group.kind === "named" ? "" : group.local;
  return `${group.source}\0${kindRank}\0${local}`;
}

export function formatImportGroup(group: ImportGroup): string {
  const typePrefix = group.declarationTypeOnly ? "type " : "";
  if (group.kind === "default") {
    return `import ${typePrefix}${group.local} from "${group.source}";`;
  }
  if (group.kind === "namespace") {
    return `import ${typePrefix}* as ${group.local} from "${group.source}";`;
  }
  const specifiers = [...group.specifiers].sort((left, right) => {
    return (
      left.local.localeCompare(right.local, "en") ||
      left.imported.localeCompare(right.imported, "en")
    );
  });
  return `import ${typePrefix}{ ${specifiers
    .map((specifier) => importSpecifierText(specifier, group.declarationTypeOnly))
    .join(", ")} } from "${group.source}";`;
}
