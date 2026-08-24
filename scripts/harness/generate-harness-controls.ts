// Validates harness.controls.json and emits an agent-facing markdown doc.
// For kind=lint-rule entries, re-projects category / principle / pairedGuide /
// repairKind / repairCommand from the rule's own meta.docs so there is one
// source of truth.

import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import { runDocGeneratorAsync } from "../lib/doc-generator.js";
import { loadLintRuleDocs, type RuleDocs } from "../lib/lint-rule-docs.js";
import { isObjectLike } from "../lib/records.js";
import { lintRatchets } from "../lint-ratchet/lint-ratchet-config.js";
import { type CommandPolicyRule, loadCommandPolicy } from "./command-policy-schema.js";
import {
  type ControlCategory,
  type ControlKind,
  isNonEmptyString,
  KINDS,
  type RawControlRecord,
  type RepairKind,
} from "./control-field-validation.js";
import {
  formatValidationFailures,
  resolveControl,
} from "./generate-harness-controls-validation.js";
import { HARNESS_MANIFEST_FILENAME, readHarnessManifest } from "./harness-manifest.js";
import { safeParseHarnessManifest } from "./harness-manifest-schema.js";
import { GENERATED_HARNESS_CONTROLS_DOC_PATH } from "./harness-paths.js";
import { formatHookWiring, HOOK_WIRING_PROVENANCE_NOTE } from "./hook-wiring-doc.js";
import type { HookWiring } from "./hook-wiring-schema.js";

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
  skill: "Skills",
};

export type RawControl = RawControlRecord & { readonly id: string };

export interface ControlSlot {
  readonly name: string;
  readonly script: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly dynamic?: string;
  readonly condition?: string;
}

export interface ResolvedControl {
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
  readonly slots?: readonly ControlSlot[];
  readonly hookWiring?: HookWiring;
}

export interface ControlValidationFailure {
  readonly id: string;
  readonly failures: readonly string[];
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, GENERATED_HARNESS_CONTROLS_DOC_PATH);

function assertAuthoredProfilesResolved(
  controls: readonly unknown[],
  parsedManifest: ReturnType<typeof safeParseHarnessManifest>,
): void {
  if (
    parsedManifest.manifest === undefined &&
    controls.some((entry) => isObjectLike(entry) && "slotProfile" in entry)
  ) {
    throw new Error(
      `Cannot generate harness controls while slot profiles are unresolved:\n${parsedManifest.failures.join("\n")}`,
    );
  }
}

interface HarnessDocInput {
  readonly controls: readonly RawControl[];
  readonly commandPolicy: readonly CommandPolicyRule[];
}

function readManifest(): HarnessDocInput {
  // Through readHarnessManifest, not raw IO: the lint-rule controls live in a
  // generated include and this doc must inventory the ASSEMBLED manifest.
  const parsed: unknown = readHarnessManifest(repoRoot);
  if (!isObjectLike(parsed)) {
    throw new Error(`${HARNESS_MANIFEST_FILENAME} must be an object`);
  }
  if (!Array.isArray(parsed.controls)) {
    throw new Error(`${HARNESS_MANIFEST_FILENAME} must declare a controls array`);
  }
  // On the clean path, consume the parser's early-resolved slot arrays so the
  // generated doc stays unaware of catalog/profile syntax. Preserve the raw
  // fallback deliberately: this generator owns granular, test-pinned
  // diagnostics and must still read past an unrelated whole-manifest defect.
  // That fallback is lossless only for controls that author materialized
  // `slots`; profile controls require the typed parser to resolve the catalog.
  const parsedManifest = safeParseHarnessManifest(parsed);
  assertAuthoredProfilesResolved(parsed.controls, parsedManifest);
  const sourceControls = parsedManifest.manifest?.controls ?? parsed.controls;
  const controls: RawControl[] = [];
  const seenIds = new Set<string>();
  for (const entry of sourceControls) {
    if (!isObjectLike(entry)) {
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
    controls.push({ ...entry, id });
  }
  return {
    controls,
    commandPolicy:
      parsed.commandPolicy === undefined ? [] : loadCommandPolicy(parsed.commandPolicy),
  };
}

interface CollectedHarnessDocs {
  readonly controls: readonly ResolvedControl[];
  readonly commandPolicy: readonly CommandPolicyRule[];
}

async function collectControls(): Promise<CollectedHarnessDocs | undefined> {
  const { entries: ruleDocEntries, failures: ruleDocFailures } = await loadLintRuleDocs(repoRoot);
  if (ruleDocFailures.length > 0) {
    const detail = ruleDocFailures
      .map((failure) => `- ${failure.id}: ${failure.failures.join("; ")}`)
      .join("\n");
    throw new Error(`Failed to load local rule meta.docs:\n${detail}`);
  }
  const ruleDocs = new Map<string, RuleDocs>(ruleDocEntries.map((entry) => [entry.id, entry]));
  // Ratchet principles are re-projected from the registry (single source of
  // truth), mirroring how lint-rule principles flow from each rule's meta.docs.
  const ratchetPrinciples = new Map<string, string>(
    lintRatchets.map((ratchet) => [ratchet.id, ratchet.principle]),
  );
  const manifest = readManifest();
  const entries: ResolvedControl[] = [];
  const failures: ControlValidationFailure[] = [];
  for (const raw of manifest.controls) {
    const result = resolveControl(raw, ruleDocs, repoRoot, ratchetPrinciples);
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
    // codepoint order, not localeCompare — load-bearing for committed/freshness-compared bytes:
    // the id tiebreaker feeds the committed generated doc (freshness-gated by harness:check).
    return kindOrder === 0 ? compareByCodepoint(a.id, b.id) : kindOrder;
  });
  return { controls: entries, commandPolicy: manifest.commandPolicy };
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

function formatSlots(slots: readonly ControlSlot[] | undefined): string[] {
  if (slots === undefined || slots.length === 0) return [];
  const lines = ["**Slots:**", ""];
  for (const slot of slots) {
    const condition = slot.condition === undefined ? "" : ` (${slot.condition})`;
    const details: string[] = [];
    if (slot.args !== undefined) {
      details.push(`args: \`${slot.args.join(" ")}\``);
    }
    if (slot.env !== undefined) {
      details.push(
        `env: \`${Object.entries(slot.env)
          .map(([name, value]) => `${name}=${value}`)
          .join(" ")}\``,
      );
    }
    if (slot.dynamic !== undefined) {
      details.push(`dynamic: \`${slot.dynamic}\``);
    }
    const suffix = details.length === 0 ? "" : ` — ${details.join("; ")}`;
    lines.push(`- \`${slot.name}\` — \`${slot.script}\`${condition}${suffix}`);
  }
  lines.push("");
  return lines;
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function formatPolicyProjection(rule: CommandPolicyRule): string {
  if (!rule.nativePermissions.projected) {
    return escapeTableCell(rule.nativePermissions.reason);
  }
  const matchers = rule.nativePermissions.matchers
    .map((matcher) => `\`${escapeTableCell(matcher)}\``)
    .join("<br>");
  return rule.nativePermissions.partialReason === undefined
    ? matchers
    : `${matchers}<br>Partial projection by necessity: ${escapeTableCell(rule.nativePermissions.partialReason)}`;
}

function formatCommandPolicy(rules: readonly CommandPolicyRule[]): string[] {
  if (rules.length === 0) return [];
  const lines = [
    "## Command policy reference",
    "",
    "The root `commandPolicy` rows are evaluated in this order; the first hard match wins, otherwise the first soft match advises. Projection disposition is total: each rule contributes complete Claude deny coverage, contributes a necessarily partial but sound projection with its reason, or records why it remains shared-policy-only.",
    "",
    "| Order | Rule | Class | Scope | Claude-native projection |",
    "|---:|---|---|---|---|",
  ];
  for (const rule of rules) {
    lines.push(
      `| ${String(rule.order)} | \`${rule.id}\` | ${rule.class} | ${rule.scope} | ${formatPolicyProjection(rule)} |`,
    );
  }
  lines.push("");
  return lines;
}

function renderMarkdown(
  entries: readonly ResolvedControl[],
  commandPolicy: readonly CommandPolicyRule[],
): string {
  const lines: string[] = [];
  lines.push("# Harness Controls");
  lines.push("");
  lines.push("> Generated by `scripts/harness/generate-harness-controls.ts`. Do not edit by hand.");
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
  lines.push(HOOK_WIRING_PROVENANCE_NOTE);
  lines.push("");
  lines.push(...formatCommandPolicy(commandPolicy));
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
    lines.push(...formatSlots(entry.slots));
    lines.push(...formatHookWiring(entry.hookWiring));
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

async function main(): Promise<void> {
  await runDocGeneratorAsync({
    outputPath,
    refreshCommand: "docs:harness-controls",
    render: async () => {
      const collected = await collectControls();
      if (collected === undefined) return undefined;
      return {
        rendered: renderMarkdown(collected.controls, collected.commandPolicy),
        wroteSuffix: ` (${String(collected.controls.length)} control(s))`,
      };
    },
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
