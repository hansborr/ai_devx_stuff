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

import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: resolve(repoRoot, "eslint.config.js"),
});

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

/** @param {string} selector */
function bansRawPrismaSql(selector) {
  return selector.includes("queryRaw") && selector.includes("executeRaw");
}

/** @param {string} selector */
function bansQueryKeyArrayProperty(selector) {
  return (
    selector.includes("Property") &&
    selector.includes("queryKey") &&
    selector.includes("ArrayExpression")
  );
}

/** @param {string} selector */
function bansQueryClientArrayKeyArgument(selector) {
  return selector.includes("setQueryData") && selector.includes("getQueryData");
}

/** @param {string} selector */
function bansImportMetaEnvRead(selector) {
  return selector.includes("object.meta.name='import'") && selector.includes("property.name='env'");
}

/** @param {string} selector */
function bansSharedSchemaZAny(selector) {
  return (
    selector.includes("callee.object.name='z'") && selector.includes("callee.property.name='any'")
  );
}

/** @param {string} selector */
function bansPermissiveTrpcOutput(selector) {
  return (
    selector.includes("callee.property.name='output'") && selector.includes("any|unknown|void")
  );
}

/** @param {string} file */
function expectedNoRestrictedSyntaxSelectorCount(file) {
  if (file === "packages/server/src/routers/character.ts") return 4;
  if (file.startsWith("packages/server/src/")) return 3;
  if (file.startsWith("packages/shared/src/schemas/")) return 3;
  if (file === "packages/client/src/lib/api-base.ts") return 4;
  if (file.startsWith("packages/client/src/")) return 5;
  return 2;
}

async function lintTextFor(/** @type {string} */ relPath, /** @type {string} */ code) {
  return eslint.lintText(code, { filePath: resolve(repoRoot, relPath) });
}

/**
 * @param {Awaited<ReturnType<typeof lintTextFor>>} results
 * @returns {import('eslint').Linter.LintMessage[]}
 */
function restrictedSyntaxMessages(results) {
  return results.flatMap((result) =>
    result.messages.filter((message) => message.ruleId === "no-restricted-syntax"),
  );
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
        "packages/server/src/routers/character.ts",
        "packages/shared/src/schemas/character.ts",
        "packages/client/src/components/campaign/chat/chat-message.tsx",
        "packages/client/src/lib/api-base.ts",
        "scripts/drift-ai.ts",
      ]) {
        const config = await configFor(file);
        expect(severityOf(config, "no-restricted-syntax"), file).toBe(2);
        const selectors = restrictedSelectorsOf(config);
        expect(selectors.some(bansProcessExitCall), `${file} must ban process.exit`).toBe(true);
        expect(selectors.some(bansProcessEnvRead), `${file} must ban process.env`).toBe(true);
        // Exactly these process selectors, plus the deliberate server-only raw
        // SQL/output selectors, shared-schema selector, and client-only
        // query-key/import-meta selectors. A new selector landing here means a
        // flat-config replacement may have changed which off-switch is safe.
        expect(selectors, `${file} selector count`).toHaveLength(
          expectedNoRestrictedSyntaxSelectorCount(file),
        );
      }
    },
  );

  it(
    "named script bootstrap/entrypoint boundary files turn the rule off",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of ["scripts/lint-ratchet.ts"]) {
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

describe("raw Prisma SQL restriction (no-restricted-syntax)", () => {
  it(
    "server source files fence raw SQL to sanctioned modules without dropping process bans",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/server/src/routers/inventory.ts");
      expect(severityOf(config, "no-restricted-syntax")).toBe(2);
      const selectors = restrictedSelectorsOf(config);
      expect(selectors.some(bansProcessExitCall), "process.exit ban must remain").toBe(true);
      expect(selectors.some(bansProcessEnvRead), "process.env ban must remain").toBe(true);
      expect(selectors.some(bansRawPrismaSql), "raw SQL ban must resolve").toBe(true);
    },
  );

  it(
    "server process-primitive boundary files still keep the raw SQL selector",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of ["packages/server/src/config/env.ts", "packages/server/src/main.ts"]) {
        const config = await configFor(file);
        expect(severityOf(config, "no-restricted-syntax"), file).toBe(2);
        const selectors = restrictedSelectorsOf(config);
        expect(selectors.some(bansRawPrismaSql), `${file} must ban raw SQL`).toBe(true);
        expect(selectors.some(bansProcessExitCall), `${file} must not ban process.exit`).toBe(
          false,
        );
        expect(selectors.some(bansProcessEnvRead), `${file} must not ban process.env`).toBe(false);
      }
    },
  );

  it(
    "mutation helpers remain raw SQL fenced even though RawTxClient imports are exempt there",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/server/src/utils/character-class-mutations.ts");
      expect(restrictedSelectorsOf(config).some(bansRawPrismaSql)).toBe(true);
    },
  );

  it(
    "sanctioned raw SQL modules and tests keep the raw SQL selector off",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/server/src/services/inventory-service.ts",
        "packages/server/src/test/prepare-test-db.ts",
        "packages/server/src/routers/character-level-up.test.ts",
      ]) {
        const config = await configFor(file);
        expect(restrictedSelectorsOf(config).some(bansRawPrismaSql), file).toBe(false);
      }
    },
  );
});

describe("schema permissiveness restrictions (no-restricted-syntax)", () => {
  it(
    "shared production schemas ban z.any without dropping process bans",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/shared/src/schemas/character.ts");
      expect(severityOf(config, "no-restricted-syntax")).toBe(2);
      const selectors = restrictedSelectorsOf(config);
      expect(selectors.some(bansProcessExitCall), "process.exit ban must remain").toBe(true);
      expect(selectors.some(bansProcessEnvRead), "process.env ban must remain").toBe(true);
      expect(selectors.some(bansSharedSchemaZAny), "z.any ban must resolve").toBe(true);
    },
  );

  it(
    "router source bans shallow permissive output schemas without dropping raw SQL and process bans",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/server/src/routers/character.ts");
      expect(severityOf(config, "no-restricted-syntax")).toBe(2);
      const selectors = restrictedSelectorsOf(config);
      expect(selectors.some(bansProcessExitCall), "process.exit ban must remain").toBe(true);
      expect(selectors.some(bansProcessEnvRead), "process.env ban must remain").toBe(true);
      expect(selectors.some(bansRawPrismaSql), "raw SQL ban must remain").toBe(true);
      expect(selectors.some(bansPermissiveTrpcOutput), "permissive output ban must resolve").toBe(
        true,
      );
    },
  );
});

describe("client query-key restrictions (no-restricted-syntax)", () => {
  it(
    "client production source bans hand-built query key arrays without dropping process bans",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/client/src/hooks/use-notifications.ts");
      expect(severityOf(config, "no-restricted-syntax")).toBe(2);
      const selectors = restrictedSelectorsOf(config);
      expect(selectors.some(bansProcessExitCall), "process.exit ban must remain").toBe(true);
      expect(selectors.some(bansProcessEnvRead), "process.env ban must remain").toBe(true);
      expect(
        selectors.some(bansQueryKeyArrayProperty),
        "queryKey array property ban must resolve",
      ).toBe(true);
      expect(
        selectors.some(bansQueryClientArrayKeyArgument),
        "query client array key argument ban must resolve",
      ).toBe(true);
      expect(selectors.some(bansImportMetaEnvRead), "import.meta.env ban must resolve").toBe(true);
    },
  );

  it(
    "reports raw query-key arrays through TS wrappers and string-literal properties",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const cases = [
        {
          name: "as const property",
          code: [
            'const campaignId = "campaign-id";',
            'export const options = { queryKey: ["campaign", campaignId] as const };',
          ].join("\n"),
        },
        {
          name: "satisfies property",
          code: 'export const options = { queryKey: ["campaign"] satisfies readonly string[] };',
        },
        {
          name: "string-literal property",
          code: 'export const options = { "queryKey": ["campaign"] };',
        },
        {
          name: "as const setQueryData argument",
          code: [
            "const queryClient = { setQueryData: (..._args: unknown[]) => undefined };",
            'queryClient.setQueryData(["campaign"] as const, () => undefined);',
          ].join("\n"),
        },
        {
          name: "string-literal setQueryData method",
          code: [
            'const queryClient = { "setQueryData": (..._args: unknown[]) => undefined };',
            'queryClient["setQueryData"](["campaign"], () => undefined);',
          ].join("\n"),
        },
        {
          name: "satisfies getQueryData argument",
          code: [
            "const queryClient = { getQueryData: (_key: readonly string[]) => undefined };",
            'queryClient.getQueryData(["campaign"] satisfies readonly string[]);',
          ].join("\n"),
        },
      ];

      for (const probe of cases) {
        const messages = restrictedSyntaxMessages(
          await lintTextFor("packages/client/src/hooks/use-notifications.ts", probe.code),
        );
        expect(messages, probe.name).toHaveLength(1);
      }
    },
  );

  it(
    "client test mocks keep hand-built test query keys available",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const config = await configFor("packages/client/src/test/mock-trpc.tsx");
      const selectors = restrictedSelectorsOf(config);
      expect(selectors.some(bansProcessExitCall), "test process.exit ban must remain").toBe(true);
      expect(selectors.some(bansQueryKeyArrayProperty)).toBe(false);
      expect(selectors.some(bansQueryClientArrayKeyArgument)).toBe(false);
    },
  );
});

describe("client import.meta.env restrictions (no-restricted-syntax)", () => {
  it(
    "keeps import.meta.env reads fenced to the API base config module",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const regularConfig = await configFor("packages/client/src/hooks/use-notifications.ts");
      expect(restrictedSelectorsOf(regularConfig).some(bansImportMetaEnvRead)).toBe(true);

      const boundaryConfig = await configFor("packages/client/src/lib/api-base.ts");
      const boundarySelectors = restrictedSelectorsOf(boundaryConfig);
      expect(boundarySelectors.some(bansProcessExitCall), "process.exit ban must remain").toBe(
        true,
      );
      expect(boundarySelectors.some(bansProcessEnvRead), "process.env ban must remain").toBe(true);
      expect(
        boundarySelectors.some(bansQueryKeyArrayProperty),
        "queryKey property ban must remain",
      ).toBe(true);
      expect(
        boundarySelectors.some(bansQueryClientArrayKeyArgument),
        "query client key argument ban must remain",
      ).toBe(true);
      expect(boundarySelectors.some(bansImportMetaEnvRead)).toBe(false);
    },
  );

  it(
    "still bans hand-built query keys inside the import.meta.env boundary module",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const messages = restrictedSyntaxMessages(
        await lintTextFor(
          "packages/client/src/lib/api-base.ts",
          [
            "export const apiUrl = import.meta.env.VITE_API_URL;",
            'export const options = { "queryKey": ["campaign"] };',
          ].join("\n"),
        ),
      );
      expect(messages).toHaveLength(1);
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
