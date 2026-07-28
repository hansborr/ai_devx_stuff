import { readFileSync } from "node:fs";
import path from "node:path";

import { errorMessage } from "../lib/error-message.js";
import { isRecord } from "./config-readers.js";
import {
  DEAD_CODE_CORPUS_LABEL_KINDS,
  type DeadCodeCorpusLabel,
  type DeadCodeCorpusLabelKind,
  type DeadCodeCorpusLabels,
  deadCodeCorpusSymbolId,
  DEFAULT_DEAD_CODE_CORPUS_DIR,
} from "./dead-code-corpus-types.js";
import { DriftAiError } from "./errors.js";
import { toPosix } from "./path-util.js";

export function loadDeadCodeCorpusLabels(
  corpusDir = DEFAULT_DEAD_CODE_CORPUS_DIR,
): DeadCodeCorpusLabels {
  const labelsPath = path.join(corpusDir, "labels.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(labelsPath, "utf8"));
  } catch (err) {
    throw new DriftAiError(
      `dead-code-corpus labels '${labelsPath}' could not be read: ${errorMessage(err)}`,
    );
  }
  if (!isRecord(raw)) throw new DriftAiError("dead-code-corpus labels must be a JSON object.");
  const labels: DeadCodeCorpusLabels = {
    version: readVersion(raw["version"]),
    description: readString(raw["description"], "description"),
    labels: readLabels(raw["labels"], "labels"),
  };
  assertDistinctLabels(labels.labels);
  return labels;
}

function assertDistinctLabels(labels: readonly DeadCodeCorpusLabel[]): void {
  const seen = new Set<string>();
  for (const label of labels) {
    if (seen.has(label.id)) {
      throw new DriftAiError(`dead-code-corpus labels list '${label.id}' more than once.`);
    }
    seen.add(label.id);
  }
}

function readVersion(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new DriftAiError("dead-code-corpus labels 'version' must be a positive integer.");
  }
  return raw;
}

function readLabels(raw: unknown, keyPath: string): DeadCodeCorpusLabel[] {
  if (!Array.isArray(raw)) {
    throw new DriftAiError(`dead-code-corpus labels '${keyPath}' must be an array.`);
  }
  return raw.map((item, index) => readLabel(item, `${keyPath}[${index}]`));
}

function readLabel(raw: unknown, keyPath: string): DeadCodeCorpusLabel {
  if (!isRecord(raw)) {
    throw new DriftAiError(`dead-code-corpus labels '${keyPath}' must be an object.`);
  }
  const filePath = readCorpusPath(raw["path"], `${keyPath}.path`);
  const symbol = readString(raw["symbol"], `${keyPath}.symbol`);
  const id = readString(raw["id"], `${keyPath}.id`);
  const expectedId = deadCodeCorpusSymbolId(filePath, symbol);
  if (id !== expectedId) {
    throw new DriftAiError(`dead-code-corpus labels '${keyPath}.id' must equal '${expectedId}'.`);
  }
  const note = raw["note"];
  return {
    id,
    path: filePath,
    symbol,
    kind: readKind(raw["kind"], `${keyPath}.kind`),
    reason: readString(raw["reason"], `${keyPath}.reason`),
    evidence: readStringArray(raw["evidence"], `${keyPath}.evidence`),
    ...(note === undefined ? {} : { note: readString(note, `${keyPath}.note`) }),
  };
}

function readKind(raw: unknown, keyPath: string): DeadCodeCorpusLabelKind {
  const value = readString(raw, keyPath);
  if (isDeadCodeCorpusLabelKind(value)) return value;
  throw new DriftAiError(
    `dead-code-corpus labels '${keyPath}' must be one of ${DEAD_CODE_CORPUS_LABEL_KINDS.join(
      ", ",
    )}.`,
  );
}

function isDeadCodeCorpusLabelKind(value: string): value is DeadCodeCorpusLabelKind {
  return DEAD_CODE_CORPUS_LABEL_KINDS.some((kind) => kind === value);
}

function readCorpusPath(raw: unknown, keyPath: string): string {
  const value = toPosix(readString(raw, keyPath));
  if (
    path.isAbsolute(value) ||
    value === "." ||
    value.startsWith("../") ||
    value.includes("/../")
  ) {
    throw new DriftAiError(`dead-code-corpus labels '${keyPath}' must be corpus-relative.`);
  }
  return value;
}

function readString(raw: unknown, keyPath: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new DriftAiError(`dead-code-corpus labels '${keyPath}' must be a non-empty string.`);
  }
  return raw;
}

function readStringArray(raw: unknown, keyPath: string): string[] {
  if (!Array.isArray(raw)) {
    throw new DriftAiError(`dead-code-corpus labels '${keyPath}' must be an array.`);
  }
  return raw.map((item, index) => readString(item, `${keyPath}[${index}]`));
}
