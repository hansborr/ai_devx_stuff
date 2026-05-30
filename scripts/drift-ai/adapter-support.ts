// Shared support for external-tool adapters (adapter contract §5). An adapter is
// a CheckPlugin whose run delegates to an external tool; these helpers give every
// adapter the same install-detection and config-discovery behavior so the skip
// path (the headline case on a foreign repo) reads consistently.
//
// New I/O goes behind an injected probe with a `default*` factory and is tested
// with a fake, mirroring the existing GitRunner / JscpdRunner / FileReader seams.

import type { PathProbe } from "./repo-io.js";
import type { ConfigSource } from "./types.js";

export { defaultPathProbe, type PathProbe } from "./repo-io.js";

// Whether the target repo has its dependencies installed. The common foreign-repo
// case is an uninstalled target (no node_modules at all); module-graph tools
// (knip, import-x) cannot resolve there, so callers skip with `target-not-installed`
// rather than reporting an untrustworthy result (adapter contract §4/§5). Checks
// the repo-root node_modules, where a hoisted (npm/yarn/bun) or pnpm workspace
// install lands the graph a root-run tool resolves from.
export function detectTargetInstall(pathExists: PathProbe): boolean {
  return pathExists("node_modules");
}

export type DiscoveredToolConfig = {
  readonly path: string;
  readonly configSource: ConfigSource;
};

export type DiscoverToolConfigOptions = {
  // Explicit operator override (ladder rung 1). Highest authority; returned
  // verbatim so the tool resolves it relative to its own cwd, even when it does
  // not exist on disk yet (a bad path surfaces as an attempted-and-failed run,
  // not a silent skip).
  readonly override: string | null;
  // Known target-local config locations, in priority order (ladder rung 2). Must
  // NOT assume repo-root — real targets ship non-root configs (e.g. OpenClaw's
  // config/knip.config.ts).
  readonly candidates: readonly string[];
  readonly fileExists: PathProbe;
};

// Walk ladder rungs 1–2 (adapter contract §2): explicit override, then the first
// existing known location. Returns the resolved config (always `target-config` —
// it is the target's own / operator-chosen ruleset) or null so the caller can
// apply the remaining rungs (a tool-specific fallback such as package.json#tool,
// then the `no-target-config` skip).
export function discoverToolConfig(
  options: DiscoverToolConfigOptions,
): DiscoveredToolConfig | null {
  if (options.override !== null) {
    return { path: options.override, configSource: "target-config" };
  }
  for (const candidate of options.candidates) {
    if (options.fileExists(candidate)) return { path: candidate, configSource: "target-config" };
  }
  return null;
}
