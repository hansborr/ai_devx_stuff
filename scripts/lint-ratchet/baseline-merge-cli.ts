import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { mergeLintRatchetBaselines } from "./baseline-merge.js";

const usageErrorExitCode = 2;
const nodeArgvUserArgumentOffset = 2;

function usage(): string {
  return "usage: bun scripts/lint-ratchet/baseline-merge-cli.ts <base> <current> <other> [path]";
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

export async function runBaselineMergeCli(argv: readonly string[]): Promise<number> {
  const [basePath, currentPath, otherPath, path, unexpected] = argv;
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
  const result = mergeLintRatchetBaselines({ baseText, currentText, otherText });
  if (result.mergedText === undefined) {
    const displayPath = path ?? currentPath;
    console.error(`lint-ratchet baseline semantic merge could not resolve ${displayPath}:`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    return 1;
  }

  await writeFileAtomically(currentPath, result.mergedText);
  return 0;
}

if (import.meta.main) {
  runBaselineMergeCli(process.argv.slice(nodeArgvUserArgumentOffset))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`lint-ratchet baseline semantic merge failed: ${message}`);
      process.exitCode = 1;
    });
}
