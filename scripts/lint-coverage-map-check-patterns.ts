import type { PathPattern, TableRow } from "./lint-coverage-map-check-types.js";

const PATH_COLUMN = 0;
const NORMAL_LINT_COLUMN = 2;
const RATCHET_COLUMN = 3;
const STATUS_COLUMN = 6;
const CODE_SPAN_PATTERN = /`([^`]+)`/gu;
const GLOB_META_PATTERN = /[*?{]/u;
const DUPLICATE_EXTENSION_PATTERN = /\.([A-Za-z0-9]+)\.\1$/u;
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
const ROOT_PATH_PREFIXES = new Set(["packages", "scripts", "docs", "e2e", "eslint-rules"]);
const GLOBSTAR_WIDTH = 2;
const GLOBSTAR_WITH_SLASH_WIDTH = 3;

export function parseRows(mapText: string): TableRow[] {
  const rows: TableRow[] = [];
  const lines = mapText.split(/\r?\n/u);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/u, "")
      .replace(/\|$/u, "")
      .split("|")
      .map((cell) => cell.trim());
    const pathGroup = cells[PATH_COLUMN];
    const ratchets = cells[RATCHET_COLUMN];
    const status = cells[STATUS_COLUMN];
    if (pathGroup === undefined || ratchets === undefined || status === undefined) continue;
    if (pathGroup === "Path / group") continue;
    if (cells.every((cell) => /^:?-{3,}:?$/u.test(cell))) continue;
    const normalLint = cells[NORMAL_LINT_COLUMN] ?? "";
    rows.push({ line: index + 1, pathGroup, normalLint, ratchets, status });
  }
  return rows;
}

function stableBaseForPattern(pattern: string): string {
  const slashIndex = pattern.lastIndexOf("/");
  if (slashIndex < 0) return "";
  const beforeLast = pattern.slice(0, slashIndex);
  const globIndex = beforeLast.search(GLOB_META_PATTERN);
  const stable = globIndex < 0 ? beforeLast : beforeLast.slice(0, globIndex);
  return stable.replace(/\/$/u, "");
}

function shouldUpdateBase(pattern: string, base: string): boolean {
  if (base === "") return false;
  if (!pattern.includes("**")) return true;
  return base.split("/").length > 1;
}

function sourceIsRooted(source: string): boolean {
  if (source.startsWith(".") || !source.includes("/")) return true;
  return ROOT_PATH_PREFIXES.has(source.split("/", 1)[0] ?? "");
}

function resolvePatternSource(source: string, base: string): string {
  if (
    base !== "" &&
    !source.startsWith(".") &&
    source !== "bunfig.toml" &&
    (!source.includes("/") || !sourceIsRooted(source))
  )
    return `${base}/${GLOB_META_PATTERN.test(source) ? "**/" : ""}${source}`;
  return !source.includes("/") && GLOB_META_PATTERN.test(source) ? `**/${source}` : source;
}

export function extractPathPatterns(row: TableRow): PathPattern[] {
  const patterns: PathPattern[] = [];
  let base = "";
  for (const match of row.pathGroup.matchAll(CODE_SPAN_PATTERN)) {
    const rawSource = match[1];
    if (rawSource === undefined) continue;
    const source = rawSource.trim();
    if (source === "") continue;
    const pattern = resolvePatternSource(source, base);
    patterns.push({ line: row.line, source, pattern, matcher: createMatcher(pattern) });
    const nextBase = stableBaseForPattern(pattern);
    if ((!source.includes("/") || sourceIsRooted(source)) && shouldUpdateBase(pattern, nextBase))
      base = nextBase;
  }
  return patterns;
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  const close = pattern.indexOf("}", open + 1);
  if (close < 0) return [pattern];
  const before = pattern.slice(0, open);
  const after = pattern.slice(close + 1);
  const variants: string[] = [];
  for (const part of pattern.slice(open + 1, close).split(",")) {
    variants.push(...expandBraces(`${before}${part}${after}`));
  }
  return variants;
}

function normalizePatternVariants(pattern: string): string[] {
  const variants = new Set<string>();
  for (const expanded of expandBraces(pattern)) {
    variants.add(expanded);
    variants.add(expanded.replace(DUPLICATE_EXTENSION_PATTERN, ".$1"));
  }
  return [...variants];
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/u.test(char) ? `\\${char}` : char;
}

function globVariantToRegExp(pattern: string): RegExp {
  let regex = "";
  for (let index = 0; index < pattern.length; ) {
    const char = pattern.charAt(index);
    const next = pattern.charAt(index + 1);
    const afterNext = pattern.charAt(index + GLOBSTAR_WIDTH);
    if (char === "*" && next === "*" && afterNext === "/") {
      regex += "(?:.*/)?";
      index += GLOBSTAR_WITH_SLASH_WIDTH;
    } else if (char === "*" && next === "*") {
      regex += ".*";
      index += GLOBSTAR_WIDTH;
    } else if (char === "*") {
      regex += "[^/]*";
      index += 1;
    } else if (char === "?") {
      regex += "[^/]";
      index += 1;
    } else {
      regex += escapeRegexChar(char);
      index += 1;
    }
  }
  return new RegExp(`^${regex}$`, "u");
}

function createMatcher(pattern: string): (file: string) => boolean {
  const regexes = normalizePatternVariants(pattern).map(globVariantToRegExp);
  return (file) => regexes.some((regex) => regex.test(file));
}

export function trackedFileIsInScope(file: string): boolean {
  if (GENERATED_DIR_PATTERN.test(file)) return false;
  if (file === "Dockerfile" || file.endsWith("/Dockerfile")) return true;
  if (file.startsWith(".husky/") && !file.startsWith(".husky/_/")) return true;
  const slashIndex = file.lastIndexOf("/");
  const basename = slashIndex < 0 ? file : file.slice(slashIndex + 1);
  if (TRACKED_BASENAMES.has(basename)) return true;
  return TRACKED_EXTENSION_PATTERN.test(file);
}
