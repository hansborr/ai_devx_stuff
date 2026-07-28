export const SKILL_SMOKE_SUBJECTS_BEGIN =
  "# BEGIN GENERATED SKILL SMOKE SUBJECTS (bun run harness:skills:refresh)";
export const SKILL_SMOKE_SUBJECTS_END = "# END GENERATED SKILL SMOKE SUBJECTS";

function markerOccurrences(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

function generatedLines(subjects: readonly string[]): string[] {
  return [
    SKILL_SMOKE_SUBJECTS_BEGIN,
    ...subjects.map((subject) => `# smoke-subjects: ${subject}`),
    SKILL_SMOKE_SUBJECTS_END,
  ];
}

function replaceGeneratedBlock(lines: string[], path: string, subjects: readonly string[]): string {
  const begin = lines.indexOf(SKILL_SMOKE_SUBJECTS_BEGIN);
  const end = lines.indexOf(SKILL_SMOKE_SUBJECTS_END);
  if (begin < 0 || end < begin) {
    throw new Error(`${path}: generated skill smoke-subject marker lines are malformed`);
  }
  lines.splice(begin, end - begin + 1, ...generatedLines(subjects));
  return lines.join("\n");
}

function insertGeneratedBlock(lines: string[], subjects: readonly string[]): string {
  let insertion = lines[0]?.startsWith("#!") === true ? 1 : 0;
  while (/^#\s*smoke-order:/u.test(lines[insertion] ?? "")) insertion += 1;
  lines.splice(insertion, 0, ...generatedLines(subjects));
  return lines.join("\n");
}

export function renderSkillSmokeSubjectBlock(
  source: string,
  path: string,
  subjects: readonly string[],
): string {
  const beginOccurrences = markerOccurrences(source, SKILL_SMOKE_SUBJECTS_BEGIN);
  const endOccurrences = markerOccurrences(source, SKILL_SMOKE_SUBJECTS_END);
  if (beginOccurrences !== endOccurrences || beginOccurrences > 1) {
    throw new Error(`${path}: generated skill smoke-subject markers are malformed or duplicated`);
  }
  const lines = source.split("\n");
  return beginOccurrences === 1
    ? replaceGeneratedBlock(lines, path, subjects)
    : insertGeneratedBlock(lines, subjects);
}
