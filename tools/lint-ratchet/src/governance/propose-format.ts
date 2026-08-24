import type { LintRatchetWorkflowVocabulary } from "../kernel/engine-context.js";
import type { ProposeSummary, ProposeTopFile } from "./propose.js";

function formatTopFiles(files: readonly ProposeTopFile[]): readonly string[] {
  if (files.length === 0) return ["  (none)"];
  return files.map((file) => `  ${file.path}: ${String(file.count)}`);
}

// A full copy-paste registry entry, so an adopter does not have to guess the
// fields the preview silently fixed (parserProfile, mode, metric) or the
// required-but-unshown `principle`. No `target` (retired from the surface).
function formatPromotableConfig(summary: ProposeSummary): readonly string[] {
  const lines = [
    "  {",
    '    id: "ratchet/<name>",',
    `    ruleId: ${JSON.stringify(summary.ruleId)},`,
  ];
  if (summary.sourceKind === "core") lines.push('    source: { kind: "core" },');
  if (summary.sourceKind === "third-party") {
    lines.push(
      `    source: { kind: "third-party", pluginModule: ${JSON.stringify(summary.pluginModule)} },`,
    );
  }
  lines.push(
    `    parserProfile: ${JSON.stringify(summary.parserProfile ?? "minimal-ts")},`,
    `    files: ${JSON.stringify(summary.files)},`,
    `    ignores: ${JSON.stringify(summary.ignores)},`,
    `    ruleOptions: ${JSON.stringify(summary.ruleOptions)},`,
    '    mode: "no-new",',
    `    metric: ${JSON.stringify(summary.metric)},`,
    '    principle: "<why this floor exists — required, non-empty>",',
    "  },",
  );
  return lines;
}

function formatRequiredAllowlistEntry(summary: ProposeSummary): readonly string[] {
  const entry = summary.requiredAllowlistEntry;
  if (entry === undefined) return [];
  return [
    `required governance addition (add to lintRatchetThirdPartyPluginAllowlist in ${summary.registryHint}):`,
    "  {",
    `    pluginModule: ${JSON.stringify(entry.pluginModule)},`,
    `    ruleNamespace: ${JSON.stringify(entry.ruleNamespace)},`,
    `    pluginExport: ${JSON.stringify(entry.pluginExport ?? "default")},`,
    "  },",
  ];
}

export function formatProposeSummary(
  summary: ProposeSummary,
  workflowVocabulary: LintRatchetWorkflowVocabulary,
): string {
  const lines = [
    `lint:ratchet:propose ${summary.ruleId}`,
    `source: ${summary.sourceKind}`,
    `parser profile: ${summary.parserProfile ?? "minimal-ts"}`,
    `file globs: ${summary.files.join(", ")}`,
    `ignore globs: ${summary.ignores.join(", ")}`,
    `metric: ${summary.metric}`,
    `rule options: ${JSON.stringify(summary.ruleOptions)}`,
    `files with findings: ${String(summary.filesWithFindings)}`,
    `total findings: ${String(summary.totalFindings)}`,
    "top files:",
    ...formatTopFiles(summary.topFiles),
    "would-be baseline:",
    summary.baselineText.trimEnd(),
    ...formatRequiredAllowlistEntry(summary),
    `promotable config (paste into the lintRatchets array in ${summary.registryHint}, fill in id/principle, then run ${workflowVocabulary.updateCommand}):`,
    ...formatPromotableConfig(summary),
  ];
  if (summary.parserProfile === "type-aware-ts") {
    lines.push(
      "note: type-aware-ts uses the TypeScript project service; broad globs can take substantially longer.",
    );
  }
  lines.push("note: ratchet/propose id, configHash, and ruleSourceHash are preview-only.", "");
  return lines.join("\n");
}
