import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// Same-directory rename is atomic on the POSIX filesystems this harness supports.
export interface AtomicWriteSyncDeps {
  readonly writeFileSync: (
    path: string,
    content: string,
    options: { readonly flag: "wx"; readonly mode?: number },
  ) => void;
  readonly renameSync: (from: string, to: string) => void;
  readonly rmSync: (path: string, options: { readonly force: true }) => void;
}

export interface AtomicWriteSyncOptions {
  readonly mode?: number;
}

const defaultSyncDeps: AtomicWriteSyncDeps = {
  writeFileSync,
  renameSync,
  rmSync,
};

function temporaryPath(path: string): string {
  return join(dirname(path), `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`);
}

export function writeFileAtomicallySync(
  path: string,
  content: string,
  options: AtomicWriteSyncOptions = {},
  deps: AtomicWriteSyncDeps = defaultSyncDeps,
): void {
  const tempPath = temporaryPath(path);
  try {
    const writeOptions =
      options.mode === undefined
        ? { flag: "wx" as const }
        : { flag: "wx" as const, mode: options.mode };
    deps.writeFileSync(tempPath, content, writeOptions);
    deps.renameSync(tempPath, path);
  } finally {
    deps.rmSync(tempPath, { force: true });
  }
}

export async function writeFileAtomically(path: string, content: string): Promise<void> {
  const tempPath = temporaryPath(path);
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
