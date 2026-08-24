// Scope policy for the coverage-map drift gate: which tracked files the map is
// required to account for at all. This is deliberately *not* a glob dialect —
// coverage-row membership is matched only by
// `tools/lint-ratchet/src/kernel/ratchet-globs.ts` against the explicit globs in
// the typed manifest. This file answers the prior question of which files enter
// that comparison.
const GENERATED_DIR_PATTERN =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.next|\.bun|\.turbo|\.cache|tmp|temp)(?:\/|$)/u;
const TRACKED_EXTENSION_PATTERN =
  /\.(?:ts|tsx|js|mjs|cjs|json|jsonl|ya?ml|toml|sh|md|prisma|sql|css|html|csv|txt|pdf)$/u;
const TRACKED_BASENAMES = new Set([
  ".blob-size-allowlist",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".prettierignore",
  ".prettierrc",
  ".safety-acknowledged",
  ".worktreeinclude",
  "LICENSE",
  "bun.lock",
]);

export function trackedFileIsInScope(file: string): boolean {
  if (GENERATED_DIR_PATTERN.test(file)) return false;
  if (file === "Dockerfile" || file.endsWith("/Dockerfile")) return true;
  if (file.startsWith(".husky/") && !file.startsWith(".husky/_/")) return true;
  const slashIndex = file.lastIndexOf("/");
  const basename = slashIndex < 0 ? file : file.slice(slashIndex + 1);
  if (TRACKED_BASENAMES.has(basename)) return true;
  return TRACKED_EXTENSION_PATTERN.test(file);
}
