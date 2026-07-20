import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { z } from "zod";

const ADR_FILENAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ADR_ID = /^ADR-(\d{4})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_SOURCE_LENGTH = "YYYY-MM-DD".length;
const FRONTMATTER_START_LENGTH = 4;
const FRONTMATTER_END_LENGTH = 5;
const FIELDS = ["id", "date", "status", "enforced_by", "guide"] as const;
const FIELD_NAMES = new Set<string>(FIELDS);
const BODY_HEADINGS = ["## Context", "## Decision", "## Consequences"];

export const SUPERSEDED = /^Superseded by (ADR-\d{4})$/;

export interface AdrRecord {
  readonly file: string;
  readonly id: string;
  readonly status: string;
  readonly locators: readonly string[];
}

interface ParsedFrontmatter {
  readonly values: Map<string, string | string[]>;
  readonly bodyStart: number;
}

interface ParseContext {
  readonly values: Map<string, string | string[]>;
  readonly file: string;
  readonly failures: string[];
}

const parsedFieldsSchema = z.object({
  id: z.string(),
  date: z.string(),
  status: z.string(),
  enforced_by: z.array(z.string()),
  guide: z.string(),
});

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function addScalar(
  context: ParseContext,
  name: string,
  raw: string | undefined,
): string | undefined {
  if (!FIELD_NAMES.has(name)) {
    context.failures.push(`${context.file}: unknown frontmatter field '${name}'; remove it`);
  }
  if (context.values.has(name)) {
    context.failures.push(`${context.file}: duplicate frontmatter field '${name}'; keep one value`);
  }
  if (name !== "enforced_by") {
    context.values.set(name, raw ?? "");
    return undefined;
  }
  if (raw !== undefined && raw !== "") {
    context.failures.push(
      `${context.file}: enforced_by must be a list; put locators on indented '- ' lines`,
    );
  }
  context.values.set(name, []);
  return name;
}

function parseLine(
  line: string,
  listField: string | undefined,
  context: ParseContext,
): string | undefined {
  const item = /^ {2}- (\S.*)$/.exec(line);
  const list = listField === undefined ? undefined : context.values.get(listField);
  if (item !== null && Array.isArray(list)) {
    list.push(item[1] ?? "");
    return listField;
  }
  const scalar = /^([a-z_]+):(?: (.*))?$/.exec(line);
  if (scalar !== null) return addScalar(context, scalar[1] ?? "", scalar[2]);
  context.failures.push(
    `${context.file}: unsupported frontmatter syntax '${line}'; use documented scalars and two-space list items`,
  );
  return undefined;
}

function parseFrontmatter(
  source: string,
  file: string,
  failures: string[],
): ParsedFrontmatter | undefined {
  if (!source.startsWith("---\n")) {
    failures.push(`${file}: must begin with frontmatter at byte one; add an opening --- delimiter`);
    return undefined;
  }
  const closing = source.indexOf("\n---\n", FRONTMATTER_START_LENGTH);
  if (closing < 0) {
    failures.push(`${file}: missing closing frontmatter delimiter; add --- before the title`);
    return undefined;
  }
  const values = new Map<string, string | string[]>();
  const context = { values, file, failures };
  let listField: string | undefined;
  for (const line of source.slice(FRONTMATTER_START_LENGTH, closing).split("\n")) {
    listField = parseLine(line, listField, context);
  }
  for (const field of FIELDS) {
    if (!values.has(field)) {
      failures.push(`${file}: missing required field '${field}'; add it to frontmatter`);
    }
  }
  return { values, bodyStart: closing + FRONTMATTER_END_LENGTH };
}

function validDate(date: string): boolean {
  if (!DATE.test(date)) return false;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return (
    !Number.isNaN(timestamp) &&
    new Date(timestamp).toISOString().slice(0, DATE_SOURCE_LENGTH) === date
  );
}

function validateIdentity(
  identity: {
    readonly file: string;
    readonly id: string;
    readonly date: string;
    readonly status: string;
  },
  failures: string[],
): void {
  const { file, id, date, status } = identity;
  const idMatch = ADR_ID.exec(id);
  const fileMatch = ADR_FILENAME.exec(file);
  if (idMatch === null) failures.push(`${file}: invalid id '${id}'; expected ADR-NNNN`);
  if (idMatch !== null && fileMatch !== null && idMatch[1] !== fileMatch[1]) {
    failures.push(`${file}: filename number ${fileMatch[1] ?? ""} does not match ${id}`);
  }
  if (!validDate(date)) {
    failures.push(`${file}: invalid calendar date '${date}'; expected a real YYYY-MM-DD date`);
  }
  if (
    !["Proposed", "Accepted", "Deprecated"].includes(status) &&
    SUPERSEDED.exec(status) === null
  ) {
    failures.push(`${file}: invalid status '${status}'; use a documented lifecycle value`);
  }
}

function validateBody(file: string, body: string, failures: string[]): void {
  const lines = body.split("\n");
  if (!lines.some((line) => /^# \S/.test(line))) {
    failures.push(`${file}: missing required heading '#'; restore the ADR body contract`);
  }
  for (const heading of BODY_HEADINGS) {
    if (!lines.includes(heading)) {
      failures.push(
        `${file}: missing required heading '${heading}'; restore the ADR body contract`,
      );
    }
  }
}

function buildRecord(root: string, path: string, failures: string[]): AdrRecord | undefined {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const source = readFileSync(path, "utf8");
  const parsed = parseFrontmatter(source, file, failures);
  if (parsed === undefined) return undefined;
  const fields = parsedFieldsSchema.safeParse(Object.fromEntries(parsed.values));
  if (!fields.success) return undefined;
  const { id, date, status, guide, enforced_by: locators } = fields.data;
  validateIdentity({ file, id, date, status }, failures);
  if (!guide.startsWith("docs/") || guide.includes("..") || !isFile(resolve(root, guide))) {
    failures.push(
      `${file}: guide does not resolve: ${guide}; point to an existing repo-relative docs file`,
    );
  }
  validateBody(file, source.slice(parsed.bodyStart), failures);
  if (status === "Accepted" && locators.length === 0) {
    failures.push(
      `${file}: Accepted ADR requires at least one enforced_by locator; add a resolvable gate`,
    );
  }
  if (new Set(locators).size !== locators.length) {
    failures.push(`${file}: duplicate enforced_by locator; keep each gate once`);
  }
  return { file, id, status, locators };
}

export function discoverAdrs(root: string, failures: string[]): AdrRecord[] {
  const directory = resolve(root, "docs/adr");
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    failures.push("docs/adr: directory does not exist; add README.md and numbered ADRs");
    return [];
  }
  const entries = readdirSync(directory).sort();
  for (const file of entries) {
    if (file !== "README.md" && ADR_FILENAME.exec(file) === null) {
      failures.push(
        `docs/adr: unsupported file in docs/adr: ${file}; keep only README.md and NNNN-slug.md ADRs`,
      );
    }
  }
  const numbered = entries.filter((file) => ADR_FILENAME.test(file));
  if (numbered.length === 0) {
    failures.push("docs/adr: no numbered ADRs found; add at least one NNNN-slug.md file");
  }
  const prefixes = numbered.map((file) => file.slice(0, file.indexOf("-")));
  if (new Set(prefixes).size !== prefixes.length) {
    failures.push(
      "docs/adr: duplicate numeric filename prefix; keep one ADR file per permanent number",
    );
  }
  return numbered.flatMap((file) => {
    const record = buildRecord(root, resolve(directory, file), failures);
    return record === undefined ? [] : [record];
  });
}
