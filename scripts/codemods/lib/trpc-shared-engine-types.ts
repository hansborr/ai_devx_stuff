import type { Project, SourceFile } from "ts-morph";

import type { ImportBinding, SharedSchemaCodemodCandidate } from "./trpc-shared-schema-types.js";

/**
 * Context passed to a codemod's target-source resolver. Input resolution reads
 * the router AST and on-disk target exports; output resolution only needs the
 * relative router path, so resolvers pick the fields they use.
 */
export type SharedSchemaTargetContext = {
  root: string;
  project: Project;
  relativeRouterPath: string;
  routerFile: SourceFile;
  explicitTargetSource: string | undefined;
};

/**
 * The parts that differ between the input and output shared-schema codemods.
 * Everything else — CLI parsing shape, candidate validation, shared import
 * insertion, export append, and router rewrite structure — is shared by the
 * engine.
 */
export type SharedSchemaCodemodConfig = {
  codemodName: string;
  /** Discovery/report label and the "no router-local <kind> schemas" wording. */
  kind: "input" | "output";
  /** Whether the `--all` sweep mode is offered. */
  supportsAll: boolean;
  usage: {
    single: string;
    check: string;
    all?: string;
  };
  collectCandidates: (sourceFile: SourceFile) => SharedSchemaCodemodCandidate[];
  assertConstSchemaIsOnlyCallReference: (
    candidate: SharedSchemaCodemodCandidate,
    sourceFile: SourceFile,
  ) => void;
  typeNameForSchema: (schemaName: string) => string;
  defaultTargetSource: (routerFile: string) => string;
  resolveTargetSource: (context: SharedSchemaTargetContext) => string;
  /** Router-local bindings to remove after the rewrite (dependency policy). */
  removeLocalNames: (
    candidates: SharedSchemaCodemodCandidate[],
    neededImports: Map<string, ImportBinding>,
  ) => Iterable<string>;
  isImportBindingAllowed?: (binding: ImportBinding, targetSource: string) => boolean;
  /** Input announces when it reuses an existing (non-default) target module. */
  announceSelectedTarget: boolean;
};

export type SharedSchemaCodemodCliArgs =
  | {
      mode: "single";
      routerFile: string;
      targetSource?: string;
      dryRun: boolean;
    }
  | {
      mode: "all";
      dryRun: boolean;
    }
  | {
      mode: "check";
    };

export type SharedSchemaCodemodArgs = string[];
