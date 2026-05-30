import { existsSync } from "node:fs";
import path from "node:path";

export type ToolBinSource = "tools-checkout" | "target-repo" | "override";

export type ToolBinResolution =
  | { readonly found: true; readonly binPath: string; readonly source: ToolBinSource }
  | { readonly found: false; readonly searched: readonly string[] };

export type ToolBinConfig = {
  readonly toolName: string;
  readonly binRelativePath?: string;
  readonly moduleDir: string;
};

export type ResolveToolBinOptions = {
  readonly analyzedRepoRoot?: string;
  readonly override?: string;
  readonly moduleDir?: string;
  readonly fileExists?: (candidate: string) => boolean;
};

type ResolvedToolBinInput = {
  readonly analyzedRepoRoot: string;
  readonly binRelativePath: string;
  readonly fileExists: (candidate: string) => boolean;
  readonly moduleDir: string;
  readonly override: string | undefined;
};

// Resolve a tools-checkout-owned executable before falling back to the target
// repo and finally an explicit override. This preserves the portable-adapter
// contract: targets do not have to install drift:ai's tool dependencies.
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

  if (input.override !== undefined) {
    searched.push(input.override);
    if (input.fileExists(input.override)) {
      return { found: true, binPath: input.override, source: "override" };
    }
  }

  return { found: false, searched };
}

function toolsCheckoutBinPaths(moduleDir: string, binRelativePath: string): string[] {
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
