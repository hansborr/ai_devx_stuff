import { CodemodError } from "../lib/codemod-errors.js";
import { createProject } from "../lib/codemod-project.js";
import { normalizeRelativePath, parseArgs } from "./cli.js";
import { CODEMOD_NAME } from "./constants.js";
import { discoverFiles } from "./paths.js";
import { scanFile } from "./scanner.js";
import type { CliArgs, ConcurrencyGuardCodemodArgs, Finding } from "./types.js";

function printFindings(findings: Finding[]): void {
  for (const finding of findings) {
    console.log(
      `${finding.file}:${String(finding.line)} ${finding.target}/${finding.category} ${finding.verdict} ${finding.message} Suggestion: ${finding.suggestion}`,
    );
  }
}

function runScan(args: CliArgs, root: string): Finding[] {
  const targets =
    args.mode === "single" ? [normalizeRelativePath(root, args.file)] : discoverFiles(root);
  const project = createProject();
  const findings: Finding[] = [];
  for (const relativePath of targets) findings.push(...scanFile(project, root, relativePath));
  return findings.sort((left, right) => {
    const fileOrder = left.file.localeCompare(right.file, "en");
    if (fileOrder !== 0) return fileOrder;
    return left.line - right.line;
  });
}

export function runConcurrencyGuardCodemod(
  args: ConcurrencyGuardCodemodArgs,
  root = process.cwd(),
): void {
  const parsed = parseArgs(args);
  const findings = runScan(parsed, root);
  if (findings.length === 0) {
    console.log(
      `${CODEMOD_NAME} scanner: no name-based concurrency guard findings; one-hop aliases and destructuring are included, while deeper indirection still needs manual review.`,
    );
    return;
  }
  printFindings(findings);
  const errorCount = findings.filter((finding) => finding.verdict === "ERROR").length;
  if (errorCount > 0) {
    throw new CodemodError(CODEMOD_NAME, `found ${String(errorCount)} concurrency guard error(s).`);
  }
}
