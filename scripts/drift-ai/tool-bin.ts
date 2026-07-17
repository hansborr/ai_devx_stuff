import { existsSync } from "node:fs";
import path from "node:path";

type ToolBinSource = "tools-checkout" | "target-repo" | "override";

export type ToolBinResolution =
  | { readonly found: true; readonly binPath: string; readonly source: ToolBinSource }
  | { readonly found: false; readonly searched: readonly string[] };

export type ToolBinConfig = {
  readonly toolName: string;
  readonly binRelativePath?: string;
  readonly moduleDir: string;
};

export type ResolveToolBinOptions = {
  // Subprocess cwd / target repo being scanned; its node_modules is the
  // secondary lookup. Defaults to process.cwd().
  readonly analyzedRepoRoot?: string;
  // Explicit --<tool>-bin path; authoritative when supplied.
  readonly override?: string;
  // Directory this module lives in; overridable for tests. Production callers
  // leave it defaulted so the tools checkout is found regardless of cwd.
  readonly moduleDir?: string;
  // Injected existence check (the fs seam) so resolution is testable with a fake.
  readonly fileExists?: (candidate: string) => boolean;
};

type ResolvedToolBinInput = {
  readonly analyzedRepoRoot: string;
  readonly binRelativePath: string;
  readonly fileExists: (candidate: string) => boolean;
  readonly moduleDir: string;
  readonly override: string | undefined;
};

// Resolve a tool executable. An explicit operator override (e.g. --jscpd-bin) is
// authoritative: when supplied it is the only candidate, and a missing override
// resolves to not-found rather than silently substituting a checkout bin — the
// same explicit-override precedence as the Semgrep and Dolos runners, with this
// helper's checked not-found reporting. Without an override, the tools checkout
// is searched before the target repo, preserving the portable-adapter contract:
// targets do not have to install drift:ai's tool dependencies.
export function resolveToolBin(
  config: ToolBinConfig,
  options: ResolveToolBinOptions = {},
): ToolBinResolution {
  return resolveToolBinCandidates({
    analyzedRepoRoot: options.analyzedRepoRoot ?? process.cwd(),
    binRelativePath: config.binRelativePath ?? path.join("node_modules", ".bin", config.toolName),
    fileExists: options.fileExists ?? existsSync,
    moduleDir: options.moduleDir ?? config.moduleDir,
    override: options.override,
  });
}

function resolveToolBinCandidates(input: ResolvedToolBinInput): ToolBinResolution {
  if (input.override !== undefined) {
    if (input.fileExists(input.override)) {
      return { found: true, binPath: input.override, source: "override" };
    }
    // The operator named a specific binary; reporting not-found (searched lists
    // only the override) keeps the skip reason accurate instead of scanning with
    // a different executable than the one they asked for.
    return { found: false, searched: [input.override] };
  }

  const searched: string[] = [];

  for (const candidate of toolsCheckoutBinPaths(input.moduleDir, input.binRelativePath)) {
    searched.push(candidate);
    if (input.fileExists(candidate)) {
      return { found: true, binPath: candidate, source: "tools-checkout" };
    }
  }

  const targetBin = path.join(input.analyzedRepoRoot, input.binRelativePath);
  searched.push(targetBin);
  if (input.fileExists(targetBin))
    return { found: true, binPath: targetBin, source: "target-repo" };

  return { found: false, searched };
}

// Candidate locations for a tools-checkout-owned file: `binRelativePath` joined
// onto `moduleDir` and each of its ancestors. Exported so adapters whose
// fallback differs from resolveToolBin (e.g. the Semgrep runner falls back to
// `semgrep` on PATH rather than the target repo) can reuse the same upward walk.
export function toolsCheckoutBinPaths(moduleDir: string, binRelativePath: string): string[] {
  const candidates: string[] = [];
  let dir = moduleDir;
  for (;;) {
    candidates.push(path.join(dir, binRelativePath));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates;
}
