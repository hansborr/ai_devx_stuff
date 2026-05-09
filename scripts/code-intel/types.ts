import type { Node } from "ts-morph";

export const WORKSPACE_PACKAGE_DIRS = ["packages/shared", "packages/server", "packages/client"];
export const SCRIPT_SOURCE_DIR = "scripts";
export const SCRIPT_FIXTURE_DIR = "scripts/codemods/fixtures";
export const DEF_NAME_NEAR_MATCH_LIMIT = 10;
export const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];

export type Via = "direct" | "re-export" | "dynamic";
export type TestReason = "co-located" | "direct" | "transitive";
export type ProjectFilter = "client" | "server" | "shared";
export type ProjectBucket = ProjectFilter | "scripts";
export type ExportSpace = "type" | "value";
export type OutputFormat = "json" | "text";
export type ResultMetadata = Record<string, boolean | number | string>;
export type HelpTopic = "def" | "dependents" | "exports" | "tests";
export type ProjectBucketSummary = Partial<Record<ProjectBucket, number>>;

export type IntelResult =
  | {
      kind: "definition";
      name: string;
      file: string;
      line: number;
      col: number;
      exportKind: string;
    }
  | { kind: "export"; name: string; exportKind: string }
  | { kind: "dependent"; file: string; depth: number; via: Via }
  | {
      kind: "test";
      file: string;
      reason: TestReason;
      slow: boolean;
      depth?: number;
      via?: Via;
    };

export type DefinitionResult = Extract<IntelResult, { kind: "definition" }>;

export type DefinitionNearMatch = {
  col: number;
  exportKind: string;
  file: string;
  line: number;
  name: string;
};

export type DefinitionNearMatchHint = {
  results: DefinitionNearMatch[];
  total: number;
};

export type WorkspacePackageConfig = {
  exports: unknown;
  name: string;
  packageRoot: string;
};

export type ExportRule = {
  exportPattern: string;
  packageName: string;
  packageRoot: string;
  sourcePatterns: string[];
};

export type AliasRule = {
  sourcePrefix: string;
  targetPrefix: string;
};

export type ResolverOptions = {
  aliases?: AliasRule[];
  fileExists?: (filePath: string) => boolean;
  fileIsFile?: (filePath: string) => boolean;
  packages?: WorkspacePackageConfig[];
};

export type QueryTestsOptions = {
  depth?: number;
  project?: ProjectFilter;
};

export type QueryDependentsOptions = {
  excludeTests?: boolean;
  project?: ProjectFilter;
};

export type CliCommand =
  | { kind: "help"; topic?: HelpTopic }
  | { kind: "def"; location: SourceLocation }
  | { kind: "defName"; name: string }
  | { kind: "exports"; file: string }
  | {
      kind: "dependents";
      depth: number;
      excludeTests: boolean;
      file: string;
      limit?: number;
      project?: ProjectFilter;
    }
  | { kind: "tests"; file: string; depth: number; limit?: number; project?: ProjectFilter };

export type ParsedCli = {
  command: CliCommand;
  format: OutputFormat;
};

export type SourceLocation = {
  col: number;
  file: string;
  line: number;
};

export type ImportEdge = {
  from: string;
  runtime: boolean;
  to: string;
  via: Via;
};

export type ImportGraph = {
  incoming: Map<string, ImportEdge[]>;
};

export type NamedDeclaration = {
  declaration: Node;
  name: string;
};

export type BfsVisit = {
  depth: number;
  file: string;
  via: Via;
};

export type FormatResultsOptions = {
  byProject?: ProjectBucketSummary;
  limit?: number;
  metadata?: ResultMetadata;
  textSuffix?: string;
};

export type ExecutableCliCommand = Exclude<CliCommand, { kind: "help" }>;

export type CodeIntelQueryResult =
  | {
      kind: "results";
      header: string;
      limit?: number;
      metadata?: ResultMetadata;
      projectSummary?: {
        byProject: ProjectBucketSummary;
        filter?: ProjectFilter;
      };
      results: IntelResult[];
    }
  | {
      kind: "definitionNameMiss";
      header: string;
      hint: DefinitionNearMatchHint;
    };

export type JsonRecord = Record<string, unknown>;

export const CLIENT_ALIAS_FALLBACK: AliasRule = {
  sourcePrefix: "@/",
  targetPrefix: "packages/client/src/",
};

export const PROJECT_BUCKETS: ProjectBucket[] = ["client", "server", "shared", "scripts"];
