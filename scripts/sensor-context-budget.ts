#!/usr/bin/env bun
// Always-loaded context-budget reporter (harness-review-2026-05 rec M2).
//
// Per-file caps exist (scripts/doc-length-policy.sh) but nothing sums the
// total per-session context the harness always injects: root CLAUDE.md and
// AGENTS.md plus any files they pull in through Claude-style `@path` imports.
// This sensor prints that set with per-file and total line/byte/token
// figures so the always-on feedforward surface can be governed as a set
// ("optimize the set, not each item in isolation") before anything new is
// made always-on.
//
// Report-only, terminal advisory: it never gates and always exits 0 on a
// successful scan (exit 2 only for CLI misuse or an unreadable file). Token
// counts are an estimate: bytes / 4, the common ~4-chars-per-token
// heuristic, good enough for trend and budget conversations.
//
// Scope caveat: this sums only the repo-owned always-loaded set — the root
// CLAUDE.md and AGENTS.md plus their `@`-imports. Real sessions can load
// more (`.claude/rules/*.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, and
// user-level memory such as `~/.claude/CLAUDE.md`); those are deliberately
// excluded because they are absent from this repo or vary per machine, and
// including them would make the governance figure non-reproducible across
// clones and CI. Treat the total as a lower bound on real session context.

import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROCESS_ARGV_USER_ARGS_START = 2;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const EXIT_TOOL_ERROR = 2;
const JSON_INDENT = 2;
const HELP_FLAGS = new Set(["--help", "-h"]);

// Root files harnesses inject into every session (Claude Code, Codex, and
// Copilot all read AGENTS.md; CLAUDE.md is the Claude-specific wrapper).
export const ALWAYS_LOADED_ROOT_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

export type ContextBudgetFileInput = {
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
};

export type ContextBudgetFile = ContextBudgetFileInput & {
  readonly estimatedTokens: number;
};

export type ContextBudgetReport = {
  readonly files: readonly ContextBudgetFile[];
  readonly totals: {
    readonly files: number;
    readonly lines: number;
    readonly bytes: number;
    readonly estimatedTokens: number;
  };
};

export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / CHARS_PER_TOKEN_ESTIMATE);
}

// Claude-style `@path` import tokens, matching the documented grammar
// (https://code.claude.com/docs/en/memory): line-start or whitespace-preceded
// `@` followed by a path-ish token, with an optional `~` prefix for
// home-relative imports (`@~/.claude/my-project-instructions.md`).
// `[\w./-]*\w` requires the token to end in a word character so trailing
// punctuation is dropped, and the preceding-character guard rejects email
// addresses.
const IMPORT_TOKEN_PATTERN = /(?:^|\s)@(~?[\w./-]*\w)/g;

// "Imported files can recursively import other files, with a maximum depth of
// four hops." — https://code.claude.com/docs/en/memory
const MAX_IMPORT_HOPS = 4;

const FENCE_DELIMITER_PATTERN = /^\s*(`{3,}|~{3,})/;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

/**
 * Drop HTML comments (`<!-- ... -->`, including multi-line ones). Claude Code
 * strips them before injecting memory files, so commented-out text is context
 * the model never sees and a commented `@import` is never followed. Unclosed
 * comments are left as-is rather than guessing at an end. Replaced with a
 * space so the removal cannot splice surrounding text into a token.
 */
export function stripHtmlComments(markdown: string): string {
  return markdown.replace(HTML_COMMENT_PATTERN, " ");
}

/**
 * Strip CommonMark inline code spans from a single line: a run of N backticks
 * opens a span that only a later run of exactly N backticks closes, so both
 * `@x.md` and ``@x.md`` (and spans containing backticks of another run
 * length) are code. Unmatched runs are kept as literal text. Spans are
 * replaced with a space so the removal cannot splice text into a token.
 */
function backtickRunEnd(line: string, start: number): number {
  let end = start;
  while (end < line.length && line.charAt(end) === "`") end += 1;
  return end;
}

function findClosingRunEnd(line: string, from: number, runLength: number): number {
  let cursor = from;
  while (cursor < line.length) {
    if (line.charAt(cursor) !== "`") {
      cursor += 1;
      continue;
    }
    const runEnd = backtickRunEnd(line, cursor);
    if (runEnd - cursor === runLength) return runEnd;
    cursor = runEnd;
  }
  return -1;
}

function stripInlineCodeSpans(line: string): string {
  let result = "";
  let index = 0;
  while (index < line.length) {
    const char = line.charAt(index);
    if (char !== "`") {
      result += char;
      index += 1;
      continue;
    }
    const openEnd = backtickRunEnd(line, index);
    const closeEnd = findClosingRunEnd(line, openEnd, openEnd - index);
    if (closeEnd === -1) {
      result += line.slice(index, openEnd);
      index = openEnd;
      continue;
    }
    result += " ";
    index = closeEnd;
  }
  return result;
}

/**
 * Drop fenced code blocks (``` or ~~~, including the delimiter lines) and
 * inline code spans: "Import parsing skips Markdown code spans and fenced
 * code blocks" (https://code.claude.com/docs/en/memory). Per CommonMark, a
 * fence only closes on a run of the same character at least as long as the
 * opener — a ``` line inside a ```` block stays fenced content.
 */
function stripCodeRegions(markdown: string): string {
  const kept: string[] = [];
  let openFence: { readonly char: string; readonly length: number } | null = null;
  for (const line of markdown.split("\n")) {
    const fenceRun = FENCE_DELIMITER_PATTERN.exec(line)?.[1];
    if (openFence === null) {
      if (fenceRun !== undefined) {
        openFence = { char: fenceRun.charAt(0), length: fenceRun.length };
        continue;
      }
      kept.push(stripInlineCodeSpans(line));
      continue;
    }
    if (
      fenceRun !== undefined &&
      fenceRun.charAt(0) === openFence.char &&
      fenceRun.length >= openFence.length
    ) {
      openFence = null;
    }
  }
  return kept.join("\n");
}

export function extractImportPaths(markdown: string): string[] {
  const found: string[] = [];
  // Comments are stripped first, mirroring Claude's pre-parse removal; code
  // regions second, so a commented-out fence cannot leave a block open.
  const scannable = stripCodeRegions(stripHtmlComments(markdown));
  for (const match of scannable.matchAll(IMPORT_TOKEN_PATTERN)) {
    const token = match[1];
    if (token !== undefined) found.push(token);
  }
  return found;
}

function countLines(contents: string): number {
  if (contents.length === 0) return 0;
  const newlineCount = contents.split("\n").length - 1;
  return contents.endsWith("\n") ? newlineCount : newlineCount + 1;
}

// Resolve an import token the way Claude Code documents it
// (https://code.claude.com/docs/en/memory): `@~/...` against the home
// directory, absolute paths as-is, and relative paths "relative to the file
// containing the import" — never against the scan root or working directory.
function resolveImportTarget(importToken: string, importerDir: string): string {
  // os.homedir() honors $HOME on POSIX, which keeps tests hermetic.
  if (importToken.startsWith("~/")) {
    return path.join(os.homedir(), importToken.slice("~/".length));
  }
  if (path.isAbsolute(importToken)) return importToken;
  return path.resolve(importerDir, importToken);
}

/**
 * Walk the always-loaded set: each existing root file, then (recursively) any
 * `@path` import that resolves to a real file relative to the importing
 * file's directory (or via absolute / `@~/` home-relative forms). Missing
 * imports and imports that resolve to directories are silently skipped —
 * Claude Code loads nothing for them, so counting a substitute would inflate
 * the budget with context the model never sees. Counts exclude HTML comments,
 * which Claude strips before injection.
 *
 * Traversal is breadth-first from all roots at hop 0 with a minimum-depth map
 * instead of a first-visit-wins set: a file first reached deep through one
 * root (CLAUDE.md -> @AGENTS.md at hop 1) still expands its own imports from
 * its shallowest depth (AGENTS.md as a hop-0 root), so the documented
 * MAX_IMPORT_HOPS budget is applied per shortest path. Cycle-safe because a
 * revisit at an equal-or-deeper hop count is dropped.
 */
export function collectAlwaysLoadedFiles(root: string): ContextBudgetFileInput[] {
  const minHops = new Map<string, number>();
  const collected: ContextBudgetFileInput[] = [];
  const importsByPath = new Map<string, readonly string[]>();

  const shouldVisit = (resolved: string, hops: number): boolean => {
    const known = minHops.get(resolved);
    // Already collected: only re-expand when this path is strictly shallower.
    if (known !== undefined) return known > hops;
    return existsSync(resolved) && statSync(resolved).isFile();
  };

  const loadCountedFile = (resolved: string): readonly string[] => {
    const contents = stripHtmlComments(readFileSync(resolved, "utf8"));
    collected.push({
      path: path.relative(root, resolved) || path.basename(resolved),
      bytes: Buffer.byteLength(contents, "utf8"),
      lines: countLines(contents),
    });
    return extractImportPaths(contents);
  };

  const queue: { readonly file: string; readonly hops: number }[] = ALWAYS_LOADED_ROOT_FILES.map(
    (rootFile) => ({ file: path.join(root, rootFile), hops: 0 }),
  );
  for (let head = 0; head < queue.length; head += 1) {
    // queue.at() narrows without a non-null assertion; head is always in range.
    const entry = queue.at(head);
    if (entry === undefined) break;
    const resolved = path.resolve(entry.file);
    if (!shouldVisit(resolved, entry.hops)) continue;
    if (!importsByPath.has(resolved)) importsByPath.set(resolved, loadCountedFile(resolved));
    minHops.set(resolved, entry.hops);
    if (entry.hops >= MAX_IMPORT_HOPS) continue;
    for (const importToken of importsByPath.get(resolved) ?? []) {
      queue.push({
        file: resolveImportTarget(importToken, path.dirname(resolved)),
        hops: entry.hops + 1,
      });
    }
  }
  return collected;
}

export function buildContextBudgetReport(
  files: readonly ContextBudgetFileInput[],
): ContextBudgetReport {
  const withTokens = files.map((file) => ({
    ...file,
    estimatedTokens: estimateTokens(file.bytes),
  }));
  return {
    files: withTokens,
    totals: {
      files: withTokens.length,
      lines: withTokens.reduce((sum, file) => sum + file.lines, 0),
      bytes: withTokens.reduce((sum, file) => sum + file.bytes, 0),
      estimatedTokens: withTokens.reduce((sum, file) => sum + file.estimatedTokens, 0),
    },
  };
}

export function formatText(report: ContextBudgetReport): string {
  if (report.files.length === 0) {
    return [
      "context-budget: no always-loaded context files found",
      `  (looked for ${ALWAYS_LOADED_ROOT_FILES.join(", ")} at the scan root)`,
    ].join("\n");
  }
  const lines = ["context-budget: always-loaded per-session context (report-only)"];
  for (const file of report.files) {
    lines.push(
      `  ${file.path}: ${String(file.lines)} lines, ${String(file.bytes)} bytes, ~${String(file.estimatedTokens)} tokens`,
    );
  }
  const { totals } = report;
  lines.push(
    `context-budget total: ${String(totals.files)} file(s), ${String(totals.lines)} lines, ${String(totals.bytes)} bytes, ~${String(totals.estimatedTokens)} tokens (estimate: bytes/${String(CHARS_PER_TOKEN_ESTIMATE)})`,
  );
  return lines.join("\n");
}

function usage(): string {
  return [
    "Usage:",
    "  bun run sensor:context-budget [--root <dir>] [--json]",
    "",
    "Sums the always-loaded per-session context (root CLAUDE.md, AGENTS.md,",
    "and their @-imports): lines, bytes, and an estimated token total.",
    "Report-only governance figure; always exits 0 on a successful scan.",
  ].join("\n");
}

export type RunContextBudgetOptions = {
  readonly argv: readonly string[];
};

export type ContextBudgetRunResult = {
  readonly exitCode: number;
  readonly stdout: string;
};

type ParsedArgs = { readonly root: string; readonly json: boolean };

function parseArgs(argv: readonly string[]): ParsedArgs | "help" | { readonly error: string } {
  let root = process.cwd();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (HELP_FLAGS.has(arg)) return "help";
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--root") {
      const value = argv[index + 1];
      if (value === undefined) return { error: "--root requires a directory argument." };
      root = value;
      index += 1;
      continue;
    }
    return { error: `unknown argument: ${arg}` };
  }
  return { root, json };
}

export function runContextBudget(options: RunContextBudgetOptions): ContextBudgetRunResult {
  const parsed = parseArgs(options.argv);
  if (parsed === "help") return { exitCode: 0, stdout: usage() };
  if ("error" in parsed) {
    return {
      exitCode: EXIT_TOOL_ERROR,
      stdout: `sensor:context-budget: ${parsed.error}\n${usage()}`,
    };
  }
  let report: ContextBudgetReport;
  try {
    report = buildContextBudgetReport(collectAlwaysLoadedFiles(parsed.root));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: EXIT_TOOL_ERROR, stdout: `sensor:context-budget: scan failed: ${message}` };
  }
  return {
    exitCode: 0,
    stdout: parsed.json ? JSON.stringify(report, null, JSON_INDENT) : formatText(report),
  };
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isCliEntrypoint()) {
  const result = runContextBudget({ argv: process.argv.slice(PROCESS_ARGV_USER_ARGS_START) });
  if (result.stdout) console.log(result.stdout);
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
