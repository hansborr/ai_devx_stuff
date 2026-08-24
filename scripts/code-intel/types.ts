import type { Node } from "ts-morph";

export const APPLICATION_PACKAGE_DIRS = ["packages/shared", "packages/server", "packages/client"];
export const SCRIPT_SOURCE_DIR = "scripts";
export const SCRIPT_FIXTURE_DIR = "scripts/codemods/fixtures";
export const APPLICATION_SOURCE_ROOTS = APPLICATION_PACKAGE_DIRS.map(
  (packageDir) => `${packageDir}/src`,
);
// Discovery-mode queries search only these roots; package files outside src/
// and other declared Bun workspaces are intentionally excluded (decision
// record: docs/guides/code-intel.md#supported-scope).
export const DISCOVERY_SCOPE_STATEMENT = `Scope: ${APPLICATION_SOURCE_ROOTS.join(", ")}, and ${SCRIPT_SOURCE_DIR}/ (excluding ${SCRIPT_FIXTURE_DIR}/) only; package files outside src/ and other workspaces (tools/*, examples/*) are intentionally out of scope.`;
export const DEF_NAME_NEAR_MATCH_LIMIT = 10;
export const JS_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];
export const HELP_TOPICS = ["def", "dependents", "exports", "overview", "refs", "tests"] as const;

export type Via = "direct" | "re-export" | "dynamic";
type TestReason = "co-located" | "direct" | "transitive";
export type ProjectFilter = "client" | "server" | "shared";
export type ProjectBucket = ProjectFilter | "scripts";
export type ExportSpace = "type" | "value";
export type ReferenceKind = "import" | "type" | "value";
export type OutputFormat = "json" | "text";
export type ResultMetadata = Record<string, boolean | number | string>;
export type HelpTopic = (typeof HELP_TOPICS)[number];
export type OverviewProcedureKind = "mutation" | "query" | "subscription";
export type ProjectBucketSummary = Partial<Record<ProjectBucket, number>>;

export type OverviewResult = {
  authHelper: string;
  broadcasts: string[];
  candidateTests: string[];
  inputSchema: string | null;
  kind: OverviewProcedureKind;
  outputSchema: string | null;
  procedure: string;
  serviceCalls: string[];
};

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
      kind: "reference";
      name: string;
      file: string;
      line: number;
      col: number;
      referenceKind: ReferenceKind;
    }
  | {
      kind: "test";
      file: string;
      reason: TestReason;
      slow: boolean;
      depth?: number;
      via?: Via;
    };

export type DefinitionResult = Extract<IntelResult, { kind: "definition" }>;
export type ExportResult = Extract<IntelResult, { kind: "export" }>;
export type DependentResult = Extract<IntelResult, { kind: "dependent" }>;
export type ReferenceResult = Extract<IntelResult, { kind: "reference" }>;
export type TestResult = Extract<IntelResult, { kind: "test" }>;

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

export type WorkspaceModel = {
  aliases: AliasRule[];
  exportRules: ExportRule[];
  packages: WorkspacePackageConfig[];
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
  | { kind: "overview"; file: string }
  | { kind: "refs"; location: SourceLocation; limit?: number }
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
  commandKind: ExecutableCliCommand["kind"];
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
    }
  | {
      kind: "overview";
      file: string;
      results: OverviewResult[];
    };

export type JsonRecord = Record<string, unknown>;

export const CLIENT_ALIAS_FALLBACK: AliasRule = {
  sourcePrefix: "@/",
  targetPrefix: "packages/client/src/",
};

export const PROJECT_BUCKETS: ProjectBucket[] = ["client", "server", "shared", "scripts"];
