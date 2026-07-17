import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// Async sibling to scripts/lint-ratchet/atomic-write.ts's writeFileAtomicallySync.
// The three baseline merge CLIs (lint-ratchet, max-lines-exceptions,
// knip-unused-exports) share this one copy instead of each carrying its own.
// Same-directory rename is atomic on the POSIX filesystems this harness supports.
export async function writeFileAtomically(path: string, content: string): Promise<void> {
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

// Write the post-merge truth-up marker the metric's post-merge hook reads.
// `markerMessage` is the per-metric first line (the only text that differs
// between metrics); the pre-merge HEAD stamp line is shared.
export async function writePostMergeTruthUpMarker(
  markerPath: string | undefined,
  preMergeHeadSha: string | undefined,
  postMergeTruthUpRequired: boolean,
  markerMessage: string,
): Promise<void> {
  if (!postMergeTruthUpRequired || markerPath === undefined || markerPath.length === 0) return;
  // The pre-merge HEAD stamp must match HEAD^1 of the completed merge commit.
  // That lets post-merge discard markers leaked by cherry-pick, rebase, or an
  // aborted merge instead of charging the next unrelated merge for the truth-up.
  const preMergeHeadLine =
    preMergeHeadSha === undefined || preMergeHeadSha.length === 0
      ? ""
      : `pre-merge-head=${preMergeHeadSha}\n`;
  await writeFileAtomically(markerPath, `${markerMessage}\n${preMergeHeadLine}`);
}
