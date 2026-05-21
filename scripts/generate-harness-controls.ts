// Validates harness.controls.json and emits an agent-facing markdown doc.
// For kind=lint-rule entries, re-projects category / principle / pairedGuide /
// repairKind / repairCommand from the rule's own meta.docs so there is one
// source of truth.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadLintRuleDocs,
  RULE_DOC_CATEGORIES,
  RULE_DOC_REPAIR_KINDS,
  type RuleDocCategory,
  type RuleDocRepairKind,
  type RuleDocs,
} from "./lint-rule-docs.js";

const PROCESS_ARG_OFFSET = 2;
const KINDS = [
  "lint-rule",
  "ratchet",
  "sensor",
  "verify-wrapper",
  "doctor-check",
  "drift-scope",
  "doc-generator",
  "check",
  "logs-audit",
  "codemod",
  "hook",
] as const;

type ControlCategory = RuleDocCategory;
type RepairKind = RuleDocRepairKind;
type ControlKind = (typeof KINDS)[number];

const KIND_HEADINGS: Record<ControlKind, string> = {
  "lint-rule": "Lint rules",
  ratchet: "Ratchets",
  sensor: "Sensors",
  "verify-wrapper": "Verify wrappers",
  "doctor-check": "Doctor checks",
  "drift-scope": "Drift scopes",
  "doc-generator": "Doc generators",
  check: "Checks",
  "logs-audit": "Logs audit",
  codemod: "Codemods",
  hook: "Hooks",
};

interface RawControl {
  readonly id: string;
  readonly kind: string;
  readonly ruleName?: string;
  readonly category?: string;
  readonly principle?: string;
  readonly pairedGuide?: string;
  readonly repairKind?: string;
  readonly repairCommand?: string;
  readonly source?: string;
  readonly invocation?: string;
}

interface ResolvedControl {
  readonly id: string;
  readonly kind: ControlKind;
  readonly ruleName?: string;
  readonly category: ControlCategory;
  readonly principle: string;
  readonly pairedGuide: string;
  readonly repairKind: RepairKind;
  readonly repairCommand?: string;
  readonly source: string;
  readonly invocation: string;
}

interface ControlValidationFailure {
  readonly id: string;
  readonly failures: readonly string[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "harness.controls.json");
const outputPath = join(repoRoot, "docs/generated/harness-controls.md");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isControlCategory(value: unknown): value is ControlCategory {
  return typeof value === "string" && RULE_DOC_CATEGORIES.some((category) => category === value);
}

function isRepairKind(value: unknown): value is RepairKind {
  return typeof value === "string" && RULE_DOC_REPAIR_KINDS.some((kind) => kind === value);
}

function isControlKind(value: unknown): value is ControlKind {
  return typeof value === "string" && KINDS.some((kind) => kind === value);
}

function isUnderRoot(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function validatePairedGuide(value: string, failures: string[]): void {
  if (value === "none") return;
  const resolved = resolve(repoRoot, value);
  if (!isUnderRoot(repoRoot, resolved)) {
    failures.push("pairedGuide must resolve under repoRoot");
    return;
  }
  if (!existsSync(resolved)) {
    failures.push(`pairedGuide does not resolve to an existing file: ${value}`);
  }
}

function validateSource(value: string, failures: string[]): void {
  const resolved = resolve(repoRoot, value);
  if (!isUnderRoot(repoRoot, resolved)) {
    failures.push("source must resolve under repoRoot");
    return;
  }
  if (!existsSync(resolved)) {
    failures.push(`source does not resolve to an existing file: ${value}`);
  }
}

function resolveLintRuleControl(
  raw: RawControl,
  ruleDocs: ReadonlyMap<string, RuleDocs>,
  failures: string[],
): ResolvedControl | undefined {
  const ruleName = raw.ruleName;
  if (!isNonEmptyString(ruleName)) {
    failures.push("lint-rule entries must declare a ruleName");
    return undefined;
  }
  const docs = ruleDocs.get(ruleName);
  if (docs === undefined) {
    failures.push(`ruleName ${ruleName} has no parseable meta.docs in eslint.config.js`);
    return undefined;
  }
  for (const field of ["category", "principle", "pairedGuide", "repairKind", "repairCommand"] as const) {
    if (raw[field] !== undefined) {
      failures.push(`lint-rule entries must not restate ${field}; it is re-projected from meta.docs`);
    }
  }
  if (!isNonEmptyString(raw.source)) {
    failures.push("source must be a non-empty string");
    return undefined;
  }
  if (!isNonEmptyString(raw.invocation)) {
    failures.push("invocation must be a non-empty string");
    return undefined;
  }
  validateSource(raw.source, failures);
  if (failures.length > 0) return undefined;
  return {
    id: raw.id,
    kind: "lint-rule",
    ruleName,
    category: docs.category,
    principle: docs.principle,
    pairedGuide: docs.pairedGuide,
    repairKind: docs.repairKind,
    ...(docs.repairCommand !== undefined ? { repairCommand: docs.repairCommand } : {}),
    source: raw.source,
    invocation: raw.invocation,
  };
}

function resolveNonLintControl(
  raw: RawControl,
  kind: ControlKind,
  failures: string[],
): ResolvedControl | undefined {
  if (raw.ruleName !== undefined) {
    failures.push("ruleName is only allowed on lint-rule entries");
  }
  if (!isControlCategory(raw.category)) {
    failures.push(`category must be one of: ${RULE_DOC_CATEGORIES.join(", ")}`);
  }
  if (!isNonEmptyString(raw.principle)) {
    failures.push("principle must be a non-empty string");
  }
  if (!isNonEmptyString(raw.pairedGuide)) {
    failures.push('pairedGuide must be "none" or a non-empty path string');
  } else {
    validatePairedGuide(raw.pairedGuide, failures);
  }
  if (!isRepairKind(raw.repairKind)) {
    failures.push(`repairKind must be one of: ${RULE_DOC_REPAIR_KINDS.join(", ")}`);
  }
  const hasRepairCommand = raw.repairCommand !== undefined;
  if (raw.repairKind === "codemod") {
    if (!isNonEmptyString(raw.repairCommand)) {
      failures.push("repairCommand must be a non-empty string when repairKind is codemod");
    }
  } else if (hasRepairCommand) {
    failures.push("repairCommand must be absent unless repairKind is codemod");
  }
  if (!isNonEmptyString(raw.source)) {
    failures.push("source must be a non-empty string");
  } else {
    validateSource(raw.source, failures);
  }
  if (!isNonEmptyString(raw.invocation)) {
    failures.push("invocation must be a non-empty string");
  }
  if (failures.length > 0) return undefined;
  /*
   * type-assertion-boundary: json - each field above was shape-validated by an
   * `isControlCategory` / `isRepairKind` / `isNonEmptyString` type guard, but
   * the guards push into `failures` rather than early-returning (so the caller
   * sees every problem at once), and TypeScript can't carry the per-field
   * narrowings through the intermediate `failures.push(...)` statements. The
   * casts narrow back to the validated shape at the single return point.
   */
  return {
    id: raw.id,
    kind,
    category: raw.category as ControlCategory,
    principle: raw.principle as string,
    pairedGuide: raw.pairedGuide as string,
    repairKind: raw.repairKind as RepairKind,
    ...(raw.repairCommand !== undefined ? { repairCommand: raw.repairCommand } : {}),
    source: raw.source as string,
    invocation: raw.invocation as string,
  };
}

function resolveControl(
  raw: RawControl,
  ruleDocs: ReadonlyMap<string, RuleDocs>,
): ResolvedControl | ControlValidationFailure {
  const failures: string[] = [];
  if (!isControlKind(raw.kind)) {
    failures.push(`kind must be one of: ${KINDS.join(", ")}`);
    return { id: raw.id, failures };
  }
  const resolved =
    raw.kind === "lint-rule"
      ? resolveLintRuleControl(raw, ruleDocs, failures)
      : resolveNonLintControl(raw, raw.kind, failures);
  if (resolved === undefined) {
    return { id: raw.id, failures };
  }
  return resolved;
}

function formatValidationFailures(failures: readonly ControlValidationFailure[]): string {
  const lines = ["Invalid harness manifest entries:"];
  for (const failure of failures) {
    lines.push(`- ${failure.id}: ${failure.failures.join("; ")}`);
  }
  return lines.join("\n");
}

function readManifest(): RawControl[] {
  const text = readFileSync(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) {
    throw new Error("harness.controls.json must be an object");
  }
  if (!Array.isArray(parsed.controls)) {
    throw new Error("harness.controls.json must declare a controls array");
  }
  const controls: RawControl[] = [];
  const seenIds = new Set<string>();
  for (const entry of parsed.controls) {
    if (!isObject(entry)) {
      throw new Error("every control entry must be an object");
    }
    const id = entry.id;
    if (!isNonEmptyString(id)) {
      throw new Error("every control entry must declare a non-empty id");
    }
    if (seenIds.has(id)) {
      throw new Error(`duplicate control id: ${id}`);
    }
    seenIds.add(id);
    // type-assertion-boundary: json - `entry` came from JSON.parse of harness.controls.json and was shape-validated above (`isObject(entry)` + `isNonEmptyString(id)`); deeper field-level validation happens later in `resolveControl`. The double-cast (`as unknown as RawControl`) widens away the `Record<string, unknown>` field types so each readonly optional field is reachable without per-field casts in the consumer.
    controls.push(entry as unknown as RawControl);
  }
  return controls;
}

function readCurrentOutput(): string {
  try {
    return readFileSync(outputPath, "utf8");
  } catch {
    return "";
  }
}

async function collectControls(): Promise<ResolvedControl[] | undefined> {
  const { entries: ruleDocEntries, failures: ruleDocFailures } = await loadLintRuleDocs(repoRoot);
  if (ruleDocFailures.length > 0) {
    const detail = ruleDocFailures
      .map((failure) => `- ${failure.id}: ${failure.failures.join("; ")}`)
      .join("\n");
    throw new Error(`Failed to load local rule meta.docs:\n${detail}`);
  }
  const ruleDocs = new Map<string, RuleDocs>(
    ruleDocEntries.map((entry) => [entry.id, entry]),
  );
  const rawControls = readManifest();
  const entries: ResolvedControl[] = [];
  const failures: ControlValidationFailure[] = [];
  for (const raw of rawControls) {
    const result = resolveControl(raw, ruleDocs);
    if ("failures" in result) {
      failures.push(result);
    } else {
      entries.push(result);
    }
  }
  if (failures.length > 0) {
    console.error(formatValidationFailures(failures));
    process.exitCode = 1;
    return undefined;
  }
  entries.sort((a, b) => {
    const kindOrder = KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
    return kindOrder === 0 ? a.id.localeCompare(b.id) : kindOrder;
  });
  return entries;
}

function formatPairedGuide(pairedGuide: string): string {
  if (pairedGuide === "none") return "none";
  const href = relative("docs/generated", pairedGuide).replaceAll("\\", "/");
  return `[${pairedGuide}](${href})`;
}

function formatRepair(entry: ResolvedControl): string {
  if (entry.repairKind !== "codemod") return entry.repairKind;
  const command = entry.repairCommand;
  if (!isNonEmptyString(command)) {
    throw new Error(`Missing repair command for ${entry.id}`);
  }
  return `${entry.repairKind} — \`${command}\``;
}

function renderMarkdown(entries: readonly ResolvedControl[]): string {
  const lines: string[] = [];
  lines.push("# Harness Controls");
  lines.push("");
  lines.push("> Generated by `scripts/generate-harness-controls.ts`. Do not edit by hand.");
  lines.push("> Refresh with `bun run docs:harness-controls`.");
  lines.push("");
  lines.push(
    "Authoritative inventory of Musi's harness controls — every lint rule, ratchet, sensor, verify wrapper, doctor check, drift scope, doc generator, check, logs audit, codemod, and hook the harness enforces. The agent-facing view groups by `kind` so a diagnostic can be navigated to its source, paired guide, and repair path.",
  );
  lines.push("");
  lines.push(
    "For `kind: lint-rule`, the rule-specific metadata is re-projected from each rule's `meta.docs` contract (see `docs/generated/local-lint-rules.md`) so the manifest stays a thin enumeration.",
  );
  lines.push("");
  let currentKind: ControlKind | undefined;
  for (const entry of entries) {
    if (entry.kind !== currentKind) {
      lines.push(`## ${KIND_HEADINGS[entry.kind]}`);
      lines.push("");
      currentKind = entry.kind;
    }
    lines.push(`### \`${entry.id}\``);
    lines.push("");
    if (entry.ruleName !== undefined) {
      lines.push(`**Rule:** \`${entry.ruleName}\``);
      lines.push("");
    }
    lines.push(`**Principle:** ${entry.principle}`);
    lines.push("");
    lines.push(`**Category:** ${entry.category}`);
    lines.push("");
    lines.push(`**Source:** \`${entry.source}\``);
    lines.push("");
    lines.push(`**Invocation:** \`${entry.invocation}\``);
    lines.push("");
    lines.push(`**Paired guide:** ${formatPairedGuide(entry.pairedGuide)}`);
    lines.push("");
    lines.push(`**Repair:** ${formatRepair(entry)}`);
    lines.push("");
  }
  while (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(args: readonly string[]): { readonly checkMode: boolean } {
  const unknownArgs = args.filter((arg) => arg !== "--" && arg !== "--check");
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
  }
  return { checkMode: args.includes("--check") };
}

async function main(): Promise<void> {
  const { checkMode } = parseArgs(process.argv.slice(PROCESS_ARG_OFFSET));
  const entries = await collectControls();
  if (entries === undefined) return;
  const rendered = renderMarkdown(entries);

  if (checkMode) {
    const current = readCurrentOutput();
    if (current !== rendered) {
      console.error(
        `${outputPath} is out of date. Run \`bun run docs:harness-controls\` and commit the result.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`${outputPath} is up to date.`);
    return;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered);
  console.log(`Wrote ${outputPath} (${String(entries.length)} control(s)).`);
}

await main();
