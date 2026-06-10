import path from "node:path";
import { fileURLToPath } from "node:url";

import { toPosix } from "./path-util.js";

export const DEAD_CODE_CORPUS_LABEL_KINDS = ["true-trap", "candidate", "known-unused"] as const;

export type DeadCodeCorpusLabelKind = (typeof DEAD_CODE_CORPUS_LABEL_KINDS)[number];

export type DeadCodeCorpusSymbolId = string;

export type DeadCodeCorpusLabel = {
  readonly id: DeadCodeCorpusSymbolId;
  readonly path: string;
  readonly symbol: string;
  readonly kind: DeadCodeCorpusLabelKind;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly note?: string;
};

export type DeadCodeCorpusLabels = {
  readonly version: number;
  readonly description: string;
  readonly labels: readonly DeadCodeCorpusLabel[];
};

export type DeadCodeCorpusExportKind =
  | "class"
  | "const"
  | "default"
  | "enum"
  | "function"
  | "interface"
  | "let"
  | "re-export"
  | "type"
  | "var";

export type DeadCodeCorpusSymbol = {
  readonly id: DeadCodeCorpusSymbolId;
  readonly filePath: string;
  readonly symbol: string;
  readonly exportKind: DeadCodeCorpusExportKind;
  readonly startLine: number;
};

export type DeadCodeCorpusValidation = {
  readonly labels: DeadCodeCorpusLabels;
  readonly symbols: readonly DeadCodeCorpusSymbol[];
  readonly unknownSymbolRefs: readonly DeadCodeCorpusSymbolId[];
};

export type DeadCodeCorpusSymbolRef = {
  readonly filePath: string;
  readonly symbol: string;
};

export const DEFAULT_DEAD_CODE_CORPUS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "dead-code-corpus",
);

export function deadCodeCorpusSymbolId(filePath: string, symbol: string): DeadCodeCorpusSymbolId {
  return `${toPosix(filePath)}#${symbol}`;
}
