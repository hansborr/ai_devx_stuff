// Deterministic renderers for the registration explain report. Text and JSON
// are projections of the same report object, so the two formats cannot drift:
// every value the JSON envelope carries appears verbatim in the text lines.
// An empty result renders an explicit authoritative-empty statement rather
// than silence.

import type {
  ExplainMatch,
  ExplainReport,
  ExplainSlotSummary,
  ExplainSmokeSelection,
} from "./registration-explain-model.js";

const JSON_INDENT = 2;

export function renderExplainJson(report: ExplainReport): string {
  return JSON.stringify(report, undefined, JSON_INDENT);
}

function slotLine(slot: ExplainSlotSummary): string {
  const dynamic = slot.dynamic === undefined ? "" : ` dynamic ${slot.dynamic}`;
  const condition = slot.condition === undefined ? "" : ` condition: ${slot.condition}`;
  return `  verify slot: ${slot.consumer} ${slot.name} (script ${slot.script})${dynamic}${condition}`;
}

function smokeLine(smoke: ExplainSmokeSelection): string {
  return smoke.subject === undefined
    ? `  smoke test: ${smoke.test}`
    : `  smoke test: ${smoke.test} (subject ${smoke.subject})`;
}

function controlLines(match: ExplainMatch): readonly string[] {
  if (match.control === undefined) return [];
  const control = match.control;
  return [
    `  control: ${control.id} (${control.kind})`,
    `  source: ${control.source}`,
    `  invocation: ${control.invocation}`,
    ...(control.script === undefined ? [] : [`  script: ${control.script}`]),
    ...(control.pairedGuide === undefined ? [] : [`  paired guide: ${control.pairedGuide}`]),
  ];
}

function generatedLines(match: ExplainMatch): readonly string[] {
  if (match.generated === undefined) return [];
  const generated = match.generated;
  return [
    `  generated check script: ${generated.checkScript}`,
    `  generated refresh script: ${generated.refreshScript}`,
    `  generated trigger paths: ${generated.triggerPaths.join(", ")}`,
    `  generated output paths: ${generated.outputPaths.join(", ")}`,
    ...(generated.fixturePaths.length === 0
      ? []
      : [`  generated fixture paths: ${generated.fixturePaths.join(", ")}`]),
  ];
}

function hookLines(match: ExplainMatch): readonly string[] {
  if (match.hook === undefined) return [];
  const parts = [
    ...(match.hook.event === undefined ? [] : [`event ${match.hook.event}`]),
    ...(match.hook.surface === undefined ? [] : [`surface ${match.hook.surface}`]),
    ...(match.hook.body === undefined ? [] : [`body ${match.hook.body}`]),
  ];
  return [`  hook: ${parts.join(", ")}`];
}

function relationLines(match: ExplainMatch): readonly string[] {
  return [
    ...(match.slot === undefined ? [] : [slotLine(match.slot)]),
    ...(match.verifySlots ?? []).map(slotLine),
    ...(match.smoke === undefined ? [] : [smokeLine(match.smoke)]),
    ...(match.smokeSelections ?? []).map(smokeLine),
  ];
}

function renderMatch(match: ExplainMatch): readonly string[] {
  return [
    `- ${match.reason}: ${match.matched}`,
    ...controlLines(match),
    ...(match.packageScript === undefined
      ? []
      : [`  package script: ${match.packageScript.name}: ${match.packageScript.command}`]),
    ...generatedLines(match),
    ...hookLines(match),
    ...relationLines(match),
  ];
}

export function renderExplainText(report: ExplainReport): string {
  const lines: string[] = [
    `harness:registration:check explain (format ${String(report.explainVersion)})`,
    `selector: ${report.selector.kind} ${report.selector.value}`,
    `matches: ${String(report.matches.length)}`,
  ];
  if (report.matches.length === 0) {
    lines.push(
      "no registered relations: this is an authoritative empty result over the live registration state",
    );
  }
  for (const match of report.matches) lines.push(...renderMatch(match));
  return lines.join("\n");
}
