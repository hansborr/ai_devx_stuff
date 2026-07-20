// Pure shim renderers for the hook-wiring generator: derive the on-disk
// adapter shims (`.claude/hooks/`, `.codex/hooks/`, `.copilot/hooks/`) from
// `harness.controls.json` hookWiring entries. Path ownership, per-adapter
// templates, and Copilot dispatch derivation live here as a coherent unit;
// `generate-hook-wiring.ts` owns filesystem write/check plumbing.
//
// Filesystem safety is a design requirement, not a nicety: manifest command
// and body values become write targets here, so this module accepts only the
// exact per-adapter command grammar and rejects traversal, absolute paths,
// shell metacharacters, non-`.sh` names, colliding output paths, and bodies
// outside `scripts/ai-hooks/<safe-name>.sh`.

import { compareByCodepoint } from "../lib/codepoint-compare.js";
import type { HookEvent, HookHarness, HookHarnessCommand } from "./hook-wiring-schema.js";

/** Adapter directories owned (written and reconciled) by the generator. */
export const HOOK_SHIM_DIRS = {
  claude: ".claude/hooks",
  codex: ".codex/hooks",
  copilot: ".copilot/hooks",
} as const satisfies Record<HookHarness, string>;

const SHIM_HARNESS_ORDER = ["claude", "codex", "copilot"] as const satisfies readonly HookHarness[];

/**
 * Single path segment of alphanumerics plus `.`/`_`/`-`, starting with an
 * alphanumeric and ending in `.sh`. No `/` (traversal, nesting), no leading
 * dot, no shell metacharacters.
 */
const SAFE_SHELL_FILE_NAME = /^[A-Za-z0-9][\w.-]*\.sh$/u;

const CANONICAL_BODY_DIR = "scripts/ai-hooks/";

// The two recognized harness command shapes, mirrored from
// scripts/ai-hooks/check-wiring.sh `assert_generated_hook_config`. Anything
// else fails generation instead of guessing a write target.
const CLAUDE_PROJECT_DIR_COMMAND = /^bash \$CLAUDE_PROJECT_DIR\/(?<rel>.+)$/u;
const TOPLEVEL_COMMAND = /^bash "\$\(git rev-parse --show-toplevel\)\/(?<rel>.+)"$/u;

export interface ShimWiringInput {
  readonly controlId: string;
  readonly event: HookEvent;
  readonly body: string;
  readonly harnesses: Readonly<Partial<Record<HookHarness, HookHarnessCommand>>>;
}

export interface RenderedShim {
  readonly harness: HookHarness;
  /** Repo-relative shim path, e.g. `.claude/hooks/doc-length.sh`. */
  readonly relPath: string;
  /** Exact file bytes; the generator byte-compares these in `--check`. */
  readonly content: string;
}

function assertCanonicalBody(body: string, context: string): string {
  if (!body.startsWith(CANONICAL_BODY_DIR)) {
    throw new Error(`${context}.body must live under ${CANONICAL_BODY_DIR}; got: ${body}`);
  }
  const name = body.slice(CANONICAL_BODY_DIR.length);
  if (!SAFE_SHELL_FILE_NAME.test(name)) {
    throw new Error(
      `${context}.body must name a single ${CANONICAL_BODY_DIR}<safe-name>.sh file (no traversal, subdirectories, or shell metacharacters); got: ${body}`,
    );
  }
  return name;
}

function parseCommandRelPath(command: string, context: string): string {
  const match = CLAUDE_PROJECT_DIR_COMMAND.exec(command) ?? TOPLEVEL_COMMAND.exec(command);
  const rel = match?.groups?.rel;
  if (rel === undefined) {
    throw new Error(
      `${context}.command does not match a recognized shim command shape ` +
        `(bash $CLAUDE_PROJECT_DIR/<shim> or bash "$(git rev-parse --show-toplevel)/<shim>"); got: ${command}`,
    );
  }
  return rel;
}

function deriveShimPath(harness: HookHarness, command: string, context: string): string {
  const rel = parseCommandRelPath(command, context);
  const dir = HOOK_SHIM_DIRS[harness];
  if (!rel.startsWith(`${dir}/`)) {
    throw new Error(
      `${context}.command must target the ${harness} adapter directory ${dir}/; got: ${rel}`,
    );
  }
  const name = rel.slice(dir.length + 1);
  if (!SAFE_SHELL_FILE_NAME.test(name)) {
    throw new Error(
      `${context}.command shim name must be a single safe *.sh segment (no traversal, subdirectories, or shell metacharacters); got: ${name}`,
    );
  }
  return rel;
}

type CopilotDispatchSurface = "bash" | "edit";
type CopilotDispatchMode = "pre" | "post-bash" | "post-edit";

interface CopilotDispatch {
  readonly mode: CopilotDispatchMode;
  readonly surface: CopilotDispatchSurface;
}

// Derived, not authored: `surface` from the Copilot matcher and `mode` from
// event + surface. Unknown combinations fail generation (fail closed) — a
// shim must never dispatch into a mode or surface that does not exist in
// scripts/ai-hooks/copilot-adapter.sh `ai_copilot_dispatch`.
function deriveCopilotDispatch(
  event: HookEvent,
  matcher: string | undefined,
  context: string,
): CopilotDispatch {
  if (event === "Stop") {
    throw new Error(
      `${context}: copilot Stop shims cannot be generated: ai_copilot_dispatch ` +
        `(scripts/ai-hooks/copilot-adapter.sh) has no stop mode, so a generated shim would ` +
        `dispatch into a mode that does not exist. Add a Stop mode to the adapter deliberately ` +
        `before wiring a copilot Stop shim.`,
    );
  }
  let surface: CopilotDispatchSurface;
  if (matcher === "bash|powershell") surface = "bash";
  else if (matcher === "create|edit") surface = "edit";
  else {
    throw new Error(
      `${context}.matcher must be "bash|powershell" or "create|edit" to derive the copilot dispatch surface; got: ${matcher ?? "(none)"}`,
    );
  }
  if (event === "PreToolUse") return { mode: "pre", surface };
  if (event === "PostToolUse") {
    return { mode: surface === "edit" ? "post-edit" : "post-bash", surface };
  }
  throw new Error(
    `${context}: no copilot dispatch mode exists for event ${event}; refusing to generate a shim`,
  );
}

// porting-knob: repo-root-fallback -- the /workspace fallbacks rendered into generated shims
const GENERATED_OWNERSHIP_LINES = [
  "# Generated by scripts/harness/generate-hook-wiring.ts from harness.controls.json",
  "# hookWiring entries. Do not edit by hand; regenerate with `bun run harness:wiring`.",
];

function renderExecShim(body: string, repoRootFallback: string): string {
  return [
    "#!/bin/bash",
    ...GENERATED_OWNERSHIP_LINES,
    `# Thin adapter - semantics documented in ${body}.`,
    "",
    "set -u",
    "",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    `REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo ${repoRootFallback})`,
    `exec bash "$REPO_ROOT/${body}"`,
    "",
  ].join("\n");
}

function renderCopilotDispatchShim(body: string, dispatch: CopilotDispatch): string {
  const bodyName = body.slice(CANONICAL_BODY_DIR.length);
  return [
    "#!/bin/bash",
    ...GENERATED_OWNERSHIP_LINES,
    `# Thin adapter - semantics documented in ${body}; Copilot`,
    "# payload/response translation in scripts/ai-hooks/copilot-adapter.sh.",
    "",
    "set -u",
    "",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo /workspace)',
    'HOOK_LIB="$REPO_ROOT/scripts/ai-hooks"',
    "# shellcheck source=/dev/null",
    '. "$HOOK_LIB/common.sh"',
    "# shellcheck source=/dev/null",
    '. "$HOOK_LIB/copilot-adapter.sh"',
    "",
    `ai_copilot_dispatch ${dispatch.mode} ${dispatch.surface} "$HOOK_LIB/${bodyName}"`,
    "",
  ].join("\n");
}

function renderShimContent(
  harness: HookHarness,
  wiring: ShimWiringInput,
  command: HookHarnessCommand,
  context: string,
): string {
  // Lifecycle-event shims are plain exec shims by prior ruling — the template
  // depends only on the adapter, never on the event.
  if (harness === "claude") {
    return renderExecShim(wiring.body, '"${CLAUDE_PROJECT_DIR:-/workspace}"');
  }
  if (harness === "codex") {
    return renderExecShim(wiring.body, "/workspace");
  }
  const dispatch = deriveCopilotDispatch(wiring.event, command.matcher, context);
  return renderCopilotDispatchShim(wiring.body, dispatch);
}

/**
 * Derive every adapter shim for the given hookWiring entries. Each harness
 * association yields exactly one shim confined to that harness's adapter
 * directory; colliding output paths fail generation. Results are sorted by
 * repo-relative path (codepoint order — the bytes are committed and
 * freshness-compared).
 */
export function deriveHookShims(wirings: readonly ShimWiringInput[]): RenderedShim[] {
  const shims = new Map<string, RenderedShim & { readonly controlId: string }>();
  for (const wiring of wirings) {
    assertCanonicalBody(wiring.body, `${wiring.controlId}.hookWiring`);
    for (const harness of SHIM_HARNESS_ORDER) {
      const command = wiring.harnesses[harness];
      if (command === undefined) continue;
      const context = `${wiring.controlId}.hookWiring.harnesses.${harness}`;
      const relPath = deriveShimPath(harness, command.command, context);
      const existing = shims.get(relPath);
      if (existing !== undefined) {
        throw new Error(
          `${context}.command collides with ${existing.controlId} on shim output ${relPath}; every harness command must own a unique shim path`,
        );
      }
      const content = renderShimContent(harness, wiring, command, context);
      shims.set(relPath, { harness, relPath, content, controlId: wiring.controlId });
    }
  }
  return Array.from(shims.values())
    .map(({ harness, relPath, content }) => ({ harness, relPath, content }))
    .sort((left, right) => compareByCodepoint(left.relPath, right.relPath));
}
