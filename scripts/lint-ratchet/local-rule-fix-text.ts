import type { RuleDocsEntry } from "../lib/lint-rule-docs.js";
import { isObjectLike } from "../lib/records.js";

const HOW_TO_FIX_MARKER = "How to fix: ";
const DEFAULT_LOCAL_RULE_FIX = "Resolve this local lint finding.";

export interface LocalRuleMessageForFix {
  readonly message: string;
  readonly suggestions?: readonly unknown[];
}

function fixTextFromMessage(message: string): string | undefined {
  if (!message.startsWith("Why: ")) return undefined;
  const idx = message.indexOf(HOW_TO_FIX_MARKER);
  if (idx === -1) return undefined;
  const tail = message.slice(idx + HOW_TO_FIX_MARKER.length).trim();
  return tail.length > 0 ? tail : undefined;
}

function wholeMessageFallback(message: string): string | undefined {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function appendPairedGuide(text: string, entry: RuleDocsEntry): string {
  if (entry.pairedGuide === "none") return text;
  if (text.includes(entry.pairedGuide)) return text;
  const trimmed = text.trim();
  const separator = /[.!?]$/u.test(trimmed) ? " " : ". ";
  return `${trimmed}${separator}See ${entry.pairedGuide}.`;
}

function concreteSuggestionText(message: LocalRuleMessageForFix): string | undefined {
  const suggestions = message.suggestions ?? [];
  if (suggestions.length !== 1) return undefined;
  const suggestion = suggestions[0];
  if (!isObjectLike(suggestion)) return undefined;
  const desc = suggestion.desc;
  if (typeof desc !== "string") return undefined;
  const trimmedDesc = desc.trim();
  if (trimmedDesc.length === 0) return undefined;
  const fix = suggestion.fix;
  if (!isObjectLike(fix)) return undefined;
  const text = fix.text;
  if (typeof text !== "string") return undefined;
  if (text.trim().length === 0) return undefined;
  if (/[\r\n]/u.test(text)) return undefined;
  return `Apply ESLint suggestion "${trimmedDesc}": replace with \`${text}\`.`;
}

function manualFallback(entry: RuleDocsEntry, message: LocalRuleMessageForFix): string {
  const selected =
    fixTextFromMessage(message.message) ??
    wholeMessageFallback(message.message) ??
    DEFAULT_LOCAL_RULE_FIX;
  return appendPairedGuide(selected, entry);
}

export function localRuleMessageHowToFixFor(
  entry: RuleDocsEntry,
  message: LocalRuleMessageForFix,
): string {
  if (entry.repairKind === "codemod") {
    if (entry.repairCommand === undefined) {
      throw new Error(`Rule ${entry.id} declares repairKind=codemod without a repairCommand`);
    }
    const renderedTail = fixTextFromMessage(message.message);
    if (renderedTail === undefined) return `Run \`${entry.repairCommand}\`.`;
    return renderedTail;
  }
  if (entry.repairKind === "autofix") {
    const renderedTail = fixTextFromMessage(message.message);
    if (renderedTail === undefined) return "Run `bun run lint:fix`.";
    return renderedTail;
  }
  if (entry.repairKind === "suggestion")
    return concreteSuggestionText(message) ?? manualFallback(entry, message);
  return manualFallback(entry, message);
}
