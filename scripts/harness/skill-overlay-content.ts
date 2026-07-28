import type { FileArtifact } from "./skill-projection-files.js";

interface HarnessBlock {
  readonly before: string;
  readonly block: string;
  readonly after: string;
}

export interface HarnessOverlayContext {
  readonly canonicalHarness: string;
  readonly context: string;
  readonly targetHarness: string;
}

function error(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

function artifactText(artifact: FileArtifact, context: string): string {
  const text = artifact.content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(artifact.content)) {
    error(context, "content overlay file must be valid UTF-8 text");
  }
  return text;
}

function parseHarnessBlock(text: string, context: string, expectedHarness: string): HarnessBlock {
  const begins = [...text.matchAll(/^<!-- BEGIN HARNESS-SPECIFIC: ([^>\r\n]+) -->\r?$/gmu)];
  const ends = [...text.matchAll(/^<!-- END HARNESS-SPECIFIC -->\r?$\n?/gmu)];
  if (begins.length !== 1 || ends.length !== 1) {
    error(context, "must contain exactly one harness-specific BEGIN/END marker pair");
  }
  const begin = begins[0];
  const end = ends[0];
  if (begin === undefined || end === undefined) {
    error(context, "must contain exactly one harness-specific BEGIN/END marker pair");
  }
  const harness = begin[1];
  if (begin.index >= end.index) error(context, "has malformed harness-specific marker ordering");
  if (harness !== expectedHarness) {
    error(context, `harness marker names ${String(harness)}; expected ${expectedHarness}`);
  }
  const endAfter = end.index + end[0].length;
  return {
    before: text.slice(0, begin.index),
    block: text.slice(begin.index, endAfter),
    after: text.slice(endAfter),
  };
}

export function projectHarnessOverlay(
  canonical: FileArtifact,
  target: FileArtifact | undefined,
  overlay: HarnessOverlayContext,
): FileArtifact {
  if (target === undefined) {
    error(overlay.context, "cannot bootstrap harness-block overlay; seed its target block first");
  }
  const canonicalBlock = parseHarnessBlock(
    artifactText(canonical, overlay.context),
    `${overlay.context} canonical`,
    overlay.canonicalHarness,
  );
  const targetBlock = parseHarnessBlock(
    artifactText(target, overlay.context),
    `${overlay.context} target`,
    overlay.targetHarness,
  );
  return {
    content: Buffer.from(canonicalBlock.before + targetBlock.block + canonicalBlock.after),
    mode: canonical.mode,
  };
}

interface FrontmatterField {
  readonly valid: boolean;
  readonly occurrences: number;
  readonly stripped: string;
  readonly authoredEntry?: string;
}

function textLines(text: string): string[] {
  return text.match(/.*(?:\n|$)/gu)?.filter((line) => line !== "") ?? [];
}

function frontmatterEnd(lines: readonly string[]): number {
  if ((lines[0] ?? "").replace(/\r?\n$/u, "") !== "---") return -1;
  return lines.findIndex((line, index) => index > 0 && line.replace(/\r?\n$/u, "") === "---");
}

function fieldStarts(lines: readonly string[], end: number, field: string): number[] {
  const starts: number[] = [];
  for (let index = 1; index < end; index += 1) {
    if (lines[index]?.startsWith(`${field}:`) === true) starts.push(index);
  }
  return starts;
}

function parseFrontmatterField(text: string, field: string): FrontmatterField {
  const lines = textLines(text);
  const end = frontmatterEnd(lines);
  if (end < 1) return { valid: false, occurrences: 0, stripped: text };
  const starts = fieldStarts(lines, end, field);
  if (starts.length !== 1) return { valid: true, occurrences: starts.length, stripped: text };
  const start = starts[0];
  if (start === undefined) return { valid: true, occurrences: 0, stripped: text };
  let finish = start + 1;
  while (finish < end && !/^[\w-]+:/u.test(lines[finish] ?? "")) finish += 1;
  return {
    valid: true,
    occurrences: 1,
    stripped: [...lines.slice(0, start), ...lines.slice(finish)].join(""),
    authoredEntry: lines.slice(start, finish).join(""),
  };
}

function validateFrontmatterSides(
  canonical: FrontmatterField,
  target: FrontmatterField | undefined,
  field: string,
  context: string,
): void {
  if (!canonical.valid) error(context, "canonical file must contain valid frontmatter");
  if (target !== undefined && !target.valid)
    error(context, "target file must contain valid frontmatter");
  if (canonical.occurrences + (target?.occurrences ?? 0) !== 1) {
    error(
      context,
      `frontmatter field ${field} must occur exactly once across canonical and target`,
    );
  }
}

function insertFrontmatterEntry(text: string, entry: string): string {
  const lines = textLines(text);
  const offset = lines.slice(0, frontmatterEnd(lines)).join("").length;
  return text.slice(0, offset) + entry + text.slice(offset);
}

export function projectFrontmatterOverlay(
  canonical: FileArtifact,
  target: FileArtifact | undefined,
  field: string,
  context: string,
): FileArtifact {
  const canonicalField = parseFrontmatterField(artifactText(canonical, context), field);
  const targetField =
    target === undefined ? undefined : parseFrontmatterField(artifactText(target, context), field);
  if (canonicalField.valid && canonicalField.occurrences === 0 && target === undefined) {
    error(
      context,
      `cannot bootstrap target-owned frontmatter field ${field}; seed its value first`,
    );
  }
  validateFrontmatterSides(canonicalField, targetField, field, context);
  if (canonicalField.occurrences === 1) {
    return { content: Buffer.from(canonicalField.stripped), mode: canonical.mode };
  }
  if (targetField?.authoredEntry === undefined) {
    error(
      context,
      `cannot bootstrap target-owned frontmatter field ${field}; seed its value first`,
    );
  }
  return {
    content: Buffer.from(
      insertFrontmatterEntry(canonicalField.stripped, targetField.authoredEntry),
    ),
    mode: canonical.mode,
  };
}
