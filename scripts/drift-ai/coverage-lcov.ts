// lcov (`.info`) coverage-report parser. lcov is a line-oriented text format: a
// run of records terminated by `end_of_record`, one such run per source file.
// We parse the records relevant to "was this executed?" evidence: SF (source
// file), FN/FNDA (function declarations and hit counts), DA (per-line hits), and
// the LF/LH/FNF/FNH summary counts, and record every malformed or out-of-order
// record as a note instead of throwing, so a partly-corrupt artifact still
// yields the evidence it does contain. Branch records (BRDA/BRF/BRH) are valid
// lcov but out of scope here, so they are skipped silently. TN (test name) is
// ignored. Output ordering is deterministic: files by path, functions by line
// then name, lines by line number; notes stay in encounter order.

import {
  malformed,
  missingEor,
  toInteger,
  toNonNegativeInt,
  toPositiveInt,
  truncate,
} from "./coverage-lcov-values.js";
import type {
  CoverageFileEvidence,
  CoverageFunctionEvidence,
  CoverageLineEvidence,
  CoverageParseNote,
  ParsedLcov,
} from "./coverage-types.js";
import { toPosix } from "./path-util.js";

type FunctionDecl = { readonly name: string; readonly line: number; readonly endLine?: number };

type Section = {
  file: string;
  readonly fnDecls: FunctionDecl[];
  readonly fnHits: Map<string, number>;
  readonly lines: Map<number, number>;
  linesFound: number | null;
  linesHit: number | null;
  functionsFound: number | null;
  functionsHit: number | null;
};

type ParseState = {
  readonly files: CoverageFileEvidence[];
  readonly notes: CoverageParseNote[];
  section: Section | null;
};

// Records that are valid lcov but carry no evidence we keep (test name, branch
// coverage), so they are skipped without a note.
const IGNORED_KEYS: ReadonlySet<string> = new Set(["TN", "BRDA", "BRF", "BRH"]);
// Summary-count records, dispatched together because they share parsing.
const COUNT_KEYS: ReadonlySet<string> = new Set(["FNF", "FNH", "LF", "LH"]);

export function parseLcov(content: string): ParsedLcov {
  const state: ParseState = { files: [], notes: [], section: null };
  let lineNo = 0;
  for (const rawLine of content.split("\n")) {
    lineNo += 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) continue;
    handleLine(state, line, lineNo);
  }
  if (state.section !== null) {
    state.notes.push(missingEor(state.section.file));
    finalizeSection(state.section, state.files, state.notes);
    state.section = null;
  }
  state.files.sort((left, right) => left.file.localeCompare(right.file, "en"));
  return { files: state.files, notes: state.notes };
}

function handleLine(state: ParseState, line: string, lineNo: number): void {
  if (line === "end_of_record") {
    handleEndOfRecord(state, lineNo);
    return;
  }
  const sep = line.indexOf(":");
  if (sep < 0) {
    state.notes.push(malformed(lineNo, `unrecognized lcov line '${truncate(line)}'`));
    return;
  }
  const key = line.slice(0, sep);
  const value = line.slice(sep + 1);
  if (IGNORED_KEYS.has(key)) return;
  if (key === "SF") {
    handleSf(state, value, lineNo);
    return;
  }
  if (state.section === null) {
    state.notes.push(malformed(lineNo, `${key} record before any source file (SF)`));
    return;
  }
  applyRecord(state.section, key, value, lineNo, state.notes);
}

function handleEndOfRecord(state: ParseState, lineNo: number): void {
  if (state.section === null) {
    state.notes.push(malformed(lineNo, "end_of_record with no open source-file (SF) record"));
    return;
  }
  finalizeSection(state.section, state.files, state.notes);
  state.section = null;
}

function handleSf(state: ParseState, value: string, lineNo: number): void {
  if (state.section !== null) {
    // A new SF without an intervening end_of_record: finalize the prior section
    // so its evidence is not lost, but disclose the missing terminator.
    state.notes.push(missingEor(state.section.file));
    finalizeSection(state.section, state.files, state.notes);
  }
  const file = toPosix(value.trim());
  if (file.length === 0) {
    state.notes.push(malformed(lineNo, "SF record has an empty source path"));
    state.section = null;
    return;
  }
  state.section = newSection(file);
}

function applyRecord(
  section: Section,
  key: string,
  value: string,
  lineNo: number,
  notes: CoverageParseNote[],
): void {
  if (key === "FN") {
    applyFn(section, value, lineNo, notes);
    return;
  }
  if (key === "FNDA") {
    applyFnda(section, value, lineNo, notes);
    return;
  }
  if (key === "DA") {
    applyDa(section, value, lineNo, notes);
    return;
  }
  if (COUNT_KEYS.has(key)) {
    applyCount(section, key, value, lineNo, notes);
    return;
  }
  notes.push(malformed(lineNo, `unrecognized lcov record '${key}'`));
}

// FN is `FN:<start>,<name>` or, in newer lcov, `FN:<start>,<end>,<name>`. Detect
// the three-field form by an integer second field; otherwise treat everything
// after the start line as the (possibly comma-bearing) name.
function applyFn(
  section: Section,
  value: string,
  lineNo: number,
  notes: CoverageParseNote[],
): void {
  const decl = parseFunctionDecl(value, lineNo, notes);
  if (decl === null) return;
  if (section.fnDecls.some((existing) => existing.name === decl.name)) {
    notes.push(
      malformed(
        lineNo,
        `duplicate FN record for function '${decl.name}' in '${section.file}'; FNDA hit counts are name-based and applied to each declaration`,
      ),
    );
  }
  section.fnDecls.push(decl);
}

function parseFunctionDecl(
  value: string,
  lineNo: number,
  notes: CoverageParseNote[],
): FunctionDecl | null {
  const parts = value.split(",");
  const start = toPositiveInt(parts[0]);
  if (start === null || parts.length < 2) {
    notes.push(malformed(lineNo, `FN record has a malformed line/name '${truncate(value)}'`));
    return null;
  }
  const second = parts[1] ?? "";
  const hasEnd = parts.length >= 3 && toInteger(second) !== null;
  const name = (hasEnd ? parts.slice(2) : parts.slice(1)).join(",").trim();
  if (name.length === 0) {
    notes.push(malformed(lineNo, `FN record has an empty function name '${truncate(value)}'`));
    return null;
  }
  const end = readFunctionEnd(second, hasEnd, start, value, lineNo, notes);
  if (end === null) return null;
  return end === undefined ? { name, line: start } : { name, line: start, endLine: end };
}

function readFunctionEnd(
  value: string,
  hasEnd: boolean,
  start: number,
  rawRecord: string,
  lineNo: number,
  notes: CoverageParseNote[],
): number | null | undefined {
  if (!hasEnd) return undefined;
  const end = toPositiveInt(value);
  if (end === null) {
    notes.push(malformed(lineNo, `FN record has a malformed line/name '${truncate(rawRecord)}'`));
    return null;
  }
  if (end < start) {
    notes.push(
      malformed(lineNo, `FN record end line precedes start line '${truncate(rawRecord)}'`),
    );
    return null;
  }
  return end;
}

// FNDA is `FNDA:<hits>,<name>`.
function applyFnda(
  section: Section,
  value: string,
  lineNo: number,
  notes: CoverageParseNote[],
): void {
  const comma = value.indexOf(",");
  const hits = comma < 0 ? null : toNonNegativeInt(value.slice(0, comma));
  const name = comma < 0 ? "" : value.slice(comma + 1).trim();
  if (hits === null || name.length === 0) {
    notes.push(malformed(lineNo, `FNDA record has a malformed hits/name '${truncate(value)}'`));
    return;
  }
  section.fnHits.set(name, hits);
}

// DA is `DA:<line>,<hits>[,<checksum>]`; the optional checksum is ignored.
function applyDa(
  section: Section,
  value: string,
  lineNo: number,
  notes: CoverageParseNote[],
): void {
  const parts = value.split(",");
  const line = toPositiveInt(parts[0]);
  const hits = toNonNegativeInt(parts[1]);
  if (line === null || hits === null) {
    notes.push(malformed(lineNo, `DA record has a malformed line/hits '${truncate(value)}'`));
    return;
  }
  section.lines.set(line, hits);
}

function applyCount(
  section: Section,
  key: string,
  value: string,
  lineNo: number,
  notes: CoverageParseNote[],
): void {
  const count = readCount(value, lineNo, notes, key);
  if (count === null) return;
  if (key === "FNF") section.functionsFound = count;
  else if (key === "FNH") section.functionsHit = count;
  else if (key === "LF") section.linesFound = count;
  else section.linesHit = count;
}

function finalizeSection(
  section: Section,
  files: CoverageFileEvidence[],
  notes: CoverageParseNote[],
): void {
  const functions = buildFunctions(section, notes);
  const lines: CoverageLineEvidence[] = [...section.lines.entries()]
    .map(([line, hits]) => ({ line, hits }))
    .sort((left, right) => left.line - right.line);

  const derivedLinesHit = lines.reduce((count, entry) => count + (entry.hits > 0 ? 1 : 0), 0);
  const derivedFunctionsHit = functions.reduce((count, fn) => count + (fn.hits > 0 ? 1 : 0), 0);

  files.push({
    file: section.file,
    functions,
    lines,
    linesFound: section.linesFound ?? lines.length,
    linesHit: section.linesHit ?? derivedLinesHit,
    functionsFound: section.functionsFound ?? functions.length,
    functionsHit: section.functionsHit ?? derivedFunctionsHit,
  });
}

function buildFunctions(section: Section, notes: CoverageParseNote[]): CoverageFunctionEvidence[] {
  const functions: CoverageFunctionEvidence[] = [];
  const declaredNames = new Set<string>();
  for (const decl of section.fnDecls) {
    declaredNames.add(decl.name);
    const hits = section.fnHits.get(decl.name) ?? 0;
    functions.push(
      decl.endLine === undefined
        ? { name: decl.name, line: decl.line, hits }
        : { name: decl.name, line: decl.line, endLine: decl.endLine, hits },
    );
  }
  for (const name of section.fnHits.keys()) {
    if (!declaredNames.has(name)) {
      notes.push(
        malformed(
          undefined,
          `FNDA for function '${name}' with no matching FN record in '${section.file}'`,
        ),
      );
    }
  }
  return functions.sort(
    (left, right) => left.line - right.line || left.name.localeCompare(right.name, "en"),
  );
}

function newSection(file: string): Section {
  return {
    file,
    fnDecls: [],
    fnHits: new Map(),
    lines: new Map(),
    linesFound: null,
    linesHit: null,
    functionsFound: null,
    functionsHit: null,
  };
}

function readCount(
  value: string,
  lineNo: number,
  notes: CoverageParseNote[],
  key: string,
): number | null {
  const count = toNonNegativeInt(value);
  if (count === null) {
    notes.push(malformed(lineNo, `${key} record has a malformed count '${truncate(value)}'`));
    return null;
  }
  return count;
}
