export type TextFinding = {
  readonly check: string;
  readonly file: string;
  readonly message: string;
  readonly hint?: string;
  readonly provenance?: {
    readonly configSource: string;
  };
};

export function formatFindingLines(finding: TextFinding): readonly string[] {
  const tag = finding.provenance === undefined ? "" : ` [${finding.provenance.configSource}]`;
  const lines = [`WARN ${finding.check}: ${finding.file} — ${finding.message}${tag}`];
  if (finding.hint) lines.push(`  FIX: ${finding.hint}`);
  return lines;
}
