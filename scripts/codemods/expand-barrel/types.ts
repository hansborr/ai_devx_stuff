import type { ImportSpecifierInfo } from "../lib/trpc-shared-schema.js";

export type BarrelContext = {
  readonly barrelPath: string;
  readonly relativeBarrelPath: string;
  readonly packageSpecifier?: string;
};

export type CliArgs =
  | { readonly mode: "check" }
  | { readonly mode: "all"; readonly dryRun: boolean }
  | { readonly mode: "single"; readonly context: BarrelContext; readonly dryRun: boolean };

export type NewImportGroup = {
  readonly kind: "named";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly specifiers: ImportSpecifierInfo[];
};

export type DefaultImportGroup = {
  readonly kind: "default";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly local: string;
};

export type NamespaceImportGroup = {
  readonly kind: "namespace";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly local: string;
};

export type ImportGroup = NewImportGroup | DefaultImportGroup | NamespaceImportGroup;

export type NamedExportBinding = {
  readonly kind: "named";
  readonly importedName: string;
  readonly sourcePath: string;
};

export type DefaultExportBinding = {
  readonly kind: "default";
  readonly sourcePath: string;
};

export type NamespaceExportBinding = {
  readonly kind: "namespace";
  readonly sourcePath: string;
};

export type BarrelLocalExportBinding = {
  readonly kind: "barrel-local";
  readonly exportedName: string;
};

export type DirectExportBinding =
  | NamedExportBinding
  | DefaultExportBinding
  | NamespaceExportBinding;
export type ExportBinding = DirectExportBinding | BarrelLocalExportBinding;
export type ExportMap = Map<string, ExportBinding>;

export type ImportReplacement = {
  readonly text: string;
  readonly directSources: readonly string[];
};

export type MockCallInfo = {
  readonly framework: "jest" | "vi";
  readonly method: "importActual" | "mock";
};

export type ExpandBarrelCodemodArgs = string[];
