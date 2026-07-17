import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteSyncDeps {
  readonly writeFileSync: (path: string, content: string, options: { readonly flag: "wx" }) => void;
  readonly renameSync: (from: string, to: string) => void;
  readonly rmSync: (path: string, options: { readonly force: true }) => void;
}

const defaultDeps: AtomicWriteSyncDeps = {
  writeFileSync,
  renameSync,
  rmSync,
};

// Same-directory rename is atomic on the POSIX filesystems this harness supports.
export function writeFileAtomicallySync(
  path: string,
  content: string,
  deps: AtomicWriteSyncDeps = defaultDeps,
): void {
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    deps.writeFileSync(tempPath, content, { flag: "wx" });
    deps.renameSync(tempPath, path);
  } finally {
    deps.rmSync(tempPath, { force: true });
  }
}
