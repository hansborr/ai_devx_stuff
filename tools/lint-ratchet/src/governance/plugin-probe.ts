import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomicallySync } from "../kernel/atomic-write.js";
import { isRecord } from "../kernel/baseline-hash.js";
import { configRootFor, type LintRatchetEngineBinding } from "../kernel/engine-context.js";
import { ConfigError } from "../kernel/metrics-types.js";

const PLUGIN_PROBE_HASH_LENGTH = 16;
const PLUGIN_PROBE_MARKER = "lint-ratchet-plugin-probe:";

export interface PluginProbeShape {
  /** The selected export resolved to an object carrying a `rules` object. */
  readonly usable: boolean;
  /** That `rules` object defines the proposed rule's short name. */
  readonly definesRule: boolean;
}

/**
 * Render the probe program: a standalone ES module that imports the plugin by
 * *static* specifier and prints the two facts the preflight decides on.
 *
 * The specifier, the selected export, and the rule name are baked in as string
 * literals, exactly as `renderThirdPartyEslintConfig` bakes the specifier into
 * the generated ESLint config — so the probe and the config that ESLint will
 * later load resolve the same name the same way, from the same directory.
 */
function renderPluginProbe(
  pluginModule: string,
  pluginExport: "default" | "plugin",
  ruleName: string,
): string {
  return [
    `import * as ratchetedPluginModule from ${JSON.stringify(pluginModule)};`,
    "",
    `const selected = ratchetedPluginModule[${JSON.stringify(pluginExport)}];`,
    'const rules = selected !== null && typeof selected === "object" ? selected.rules : undefined;',
    'const usable = rules !== null && typeof rules === "object";',
    "// A marked line, because importing the plugin may itself print to stdout.",
    `process.stdout.write(\`\\n${PLUGIN_PROBE_MARKER}\${JSON.stringify({`,
    "  usable,",
    `  definesRule: usable && rules[${JSON.stringify(ruleName)}] !== undefined,`,
    "})}\\n`);",
    "",
  ].join("\n");
}

function normalizedMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The marker already proved the module loaded, so this is a reporting problem,
 * not a resolution one — a ConfigError so the caller passes it through instead
 * of rewrapping it as a package that could not be found.
 */
function unreadableProbeOutput(pluginModule: string, marked: string, reason: string): ConfigError {
  return new ConfigError(
    `--plugin ${pluginModule} loaded, but its plugin probe returned unreadable output (${reason}). Check whether the package writes to stdout while loading.\n${marked}`,
  );
}

/**
 * Ask the plugin about itself from the directory the generated ESLint config is
 * written into, by writing a probe module there and running it.
 *
 * The engine never imports a runtime-determined path itself: `runEslintForFiles`
 * writes the generated config into this same directory and hands its *path* to a
 * subprocess, keeping `src/` statically analyzable (pinned by the package
 * boundary suite). The probe follows that shape — the computed part lives in the
 * generated file, which does a static import, and the engine only spawns it.
 *
 * Running the file is also what makes the resolution origin real. Alternatives
 * that keep the lookup in-process are all weaker:
 *
 * - Importing the bare specifier from this module resolves from the engine
 *   package's own location. A nested `node_modules` beside the engine (this
 *   repository ships one, carrying its own `typescript-eslint` range) shadows
 *   the proposal repository's copy, so the preflight would inspect the object
 *   ESLint loads only by luck.
 * - `import.meta.resolve(specifier, parent)` anchors correctly under Bun, but
 *   stock Node ignores the second argument unless started with
 *   `--experimental-import-meta-resolve` — silently, resolving from the caller
 *   and returning a plausible wrong module rather than throwing (measured on
 *   Node v24.18.0). This package is meant to be copied into other repositories
 *   and pins no runtime, and Node runs its `.ts` exports directly via type
 *   stripping, so that failure is reachable. Vitest anchors correctly, so no
 *   test here would catch the regression.
 * - `createRequire` resolution anchors correctly everywhere, but applies CJS
 *   conditions, so an exports map with separate `require`/`import` targets
 *   hands the preflight a different file than ESLint loads.
 */
export async function probePluginShape(
  pluginModule: string,
  pluginExport: "default" | "plugin",
  ruleName: string,
  binding: LintRatchetEngineBinding,
): Promise<PluginProbeShape> {
  const probeSource = renderPluginProbe(pluginModule, pluginExport, ruleName);
  // Hash the whole program, not just the specifier: two proposals differing
  // only in export or rule name must not share a probe file.
  const digest = createHash("sha256")
    .update(probeSource)
    .digest("hex")
    .slice(0, PLUGIN_PROBE_HASH_LENGTH);
  const probePath = join(configRootFor(binding), `plugin-probe-${digest}.mjs`);
  mkdirSync(dirname(probePath), { recursive: true });
  // Content is a pure function of the hashed program, so rewriting is always a
  // no-op in effect and needs no read-back comparison to stay correct.
  writeFileAtomicallySync(probePath, probeSource);

  // Same launch shape as spawnEslint: the runtime that ran the gate, rooted at
  // the proposal repository. Output is two booleans, so a pipe is safe here.
  const probe = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (settle, fail) => {
      const child = spawn(process.execPath, [probePath], {
        cwd: binding.repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", fail);
      child.on("close", (code) => {
        settle({ code, stdout, stderr });
      });
    },
  );

  // The marker separates the two ways a probe fails, and both exit non-zero.
  // No marker means evaluation never reached the write — the module could not be
  // resolved or threw on import — which the caller reports as a resolution
  // failure.
  const marked = probe.stdout
    .split("\n")
    .findLast((line) => line.startsWith(PLUGIN_PROBE_MARKER))
    ?.slice(PLUGIN_PROBE_MARKER.length);
  if (marked === undefined) {
    throw new Error(probe.stderr.trim() || `plugin probe exited with code ${String(probe.code)}`);
  }

  // A marker with a bad exit status is the other way: the plugin evaluated far
  // enough to describe itself, then failed. `process.exitCode` and an uncaught
  // post-import rejection only take effect when the process exits, after the
  // top-level write — so the shape can look perfectly well-formed while
  // describing a module ESLint will fail on too. Refuse it rather than trusting
  // it. A null code (killed by a signal) is a failure as well.
  if (probe.code !== 0) {
    const detail = probe.stderr.trim();
    throw new ConfigError(
      `--plugin ${pluginModule} did not load cleanly: its plugin probe reported a shape but exited with code ${String(probe.code)}. ESLint would load the same module, so fix the package or correct --plugin.${detail === "" ? "" : `\n${detail}`}`,
    );
  }

  // Past this point the module demonstrably loaded, so a decode failure is never
  // a resolution problem and must not be reported as one. The probe itself only
  // ever writes `JSON.stringify` output, but it is not the only writer on this
  // pipe — the marked line is the LAST match, so a plugin writing to stdout
  // after the probe's own line gets the final word.
  let parsed: unknown;
  try {
    parsed = JSON.parse(marked);
  } catch (error) {
    throw unreadableProbeOutput(pluginModule, marked, normalizedMessage(error));
  }
  if (!isRecord(parsed) || typeof parsed.usable !== "boolean") {
    throw unreadableProbeOutput(pluginModule, marked, "expected an object with a boolean `usable`");
  }
  return { usable: parsed.usable, definesRule: parsed.definesRule === true };
}
