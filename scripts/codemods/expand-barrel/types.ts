import type { ImportSpecifierInfo } from "../lib/codemod-imports.js";

export type BarrelContext = {
  readonly barrelPath: string;
  readonly relativeBarrelPath: string;
  readonly packageSpecifier?: string;
};

export type CliArgs =
  | { readonly mode: "check" }
  | { readonly mode: "all"; readonly dryRun: boolean }
  | { readonly mode: "single"; readonly context: BarrelContext; readonly dryRun: boolean };

type NewImportGroup = {
  readonly kind: "named";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly specifiers: ImportSpecifierInfo[];
};

type DefaultImportGroup = {
  readonly kind: "default";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly local: string;
};

type NamespaceImportGroup = {
  readonly kind: "namespace";
  readonly source: string;
  readonly declarationTypeOnly: boolean;
  readonly local: string;
};

export type ImportGroup = NewImportGroup | DefaultImportGroup | NamespaceImportGroup;

type NamedExportBinding = {
  readonly kind: "named";
  readonly importedName: string;
  readonly sourcePath: string;
};

type DefaultExportBinding = {
  readonly kind: "default";
  readonly sourcePath: string;
};

type NamespaceExportBinding = {
  readonly kind: "namespace";
  readonly sourcePath: string;
};

type BarrelLocalExportBinding = {
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
