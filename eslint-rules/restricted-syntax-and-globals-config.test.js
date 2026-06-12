// @ts-check
//
// Guards for the `no-restricted-syntax` process-primitive bans
// (eslint-config/script-configs.js) and the `no-restricted-globals` runtime
// boundaries (eslint-config/package-boundary-configs.js). Flat config
// replaces (not merges) rule entries by key, so an innocent-looking scoped
// re-add of either rule would silently drop these restrictions:
//
// - process.exit/process.env outside named bootstrap boundaries breaks log
//   flushing, socket teardown, and env centralization (config/env.ts);
// - browser globals in packages/shared break its runtime-neutral contract;
// - raw fetch in client/server source bypasses the tRPC boundary.
//
// The named-file off-switch for the process-primitive bans additionally
// assumes those bans are the *only* `no-restricted-syntax` selectors that
// resolve for regular source files (documented at the off-switch block in
// eslint-config/script-configs.js); the exact-count assertions below turn a
// violation of that ordering assumption into a named test failure. One
// limit: only selectors that survive resolution are visible here, so a new
// `no-restricted-syntax` block placed *before* the process-primitive block
// is silently clobbered for code files rather than caught.
//
// Like no-shared-schemas-barrel.test.js, we exercise the real repo
// `eslint.config.js` via `calculateConfigForFile` so we verify the wiring
// (which configs match which files) rather than reconstructing rules inline.

import { ESLint } from "eslint";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, "eslint.config.js"),
});
const resolvedConfigTestTimeoutMs = 15_000;

/** @returns {Promise<{ rules?: Record<string, unknown> }>} */
async function configFor(/** @type {string} */ relPath) {
  const config = await eslint.calculateConfigForFile(resolve(repoRoot, relPath));
  return { rules: config.rules };
}

/** @param {{ rules?: Record<string, unknown> }} config */
function severityOf(config, /** @type {string} */ ruleId) {
  const entry = config.rules?.[ruleId];
  if (Array.isArray(entry)) return entry[0];
  return entry;
}

// Resolved no-restricted-syntax options are selector objects (or bare selector
// strings); normalize to the selector strings.
/** @param {{ rules?: Record<string, unknown> }} config @returns {string[]} */
function restrictedSelectorsOf(config) {
  const entry = config.rules?.["no-restricted-syntax"];
  if (!Array.isArray(entry)) return [];
  return entry.slice(1).map((option) => {
    if (typeof option === "string") return option;
    const selector = /** @type {{ selector?: unknown }} */ (option).selector;
    return typeof selector === "string" ? selector : "";
  });
}

// Match the load-bearing AST shape, not the message text, so reworded
// guidance doesn't fail the guard but a retargeted selector does.
/** @param {string} selector */
function bansProcessExitCall(selector) {
  return (
    selector.includes("callee.object.name='process'") &&
    selector.includes("callee.property.name='exit'")
  );
}

/** @param {string} selector */
function bansProcessEnvRead(selector) {
  return selector.includes("[object.name='process']") && selector.includes("[property.name='env']");
}

// Resolved no-restricted-globals options are names or { name } objects;
// normalize to the global names.
/** @param {{ rules?: Record<string, unknown> }} config @returns {string[]} */
function restrictedGlobalsOf(config) {
  const entry = config.rules?.["no-restricted-globals"];
  if (!Array.isArray(entry)) return [];
  return entry.slice(1).map((option) => {
    if (typeof option === "string") return option;
    const name = /** @type {{ name?: unknown }} */ (option).name;
    return typeof name === "string" ? name : "";
  });
}

describe("process-primitive restrictions (no-restricted-syntax)", () => {
  it(
    "regular source files ban process.exit and process.env, and nothing else",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/server/src/services/auth-service.ts",
        "packages/client/src/components/campaign/chat/chat-message.tsx",
        "scripts/drift-ai.ts",
      ]) {
        const config = await configFor(file);
        expect(severityOf(config, "no-restricted-syntax"), file).toBe(2);
        const selectors = restrictedSelectorsOf(config);
        expect(selectors.some(bansProcessExitCall), `${file} must ban process.exit`).toBe(true);
        expect(selectors.some(bansProcessEnvRead), `${file} must ban process.env`).toBe(true);
        // Exactly these two: the named-file off-switch is only safe while the
        // process bans are the rule's only selectors (see the ordering note in
        // eslint-config/script-configs.js). A third selector landing here means
        // that assumption broke — rework the off-switch before widening this.
        expect(selectors, `${file} selector count`).toHaveLength(2);
      }
    },
  );

  it(
    "named bootstrap/entrypoint boundary files turn the rule off",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of ["packages/server/src/main.ts", "scripts/lint-ratchet.ts"]) {
        const config = await configFor(file);
        expect(severityOf(config, "no-restricted-syntax"), file).toBe(0);
      }
    },
  );

  it(
    "test and helper files keep the process.exit ban but may touch process.env",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/server/src/services/auth-service.test.ts");
      expect(severityOf(config, "no-restricted-syntax")).toBe(2);
      const selectors = restrictedSelectorsOf(config);
      expect(selectors.some(bansProcessExitCall)).toBe(true);
      expect(selectors.some(bansProcessEnvRead)).toBe(false);
      expect(selectors).toHaveLength(1);
    },
  );
});

describe("runtime-boundary globals (no-restricted-globals)", () => {
  it(
    "shared source files ban browser globals to stay runtime-neutral",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/shared/src/rules/combat.ts");
      expect(severityOf(config, "no-restricted-globals")).toBe(2);
      const names = restrictedGlobalsOf(config);
      for (const name of ["window", "document", "localStorage", "sessionStorage"]) {
        expect(names, `shared must ban ${name}`).toContain(name);
      }
    },
  );

  it(
    "client and server source files ban raw fetch",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/client/src/components/campaign/chat/chat-message.tsx",
        "packages/server/src/services/auth-service.ts",
      ]) {
        const config = await configFor(file);
        expect(severityOf(config, "no-restricted-globals"), file).toBe(2);
        expect(restrictedGlobalsOf(config), file).toContain("fetch");
      }
    },
  );

  it(
    "the sanctioned fetch boundary files turn the rule off",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/client/src/lib/trpc.ts",
        "packages/client/src/hooks/use-map-image-upload.ts",
      ]) {
        const config = await configFor(file);
        expect(severityOf(config, "no-restricted-globals"), file).toBe(0);
      }
    },
  );
});
