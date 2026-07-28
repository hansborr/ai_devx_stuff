// Suppression identity derivation (leaf 50 step 2). Turns the flat directive
// records emitted by the two register scanners into stable ledger identities.
//
// The identity is deliberately line-free: a nearby edit that moves a directive
// must not mint a new identity. Keys are
// `(kind, path, target, scope, selectorHash, duplicateIndex)`; `duplicateIndex`
// accepts coarse granularity for identical repeated directives in one file
// (inserting an identical directive above another may renumber both) in
// exchange for immunity to line churn.
//
// Residual collision, accepted: nothing in the key or the payload names the code
// a directive covers, so byte-identical occurrences in one file are told apart
// only by their order. Delete one and add an identical directive before
// unrelated code elsewhere in the same file, and every key and every payload is
// unchanged — the substitution passes both the full and the changed gate without
// reaching ledger review. Closing it needs the next-code-line hash the leaf
// rejected, which would churn the ledger on every edit to a suppressed line;
// that is the churn the line-free key exists to avoid. See the
// accepted-limitations section of
// docs/agent_notes/backlog/lint-deep-dive-2026-07/50-suppression-registers-into-commit-gate.md.

import { createHash } from "node:crypto";

import type { ParseResult } from "@musi/lint-ratchet/kernel/entry-baseline.js";

import { compareByCodepoint } from "./lib/codepoint-compare.js";

export const SUPPRESSION_KINDS = [
  "eslint-disable",
  "ts-expect-error",
  "ts-ignore",
  "ts-nocheck",
  "stryker-disable",
] as const;

export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

// `block` from the leaf's draft is intentionally absent: neither register
// tracks `eslint-enable`, so a bounded block range is not derivable from a
// single directive record. A bare `eslint-disable` is recorded as `file`,
// matching the register's own "broad" vocabulary.
export const SUPPRESSION_SCOPES = ["file", "line", "next-line"] as const;

export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];

export interface DirectiveRecord {
  readonly kind: SuppressionKind;
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface SuppressionEntry {
  readonly key: string;
  readonly path: string;
  readonly kind: SuppressionKind;
  readonly target: string;
  readonly scope: SuppressionScope;
  readonly selectorHash: string;
  readonly duplicateIndex: number;
  readonly reason: string;
}

const DIRECTIVE_PATTERNS: Readonly<Record<SuppressionKind, RegExp>> = {
  "eslint-disable": /(?:\/\/|\/\*)\s*(eslint-disable(?:-next-line|-line)?)(?=\s|$)/u,
  "ts-expect-error": /(?:\/\/|\/\*)\s*(@ts-expect-error)(?=\s|$)/u,
  "ts-ignore": /(?:\/\/|\/\*)\s*(@ts-ignore)(?=\s|$)/u,
  "ts-nocheck": /(?:\/\/|\/\*)\s*(@ts-nocheck)(?=\s|$)/u,
  "stryker-disable": /(?:\/\/|\/\*)\s*(Stryker\s+disable(?:\s+next-line)?)(?=\s|$)/u,
};

const NEXT_LINE_KEYWORDS = new Set([
  "eslint-disable-next-line",
  "@ts-expect-error",
  "@ts-ignore",
  "Stryker disable next-line",
]);
const LINE_KEYWORDS = new Set(["eslint-disable-line"]);

// Kinds whose target is the directive itself rather than a list of rule or
// mutator names: `@ts-nocheck` takes no argument list a reviewer could scope.
const SELF_TARGETED_KINDS = new Set<SuppressionKind>([
  "ts-expect-error",
  "ts-ignore",
  "ts-nocheck",
]);

// Named in the fail-closed error so the message points at the file to teach.
const IDENTITY_MODULE = "scripts/suppression-ledger-identity.ts";
const SELECTOR_HASH_LENGTH = 12;
const REASON_SEPARATOR = "--";
const BLOCK_COMMENT_END = "*/";

export function isSuppressionKind(value: unknown): value is SuppressionKind {
  return typeof value === "string" && SUPPRESSION_KINDS.some((kind) => kind === value);
}

function collapseWhitespace(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

function directiveBody(text: string): string {
  const end = text.indexOf(BLOCK_COMMENT_END);
  return end === -1 ? text : text.slice(0, end);
}

function scopeForKeyword(keyword: string): SuppressionScope {
  if (NEXT_LINE_KEYWORDS.has(keyword)) return "next-line";
  if (LINE_KEYWORDS.has(keyword)) return "line";
  return "file";
}

function targetsForDirective(kind: SuppressionKind, keyword: string, subject: string): string[] {
  if (SELF_TARGETED_KINDS.has(kind)) return [keyword];
  const named = subject
    .split(",")
    .map((part) => collapseWhitespace(part))
    .filter((part) => part.length > 0);
  return named.length > 0 ? [...named].sort(compareByCodepoint) : ["all"];
}

// Hashes the normalized directive subject — the directive keyword plus its full
// rule/mutator list — and deliberately excludes whitespace and the free-text
// reason. Including the sibling list is what separates a solo `no-console`
// disable from the `no-console` half of a two-rule disable: they are different
// review objects even though they name the same rule.
//
// The keyword and the target list are joined with NUL, which no keyword or rule
// name can contain, so no pair of distinct (keyword, targets) can collide on one
// hash input. It is written as the `\u0000` escape rather than a raw byte on
// purpose: a literal NUL makes git classify this whole module as binary, which
// would hide every future change to key derivation from diffs, numstat, and
// grep — in the module whose job is deriving review identity.
function selectorHash(keyword: string, targets: readonly string[]): string {
  const subject = `${keyword}\u0000${targets.join(",")}`;
  const digest = createHash("sha256").update(subject, "utf8").digest("hex");
  return `sha256:${digest.slice(0, SELECTOR_HASH_LENGTH)}`;
}

interface ParsedDirective {
  readonly keyword: string;
  readonly scope: SuppressionScope;
  readonly targets: readonly string[];
  readonly selectorHash: string;
  readonly reason: string;
}

function parseDirective(record: DirectiveRecord): ParsedDirective | undefined {
  const body = directiveBody(record.text);
  const matched = DIRECTIVE_PATTERNS[record.kind].exec(body);
  const keywordRaw = matched?.[1];
  if (matched === null || keywordRaw === undefined) return undefined;

  const keyword = collapseWhitespace(keywordRaw);
  const tail = body.slice(matched.index + matched[0].length);
  const separator = tail.indexOf(REASON_SEPARATOR);
  const subject = separator === -1 ? tail : tail.slice(0, separator);
  const reason =
    separator === -1 ? "" : collapseWhitespace(tail.slice(separator + REASON_SEPARATOR.length));
  const targets = targetsForDirective(record.kind, keyword, subject);

  return {
    keyword,
    scope: scopeForKeyword(keyword),
    targets,
    selectorHash: selectorHash(keyword, targets),
    reason,
  };
}

// Canonical scan order: path, then line, then kind. Records arrive from two
// independent scanners, so ordering them here — rather than trusting the
// concatenation order — is what makes `duplicateIndex` reproducible.
function compareRecords(left: DirectiveRecord, right: DirectiveRecord): number {
  const byPath = compareByCodepoint(left.path, right.path);
  if (byPath !== 0) return byPath;
  if (left.line !== right.line) return left.line - right.line;
  return compareByCodepoint(left.kind, right.kind);
}

function entryKey(
  record: DirectiveRecord,
  target: string,
  parsed: ParsedDirective,
  duplicateIndex: number,
): string {
  return [
    record.kind,
    record.path,
    target,
    parsed.scope,
    parsed.selectorHash,
    String(duplicateIndex),
  ].join("|");
}

// Fails closed on a record the register emitted but this module cannot parse.
// The two layers apply independent vocabularies: the registers decide what
// counts as a suppression, `DIRECTIVE_PATTERNS` decides how to key one. Skipping
// the mismatch would silently mint no identity for a directive the tree really
// carries, so a register that later learns a new spelling for an existing kind
// would quietly drop that suppression out of the ledger's reach — enforcement
// lost during an ordinary scanner change. Erroring instead makes the divergence
// a loud gate failure that names the file to teach.
export function suppressionEntriesFromDirectives(
  records: readonly DirectiveRecord[],
): ParseResult<readonly SuppressionEntry[]> {
  const seen = new Map<string, number>();
  const entries: SuppressionEntry[] = [];

  for (const record of [...records].sort(compareRecords)) {
    const parsed = parseDirective(record);
    if (parsed === undefined) {
      return {
        ok: false,
        error: `no ${record.kind} directive recognised at ${record.path}:${String(record.line)}; a register emitted a spelling ${IDENTITY_MODULE} cannot key: ${record.text}`,
      };
    }
    for (const target of parsed.targets) {
      const prefix = entryKey(record, target, parsed, 0);
      const duplicateIndex = seen.get(prefix) ?? 0;
      seen.set(prefix, duplicateIndex + 1);
      entries.push({
        key: entryKey(record, target, parsed, duplicateIndex),
        path: record.path,
        kind: record.kind,
        target,
        scope: parsed.scope,
        selectorHash: parsed.selectorHash,
        duplicateIndex,
        reason: parsed.reason,
      });
    }
  }
  return { ok: true, value: entries };
}
