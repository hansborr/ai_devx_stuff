// Pins the .husky/pre-push near-duplicates boundary trigger to the scanner's
// real extension truth. The hook's changed-path regex decides whether a push
// pays the whole-tree --check-baseline scan; the scanner walks
// buildSourceExtensions(BUILT_IN_SOURCE_EXTENSIONS + drift-ai.config.json
// additionalSourceExtensions). The two were previously coupled by a comment
// only, so an extension added in scope.ts or the config would silently stop
// triggering the boundary scan. harness:check runs this pin so that drift
// fails loudly with the exact alternation to paste.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildSourceExtensions } from "../drift-ai/scope.js";

const PRE_PUSH_HOOK_PATH = ".husky/pre-push";
// Anchors the near-duplicates boundary trigger line inside the hook; the
// extension alternation lives on the same grep -qE line. The alternative
// class mirrors the scanner's validation (buildSourceExtensions accepts any
// non-empty extension, e.g. `.foo-bar` or `.c++`), so the pattern accepts any
// parenthesis-free alternation body rather than an alphanumeric allowlist.
const TRIGGER_ANCHOR = String.raw`(sensor-near-duplicates\.baseline|drift-ai\.config)\.json`;
const ALTERNATION_PATTERN = /\\\.\(([^()]+)\)\$/u;

// grep -qE metacharacters that need escaping when an extension is embedded in
// the hook's ERE alternation (e.g. `.c++` -> `c\+\+`).
const ERE_METACHARACTERS = /[.*+?^$|(){}[\]\\]/gu;

function escapeExtendedRegExp(value: string): string {
  return value.replace(ERE_METACHARACTERS, String.raw`\$&`);
}

function unescapeExtendedRegExp(value: string): string {
  return value.replace(/\\(.)/gu, "$1");
}

function triggerNotFoundFailure(): string {
  return (
    `${PRE_PUSH_HOOK_PATH}: could not locate the near-duplicates boundary trigger ` +
    String.raw`alternation (a grep -qE line matching both '${TRIGGER_ANCHOR}' and '\.(<ext>|...)$'). ` +
    "If the trigger was refactored, update scripts/harness/pre-push-scope-pin.ts to match."
  );
}

export function parsePrePushTriggerExtensions(hookText: string): readonly string[] | null {
  for (const line of hookText.split(/\r?\n/u)) {
    if (!line.includes(TRIGGER_ANCHOR)) continue;
    const match = ALTERNATION_PATTERN.exec(line);
    if (match?.[1] !== undefined) {
      return match[1].split("|").map((alternative) => `.${unescapeExtendedRegExp(alternative)}`);
    }
  }
  return null;
}

export function prePushScopePinFailures(
  hookText: string,
  scannerExtensions: ReadonlySet<string>,
): readonly string[] {
  const hookExtensions = parsePrePushTriggerExtensions(hookText);
  if (hookExtensions === null) return [triggerNotFoundFailure()];

  const hookSet = new Set(hookExtensions);
  const missing = [...scannerExtensions].filter((extension) => !hookSet.has(extension));
  const extra = hookExtensions.filter((extension) => !scannerExtensions.has(extension));
  if (missing.length === 0 && extra.length === 0) return [];

  const expectedAlternation = [...scannerExtensions]
    .map((extension) => escapeExtendedRegExp(extension.replace(/^\./u, "")))
    .join("|");
  const details = [
    ...(missing.length > 0 ? [`missing from the hook trigger: ${missing.join(", ")}`] : []),
    ...(extra.length > 0 ? [`no longer scanned but still triggering: ${extra.join(", ")}`] : []),
  ].join("; ");
  return [
    `${PRE_PUSH_HOOK_PATH}: near-duplicates boundary trigger is out of sync with the scanner's ` +
      `source extensions (BUILT_IN_SOURCE_EXTENSIONS in scripts/drift-ai/scope.ts plus ` +
      `drift-ai.config.json additionalSourceExtensions): ${details}. Update the alternation to ` +
      String.raw`\.(${expectedAlternation})$`,
  ];
}

// Reads additionalSourceExtensions straight from drift-ai.config.json instead
// of importing loadDriftAiConfig: the full config module drags ~35 drift-ai
// files into harness-check's fixture import closure for one array. Lenient by
// design — non-string entries are dropped here because a malformed config
// fails the sensor itself long before this pin matters; buildSourceExtensions
// applies the same trim/lowercase/dot normalization the scanner uses.
function readAdditionalSourceExtensions(repoRoot: string): readonly string[] {
  const configPath = join(repoRoot, "drift-ai.config.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null) return [];
  const additional = (raw as Record<string, unknown>)["additionalSourceExtensions"]; // type-assertion-boundary: json - narrowing parsed config JSON after the object guard above
  if (!Array.isArray(additional)) return [];
  return additional.filter((value): value is string => typeof value === "string");
}

export function checkPrePushScopePin(repoRoot: string): readonly string[] {
  let hookText: string;
  try {
    hookText = readFileSync(join(repoRoot, PRE_PUSH_HOOK_PATH), "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`${PRE_PUSH_HOOK_PATH} could not be read: ${message}`];
  }

  const scannerExtensions = buildSourceExtensions(readAdditionalSourceExtensions(repoRoot));
  return prePushScopePinFailures(hookText, scannerExtensions);
}
