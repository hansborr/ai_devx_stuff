/**
 * Front-matter extraction for backlog notes.
 *
 * Notes carry a small block of `Name: value` lines in their leading header
 * (optionally bold- or blockquote-wrapped). This module pulls that block into a
 * structured shape so the per-file checks and the pack-level index checks read
 * the same `Status:`/`Date:` fields the same way.
 */

export interface MetadataField {
  readonly name: string;
  readonly value: string;
  readonly line: number;
}

export interface NoteMetadata {
  readonly status?: MetadataField;
  readonly date?: MetadataField;
  readonly allFields: readonly MetadataField[];
}

const FRONT_MATTER_SCAN_LINES = 30;
const BOLD_MARKER = "**";
const BOLD_MARKER_LENGTH = BOLD_MARKER.length;
const DATE_FIELD_NAMES = new Set(["date", "created", "updated", "last triaged"]);
const STATUS_FIELD_NAME = "status";
const FIELD_NAME_PATTERN = /^[a-z][a-z -]*$/u;

function normalizeMetadataLine(line: string): string {
  let normalized = line.trim();
  if (normalized.startsWith(">")) normalized = normalized.slice(1).trim();
  return normalized;
}

function stripWrappingBold(value: string): string {
  let stripped = value.trim();
  if (stripped.startsWith(BOLD_MARKER)) {
    stripped = stripped.slice(BOLD_MARKER_LENGTH).trimStart();
  }
  if (stripped.endsWith(BOLD_MARKER)) {
    stripped = stripped.slice(0, -BOLD_MARKER_LENGTH).trimEnd();
  }
  return stripped;
}

function splitMetadataField(
  line: string,
): { readonly name: string; readonly value: string } | undefined {
  let normalized = normalizeMetadataLine(line);
  if (normalized.startsWith(BOLD_MARKER)) {
    normalized = normalized.slice(BOLD_MARKER_LENGTH).trimStart();
  }
  const colonIndex = normalized.indexOf(":");
  if (colonIndex < 0) return undefined;
  const name = normalized.slice(0, colonIndex).trim();
  if (!FIELD_NAME_PATTERN.test(name.toLowerCase())) return undefined;
  let value = normalized.slice(colonIndex + 1).trim();
  if (value.startsWith(BOLD_MARKER)) {
    value = value.slice(BOLD_MARKER_LENGTH).trimStart();
  }
  return { name, value: stripWrappingBold(value) };
}

function isMetadataFieldLine(line: string): boolean {
  return splitMetadataField(line) !== undefined;
}

function continuationValue(lines: readonly string[], startIndex: number): string {
  const parts: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = normalizeMetadataLine(lines[index] ?? "");
    if (trimmed.length === 0 || trimmed.startsWith("#") || isMetadataFieldLine(trimmed)) break;
    parts.push(stripWrappingBold(trimmed));
  }
  return parts.join(" ").trim();
}

function updateKnownFields(
  field: MetadataField,
  known: { status?: MetadataField; date?: MetadataField },
): void {
  if (field.name === STATUS_FIELD_NAME && known.status === undefined) known.status = field;
  if (DATE_FIELD_NAMES.has(field.name) && known.date === undefined) known.date = field;
}

export function extractMetadata(text: string): NoteMetadata {
  const lines = text.split(/\r?\n/u).slice(0, FRONT_MATTER_SCAN_LINES);
  const allFields: MetadataField[] = [];
  const known: { status?: MetadataField; date?: MetadataField } = {};
  for (let index = 0; index < lines.length; index += 1) {
    const split = splitMetadataField(lines[index] ?? "");
    if (split === undefined) continue;
    const directValue = split.value.trim();
    const field = {
      name: split.name.toLowerCase(),
      value: directValue.length > 0 ? directValue : continuationValue(lines, index),
      line: index + 1,
    };
    allFields.push(field);
    updateKnownFields(field, known);
  }
  return { status: known.status, date: known.date, allFields };
}
