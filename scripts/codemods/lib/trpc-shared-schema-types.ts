import path from "node:path";

import { type CallExpression, type Node, Project, type VariableStatement } from "ts-morph";

import { SHARED_SCHEMA_PREFIX } from "../../../eslint-rules/shared-schema-prefix.js";

export { SHARED_SCHEMA_PREFIX };

export const ROUTER_ROOT = path.join("packages", "server", "src", "routers");
export const SHARED_SCHEMA_ROOT = path.join("packages", "shared", "src", "schemas");

export type ImportSpecifierInfo = {
  imported: string;
  isTypeOnly?: boolean;
  local: string;
};

export type ImportBinding = ImportSpecifierInfo & {
  targetSource: string;
};

export type TargetIdentifiers = {
  type: Set<string>;
  value: Set<string>;
};

export type WritePlan = {
  path: string;
  text: string;
};

export type SharedSchemaCodemodCandidate = {
  kind: "inline" | "const";
  schemaName: string;
  schemaCall: CallExpression;
  schemaExpression: Node;
  schemaText: string;
  constStatement?: VariableStatement;
};

export type SharedSchemaDiscoveryResult = {
  candidateCount: number;
  error?: string;
  relativeRouterPath: string;
};

export class CodemodError extends Error {
  constructor(codemodName: string, message: string) {
    super(`${codemodName} codemod: ${message}`);
    this.name = "CodemodError";
  }
}

export function fail(codemodName: string, message: string): never {
  throw new CodemodError(codemodName, message);
}

export function assertSafeSchemaIdentifier(codemodName: string, name: string): void {
  if (/^[A-Za-z_$][\w$]*$/u.test(name)) return;
  fail(codemodName, `Could not derive a safe schema name from procedure name ${name}.`);
}

export function createProject(): Project {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: {
      useTrailingCommas: false,
    },
  });
}
