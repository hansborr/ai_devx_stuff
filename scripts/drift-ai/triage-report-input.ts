import { parseArray } from "./triage-parsing.js";
import type {
  AdvisoryCapInput,
  AdvisoryInput,
  AdvisoryPrerequisiteInput,
  AdvisorySectionInput,
  DolosAdvisoryInput,
  DolosFileRangeInput,
  DolosRowInput,
  SemgrepAdvisoryInput,
  SemgrepRowInput,
  TriageInput,
} from "./triage-report-contracts.js";
import { parseDriftReport } from "./triage-report-drift-input.js";
import { parseOptionalScanProvenance } from "./triage-report-provenance.js";

export type { NamedTriageInput } from "./triage-report-contracts.js";

export function parseTriageInput(value: unknown): TriageInput {
  const drift = parseDriftReport(value);
  if (drift !== null) return { kind: "drift-report", report: drift };
  const semgrep = parseSemgrepAdvisory(value);
  if (semgrep !== null) return { kind: "semgrep-advisory", report: semgrep };
  const dolos = parseDolosAdvisory(value);
  if (dolos !== null) return { kind: "dolos-advisory", report: dolos };
  throw new Error(
    "input is not a supported drift report, semgrep-candidates advisory, or dolos-candidates advisory",
  );
}

function parseSemgrepAdvisory(value: unknown): SemgrepAdvisoryInput | null {
  const shared = parseAdvisory(value, "semgrep-candidates", parseSemgrepRow);
  if (shared === null) return null;
  return { ...shared, subcommand: "semgrep-candidates" };
}

function parseSemgrepRow(value: unknown): SemgrepRowInput | null {
  const header = parseSemgrepHeader(value);
  if (header === null || !isRecord(value)) return null;
  const ranges = parseArray(value["ranges"], parseSemgrepRange);
  if (ranges === null || ranges.length === 0) return null;
  const cwe = parseOptionalStringArray(header.metadata["cwe"]);
  if (cwe === null) return null;
  const confidence = header.metadata["confidence"];
  if (confidence !== undefined && !isNullableString(confidence)) return null;
  return {
    ...header,
    ranges,
    metadata: {
      ...(cwe === undefined ? {} : { cwe }),
      ...(confidence === undefined ? {} : { confidence }),
    },
  };
}

type SemgrepHeader = Pick<
  SemgrepRowInput,
  "rank" | "candidateSource" | "checkId" | "path" | "count" | "severity" | "message"
> & { readonly metadata: Readonly<Record<string, unknown>> };

function parseSemgrepHeader(value: unknown): SemgrepHeader | null {
  if (!isRecord(value)) return null;
  if (value["candidateSource"] !== "semgrep") return null;
  const rank = value["rank"];
  if (!isNumber(rank)) return null;
  const checkId = value["checkId"];
  if (!isString(checkId)) return null;
  const path = value["path"];
  if (!isString(path)) return null;
  const count = value["count"];
  if (!isNumber(count)) return null;
  const severity = value["severity"];
  if (!isNullableString(severity)) return null;
  const message = value["message"];
  if (!isNullableString(message)) return null;
  const metadata = value["metadata"];
  if (!isRecord(metadata)) return null;
  return {
    rank,
    candidateSource: "semgrep",
    checkId,
    path,
    count,
    severity,
    message,
    metadata,
  };
}

function parseSemgrepRange(value: unknown): SemgrepRowInput["ranges"][number] | null {
  if (
    !isRecord(value) ||
    !isNumber(value["startLine"]) ||
    !isNullableNumber(value["startCol"]) ||
    !isNumber(value["endLine"]) ||
    !isNullableNumber(value["endCol"])
  ) {
    return null;
  }
  return {
    startLine: value["startLine"],
    startCol: value["startCol"],
    endLine: value["endLine"],
    endCol: value["endCol"],
  };
}

function parseDolosAdvisory(value: unknown): DolosAdvisoryInput | null {
  const shared = parseAdvisory(value, "dolos-candidates", parseDolosRow);
  if (shared === null) return null;
  return { ...shared, subcommand: "dolos-candidates" };
}

function parseDolosRow(value: unknown): DolosRowInput | null {
  const header = parseDolosHeader(value);
  if (header === null || !isRecord(value)) return null;
  const left = parseDolosFileRange(value["left"]);
  const right = parseDolosFileRange(value["right"]);
  if (left === null || right === null) return null;
  return {
    ...header,
    candidateSource: "dolos",
    left,
    right,
  };
}

type DolosHeader = Pick<DolosRowInput, "rank" | "candidateSource" | "score" | "metrics">;

function parseDolosHeader(value: unknown): DolosHeader | null {
  if (!isRecord(value) || value["candidateSource"] !== "dolos") return null;
  const rank = value["rank"];
  if (!isNumber(rank)) return null;
  const score = value["score"];
  if (!isNumber(score)) return null;
  const metrics = parseDolosMetrics(value["metrics"]);
  if (metrics === null) return null;
  return { rank, candidateSource: "dolos", score, metrics };
}

function parseDolosMetrics(value: unknown): DolosRowInput["metrics"] | null {
  if (!isRecord(value)) return null;
  const similarity = value["similarity"];
  if (!isNumber(similarity)) return null;
  const totalOverlap = value["totalOverlap"];
  if (!isNumber(totalOverlap)) return null;
  const longestFragment = value["longestFragment"];
  if (!isNumber(longestFragment)) return null;
  return { similarity, totalOverlap, longestFragment };
}

function parseDolosFileRange(value: unknown): DolosFileRangeInput | null {
  if (
    !isRecord(value) ||
    !isString(value["filePath"]) ||
    !isNumber(value["startLine"]) ||
    !isNumber(value["endLine"]) ||
    !isNumber(value["lineCount"])
  ) {
    return null;
  }
  return {
    filePath: value["filePath"],
    startLine: value["startLine"],
    endLine: value["endLine"],
    lineCount: value["lineCount"],
  };
}

function parseAdvisory<Subcommand extends string, Row>(
  value: unknown,
  subcommand: Subcommand,
  parseRow: (row: unknown) => Row | null,
): AdvisoryInput<Subcommand, Row> | null {
  if (
    !isRecord(value) ||
    value["kind"] !== "advisory" ||
    value["lane"] !== "prototype" ||
    value["subcommand"] !== subcommand
  ) {
    return null;
  }
  const degradations = parseStringArray(value["degradations"]);
  if (degradations === null) throw malformedAdvisoryField(subcommand, "degradations");
  const prerequisites = parseArray(value["prerequisites"], parseAdvisoryPrerequisite);
  if (prerequisites === null) throw malformedAdvisoryField(subcommand, "prerequisites");
  const caps = parseArray(value["caps"], parseAdvisoryCap);
  if (caps === null) throw malformedAdvisoryField(subcommand, "caps");
  const sections = parseAdvisorySections(value["sections"], subcommand, parseRow);
  const scanProvenance = parseOptionalScanProvenance(value["scanProvenance"]);
  if (scanProvenance === null) throw malformedAdvisoryField(subcommand, "scanProvenance");
  return {
    kind: "advisory",
    lane: "prototype",
    subcommand,
    ...(scanProvenance === undefined ? {} : { scanProvenance }),
    prerequisites,
    degradations,
    caps,
    sections,
  };
}

function parseAdvisoryPrerequisite(value: unknown): AdvisoryPrerequisiteInput | null {
  if (
    !isRecord(value) ||
    !isString(value["name"]) ||
    !isBoolean(value["satisfied"]) ||
    !isString(value["detail"])
  ) {
    return null;
  }
  return { name: value["name"], satisfied: value["satisfied"], detail: value["detail"] };
}

function parseAdvisoryCap(value: unknown): AdvisoryCapInput | null {
  if (
    !isRecord(value) ||
    !isString(value["label"]) ||
    !isNumber(value["limit"]) ||
    !isBoolean(value["hit"]) ||
    !isNullableString(value["detail"])
  ) {
    return null;
  }
  return {
    label: value["label"],
    limit: value["limit"],
    hit: value["hit"],
    detail: value["detail"],
  };
}

function parseAdvisorySections<Row>(
  value: unknown,
  subcommand: string,
  parseRow: (row: unknown) => Row | null,
): AdvisorySectionInput<Row>[] {
  if (!Array.isArray(value)) {
    throw new Error(`malformed ${subcommand} advisory sections: expected an array`);
  }
  const parsed: AdvisorySectionInput<Row>[] = [];
  for (const [sectionIndex, section] of value.entries()) {
    if (!isRecord(section) || !isNumber(section["totalCandidates"])) {
      throw new Error(`malformed ${subcommand} section at index ${String(sectionIndex)}`);
    }
    const totalCandidates = section["totalCandidates"];
    const entriesValue = section["entries"];
    if (!Array.isArray(entriesValue)) {
      throw new Error(
        `malformed ${subcommand} section entries at section ${String(sectionIndex)}: expected an array`,
      );
    }
    const entries: Row[] = [];
    for (const [rowIndex, row] of entriesValue.entries()) {
      const result = parseRow(row);
      if (result === null) {
        throw new Error(
          `malformed ${subcommand} row at section ${String(sectionIndex)} index ${String(rowIndex)}`,
        );
      }
      entries.push(result);
    }
    if (!Number.isInteger(totalCandidates) || totalCandidates < entries.length) {
      throw new Error(
        `malformed ${subcommand} section at index ${String(sectionIndex)}: totalCandidates must be a non-negative integer at least as large as entries`,
      );
    }
    parsed.push({ totalCandidates, entries });
  }
  return parsed;
}

function malformedAdvisoryField(subcommand: string, field: string): Error {
  return new Error(`malformed ${subcommand} advisory field ${field}`);
}

function parseStringArray(value: unknown): string[] | null {
  return parseArray(value, (entry) => (isString(entry) ? entry : null));
}

function parseOptionalStringArray(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  return parseStringArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isNumber(value);
}
