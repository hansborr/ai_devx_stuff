import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sortImportBlocks } from "./codemod-imports.js";

export type WritePlan = {
  path: string;
  text: string;
};

function runEslintImportFix(codemodName: string, root: string, filePaths: string[]): boolean {
  if (!existsSync(path.join(root, "eslint.config.js"))) return true;
  const relativeFiles = filePaths.map((filePath) => path.relative(root, filePath));
  const result = spawnSync(
    "bun",
    [
      "eslint",
      "--fix",
      "--fix-type",
      "layout",
      "--rule",
      "simple-import-sort/imports:error",
      "--rule",
      "simple-import-sort/exports:error",
      ...relativeFiles,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (!result.error && result.status === 0) return true;
  const details = [result.error?.message, result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  const detailSuffix = details ? `\n${details}` : "";
  console.warn(`${codemodName} codemod: eslint import fix failed.${detailSuffix}`);
  return false;
}

/**
 * Normalize every plan once before either reporting or writing it. Real writes
 * then receive an optional ESLint layout post-pass; a successful post-pass is
 * the only policy that may make written bytes differ from the dry-run plan.
 */
export function writeOrPreviewFiles(
  codemodName: string,
  root: string,
  plans: WritePlan[],
  dryRun: boolean,
): void {
  const normalizedPlans = plans.map((plan) => ({
    path: plan.path,
    text: sortImportBlocks(plan.text, plan.path),
  }));
  if (dryRun) {
    for (const plan of normalizedPlans) {
      console.log(
        `${codemodName} codemod: dry-run would write ${path.relative(root, plan.path)} (${String(plan.text.length)} bytes).`,
      );
    }
    return;
  }
  for (const plan of normalizedPlans) {
    mkdirSync(path.dirname(plan.path), { recursive: true });
    writeFileSync(plan.path, plan.text);
  }
  const eslintFixSucceeded = runEslintImportFix(
    codemodName,
    root,
    normalizedPlans.map((plan) => plan.path),
  );
  if (!eslintFixSucceeded) {
    for (const plan of normalizedPlans) writeFileSync(plan.path, plan.text);
  }
}
