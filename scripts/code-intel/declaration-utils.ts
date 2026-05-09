import { Node } from "ts-morph";

import type { ExportSpace } from "./types.js";

export function declarationSpace(declaration: Node): ExportSpace {
  if (
    Node.isInterfaceDeclaration(declaration) ||
    Node.isTypeAliasDeclaration(declaration) ||
    Node.isTypeParameterDeclaration(declaration)
  ) {
    return "type";
  }
  return "value";
}
