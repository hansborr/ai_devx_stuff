import { pathToFileURL } from "node:url";

// The one shared spelling of the Node/Bun argv layout constant (ready-2026-07
// leaf 16): `process.argv[0]` is the runtime, `process.argv[1]` the entry
// script, so user arguments start at index 2. CLI entry guards slice with this
// constant instead of respelling it (`PROCESS_ARG_OFFSET`,
// `nodeArgvUserArgumentOffset`, ...), which had defeated symbol search for one
// concept. A file being edited for any reason converges its offset; new CLIs
// import it. The remaining bulk sweep is deliberately not scheduled.
export const PROCESS_ARGV_USER_ARGS_START = 2;

const PROCESS_ARGV_ENTRY_SCRIPT = 1;

/**
 * True when the module that owns `importMetaUrl` was run directly rather than
 * imported. `import.meta.url` is per-module, so callers pass their own.
 *
 * This is the plain URL comparison the fourteen former copies all used; it does
 * not resolve symlinks. `classifyScriptEntry` in scripts/lint-ratchet.ts stays
 * separate on purpose — it normalizes with resolve() plus realpath() and returns
 * a tri-state so a symlinked checkout fails loudly instead of silently exiting 0.
 */
export function isCliEntrypoint(importMetaUrl: string): boolean {
  const entry = process.argv[PROCESS_ARGV_ENTRY_SCRIPT];
  if (!entry) return false;
  return importMetaUrl === pathToFileURL(entry).href;
}
