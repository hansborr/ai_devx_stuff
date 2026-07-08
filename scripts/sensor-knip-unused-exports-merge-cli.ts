import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { mergeBaseline } from "./lib/baseline/merge.js";
import { knipUnusedExportsSpec } from "./sensor-knip-unused-exports-baseline.js";

const usageErrorExitCode = 2;
const nodeArgvUserArgumentOffset = 2;

function usage(): string {
  return "usage: bun scripts/sensor-knip-unused-exports-merge-cli.ts <base> <current> <other> [path] [truth-up-marker] [merge-head]";
}

async function writeFileAtomically(path: string, content: string): Promise<void> {
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, content, { flag: "wx" });
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function writePostMergeTruthUpMarker(
  markerPath: string | undefined,
  mergeHeadSha: string | undefined,
  postMergeTruthUpRequired: boolean,
): Promise<void> {
  if (!postMergeTruthUpRequired || markerPath === undefined || markerPath.length === 0) return;
  const mergeHeadLine =
    mergeHeadSha === undefined || mergeHeadSha.length === 0 ? "" : `merge-head=${mergeHeadSha}\n`;
  await writeFileAtomically(
    markerPath,
    `knip unused-exports baseline semantic merge requires post-merge truth-up\n${mergeHeadLine}`,
  );
}

export async function runKnipUnusedExportsMergeCli(argv: readonly string[]): Promise<number> {
  const [basePath, currentPath, otherPath, path, truthUpMarkerPath, mergeHeadSha, unexpected] =
    argv;
  if (
    basePath === undefined ||
    currentPath === undefined ||
    otherPath === undefined ||
    unexpected !== undefined
  ) {
    console.error(usage());
    return usageErrorExitCode;
  }

  const [baseText, currentText, otherText] = await Promise.all([
    readFile(basePath, "utf8"),
    readFile(currentPath, "utf8"),
    readFile(otherPath, "utf8"),
  ]);
  const result = mergeBaseline(knipUnusedExportsSpec, { baseText, currentText, otherText });
  if (result.mergedText === undefined) {
    const displayPath = path ?? currentPath;
    console.error(`knip unused-exports baseline semantic merge could not resolve ${displayPath}:`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    return 1;
  }

  await writePostMergeTruthUpMarker(
    truthUpMarkerPath,
    mergeHeadSha,
    result.postMergeTruthUpRequired,
  );
  await writeFileAtomically(currentPath, result.mergedText);
  return 0;
}

if (import.meta.main) {
  runKnipUnusedExportsMergeCli(process.argv.slice(nodeArgvUserArgumentOffset))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`knip unused-exports baseline semantic merge failed: ${message}`);
      process.exitCode = 1;
    });
}
