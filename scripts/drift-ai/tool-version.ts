// Shared parser for external-CLI `--version` output (Dolos, Semgrep, and any
// future tool runner). Prototype-lane plumbing only: it does not register a
// drift check. Callers pass the combined `stdout\nstderr` capture; the scanner
// returns the first recognizable semantic version. Parameterized by tool name
// so the per-tool labeled-line boundary is the only thing that varies.

// Semantic version with an optional pre-release/build suffix, e.g. `2.9.3`,
// `1.165.0`, `1.2.3-rc.1`, `1.2.3+build.5`. Defined once and reused for both the
// in-line labeled-banner match and the anchored bare-line match below.
const SEMVER = String.raw`\d+\.\d+\.\d+(?:[-+.][\w.-]+)?`;

const LABELED_VERSION = new RegExp(`(${SEMVER})`, "u");
const BARE_VERSION = new RegExp(`^v?(${SEMVER})$`, "u");

export function parseToolVersionOutput(output: string, toolName: string): string | undefined {
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const version = versionFromLine(trimmed, toolName);
    if (version !== undefined) return version;
  }
  return undefined;
}

function versionFromLine(line: string, toolName: string): string | undefined {
  // `toolName` is a hardcoded literal (not user input), so no escaping concern.
  const toolBoundary = new RegExp(String.raw`\b${toolName}\b`, "iu");
  if (toolBoundary.test(line)) {
    const labeled = LABELED_VERSION.exec(line);
    if (labeled?.[1] !== undefined) return labeled[1];
  }
  // Some tools (e.g. `semgrep --version`) print the bare version on its own line.
  const bare = BARE_VERSION.exec(line);
  return bare?.[1];
}
