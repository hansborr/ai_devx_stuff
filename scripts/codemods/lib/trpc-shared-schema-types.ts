import path from "node:path";

import { type CallExpression, type Node, type VariableStatement } from "ts-morph";

import { SHARED_SCHEMA_PREFIX } from "../../../eslint-rules/shared-schema-prefix.js";
import { fail } from "./codemod-errors.js";

export { SHARED_SCHEMA_PREFIX };

export const ROUTER_ROOT = path.join("packages", "server", "src", "routers");
export const SHARED_SCHEMA_ROOT = path.join("packages", "shared", "src", "schemas");

export type ImportBinding = {
  imported: string;
  local: string;
  targetSource: string;
};

export type TargetIdentifiers = {
  type: Set<string>;
  value: Set<string>;
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

export function assertSafeSchemaIdentifier(codemodName: string, name: string): void {
  if (/^[A-Za-z_$][\w$]*$/u.test(name)) return;
  fail(codemodName, `Could not derive a safe schema name from procedure name ${name}.`);
}
