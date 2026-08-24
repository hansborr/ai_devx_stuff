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
// The selector-composition matrix below asserts named selector families per
// representative resolved config. That catches both before- and after-order
// flat-config replacements that would otherwise silently drop a restriction.
//
// Like no-shared-schemas-barrel.test.js, we exercise the real repo
// `eslint.config.js` via `calculateConfigForFile` so we verify the wiring
// (which configs match which files) rather than reconstructing rules inline.

import { minimatch } from "minimatch";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  restrictedSyntaxConfigs,
  restrictedSyntaxSelectors,
} from "../eslint-config/restricted-syntax-policy.js";
import { resolvedConfigTestTimeoutMs } from "./eslint-config-resolution-timeout.js";
import {
  configFor,
  eslint,
  lintTextFor,
  messagesFor,
  repoRoot,
  severityOf,
} from "./repo-config-harness.js";

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

// The shared `messagesFor` takes any rule id string. Most assertions in this
// suite are negative (`toEqual([])`, `toHaveLength(0)`), and those pass
// vacuously against a misspelled id — an empty message list is exactly what a
// rule that never ran produces. Narrowing the id to the four rules this suite
// polices keeps a typo a static error rather than a silently green test.
/**
 * @param {Awaited<ReturnType<typeof lintTextFor>>} results
 * @param {"@typescript-eslint/no-restricted-imports" | "local/no-node-builtin-reference" | "no-restricted-globals" | "no-restricted-syntax"} ruleId
 * @returns {import('eslint').Linter.LintMessage[]}
 */
function messagesForRule(results, ruleId) {
  return messagesFor(results, ruleId);
}

/**
 * @param {Awaited<ReturnType<typeof lintTextFor>>} results
 * @returns {import('eslint').Linter.LintMessage[]}
 */
function restrictedSyntaxMessages(results) {
  return messagesForRule(results, "no-restricted-syntax");
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

// Resolved no-restricted-globals options carry an optional per-name message.
/** @param {{ rules?: Record<string, unknown> }} config @returns {string[]} */
function restrictedGlobalMessagesOf(config) {
  const entry = config.rules?.["no-restricted-globals"];
  if (!Array.isArray(entry)) return [];
  return entry.slice(1).flatMap((option) => {
    if (typeof option === "string" || option === null || typeof option !== "object") return [];
    const message = /** @type {{ message?: unknown }} */ (option).message;
    return typeof message === "string" ? [message] : [];
  });
}

// Same options list keyed by banned name, so a test can assert that a specific
// global carries a message rather than only checking the messages that happen
// to exist. Bare-string options are recorded with an undefined message, which
// is exactly the shape that silently drops an explanation.
/** @param {{ rules?: Record<string, unknown> }} config @returns {Map<string, string | undefined>} */
function restrictedGlobalMessagesByName(config) {
  /** @type {Map<string, string | undefined>} */
  const byName = new Map();
  const entry = config.rules?.["no-restricted-globals"];
  if (!Array.isArray(entry)) return byName;
  for (const option of entry.slice(1)) {
    if (typeof option === "string") {
      byName.set(option, undefined);
      continue;
    }
    if (option === null || typeof option !== "object") continue;
    const name = /** @type {{ name?: unknown }} */ (option).name;
    if (typeof name !== "string") continue;
    const message = /** @type {{ message?: unknown }} */ (option).message;
    byName.set(name, typeof message === "string" ? message : undefined);
  }
  return byName;
}

// Acceptance test 3 of leaf 40 step 2: each representative file pins the EXACT
// resolved selector-id set, not just the presence of the families it needs.
// Step 1 traded the old exact selector-count pin for drop detection; the
// builder makes the exact set cheap to state again, so a stray extra selector
// is a real diff here rather than something only a hand count would notice.
const restrictedSyntaxSelectorCompositionCases = [
  {
    file: "packages/server/src/services/auth-service.ts",
    ids: ["process.exit", "process.env", "raw-prisma-sql"],
  },
  {
    file: "packages/server/src/routers/character.ts",
    ids: ["process.exit", "process.env", "raw-prisma-sql", "trpc-output-permissive"],
  },
  {
    file: "packages/server/src/services/inventory-service.ts",
    ids: ["process.exit", "process.env"],
  },
  { file: "packages/server/src/config/env.ts", ids: ["raw-prisma-sql"] },
  { file: "packages/server/src/main.ts", ids: ["raw-prisma-sql"] },
  {
    file: "packages/shared/src/schemas/character.ts",
    ids: ["process.exit", "process.env", "shared-schema-z-any"],
  },
  {
    file: "packages/client/src/hooks/use-notifications.ts",
    ids: [
      "process.exit",
      "process.env",
      "query-key-array-property",
      "query-client-array-key-argument",
      "import-meta-env",
    ],
  },
  {
    file: "packages/client/src/lib/api-base.ts",
    ids: [
      "process.exit",
      "process.env",
      "query-key-array-property",
      "query-client-array-key-argument",
    ],
  },
  { file: "scripts/drift-ai.ts", ids: ["process.exit", "process.env"] },
  { file: "packages/server/src/services/auth-service.test.ts", ids: ["process.exit"] },
  { file: "packages/client/src/test/mock-trpc.tsx", ids: ["process.exit"] },
  { file: "e2e/a11y.spec.ts", ids: ["process.exit"] },
];

// Leaf 40 step 3, finding 1: the package fences exclude the whole
// `testAndHelperFiles` family, so a test or helper file takes the cross-cutting
// test carve-out no matter which package directory it lands in. No tracked file
// exercises the paths below yet — that is exactly why they are pinned here.
// `calculateConfigForFile` resolves a path that does not exist, so these need no
// fixture files; adding one of these files later must not change its policy.
// See the recorded decision in eslint-config/restricted-syntax-policy.js.
const syntheticTestFileCompositionCases = [
  // Fenced by the old block order (its ignores said `.test.ts`, not `.spec.ts`)
  // while the sibling services/*.spec.ts was not; uniform now.
  { file: "packages/server/src/routers/campaign.spec.ts", ids: ["process.exit"] },
  { file: "packages/server/src/routers/campaign.test.ts", ids: ["process.exit"] },
  { file: "packages/server/src/routers/nested/test/fixture.ts", ids: ["process.exit"] },
  { file: "packages/server/src/services/campaign.spec.ts", ids: ["process.exit"] },
  // Same story for shared schemas: `.spec.ts` and helper spellings were fenced,
  // `.test.ts` was not.
  { file: "packages/shared/src/schemas/campaign.spec.ts", ids: ["process.exit"] },
  { file: "packages/shared/src/schemas/campaign-test-helper.ts", ids: ["process.exit"] },
  { file: "packages/client/src/lib/api-base.spec.ts", ids: ["process.exit"] },
];

const selectorIdBySelector = new Map(
  [...restrictedSyntaxSelectors].map(([id, selector]) => [selector.selector, id]),
);

/** @param {{ rules?: Record<string, unknown> }} config @returns {string[]} */
function restrictedSelectorIdsOf(config) {
  return restrictedSelectorsOf(config).map(
    (selector) => selectorIdBySelector.get(selector) ?? `unregistered:${selector}`,
  );
}

describe("resolved no-restricted-syntax selector composition", () => {
  it(
    "resolves the exact selector-id set for every representative file",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const { file, ids } of restrictedSyntaxSelectorCompositionCases) {
        const config = await configFor(file);
        expect(severityOf(config, "no-restricted-syntax"), file).toBe(2);
        expect(restrictedSelectorIdsOf(config), file).toEqual(ids);
      }
    },
  );

  it(
    "gives future test and helper files the test carve-out in every package family",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const { file, ids } of syntheticTestFileCompositionCases) {
        const config = await configFor(file);
        expect(severityOf(config, "no-restricted-syntax"), file).toBe(2);
        expect(restrictedSelectorIdsOf(config), file).toEqual(ids);
      }
    },
  );

  it(
    "keeps every registered selector id reachable from some representative file",
    { timeout: resolvedConfigTestTimeoutMs },
    () => {
      const covered = new Set(restrictedSyntaxSelectorCompositionCases.flatMap(({ ids }) => ids));
      expect([...restrictedSyntaxSelectors.keys()].filter((id) => !covered.has(id))).toEqual([]);
    },
  );
});

// Leaf 40 step 3, finding 3: the builder is deliberately filesystem-free, so it
// cannot tell a live glob from a typo'd one, and `calculateConfigForFile`
// happily resolves a path that does not exist — which means the snapshot and
// the exact-set cases above stay green against a renamed or deleted directory.
// These two tests are the filesystem half of the proof: every emitted family
// must own at least one real file, and every literal path in the policy must
// exist. A misspelled directory is trivially disjoint from every sibling, so
// without this it would build clean and enforce nothing.
const lintableExtensionPattern = /\.(?:js|cjs|mjs|ts|tsx|mts|cts)$/u;
// Same magic set the builder uses to decide a pattern is a literal path.
const globMagicPattern = /[*?[\]{}!+@()]/u;
const minimatchOptions = { dot: true };

const trackedLintableFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\0")
  .filter((file) => file.length > 0 && lintableExtensionPattern.test(file));

/** @param {string | string[]} entry @param {string} file */
function matchesFilesEntry(entry, file) {
  // Flat config ANDs the patterns inside a nested array and ORs the entries.
  return Array.isArray(entry)
    ? entry.every((pattern) => minimatch(file, pattern, minimatchOptions))
    : minimatch(file, entry, minimatchOptions);
}

/** @param {(typeof restrictedSyntaxConfigs)[number]} config @param {string} file */
function configMatches(config, file) {
  if (config.ignores.some((pattern) => minimatch(file, pattern, minimatchOptions))) return false;
  return config.files.some((entry) => matchesFilesEntry(entry, file));
}

/** Families emit parent-first, so the last match is the deepest one. */
function filesOwnedByEachFamily() {
  /** @type {Map<string, string[]>} */
  const owned = new Map(restrictedSyntaxConfigs.map((config) => [config.name, []]));
  const deepestFirst = [...restrictedSyntaxConfigs].reverse();
  for (const file of trackedLintableFiles) {
    const winner = deepestFirst.find((config) => configMatches(config, file));
    if (winner !== undefined) owned.get(winner.name)?.push(file);
  }
  return owned;
}

describe("restricted-syntax policy families are live", () => {
  it(
    "makes every emitted family the deepest match for a real, non-ignored tracked file",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const owned = filesOwnedByEachFamily();
      /** @type {string[]} */
      const dead = [];
      for (const [name, files] of owned) {
        let live = false;
        for (const file of files) {
          if (await eslint.isPathIgnored(resolve(repoRoot, file))) continue;
          live = true;
          break;
        }
        if (!live) dead.push(name);
      }
      // A dead family means its globs no longer describe anything in the repo:
      // a typo, or a directory that was renamed or deleted out from under it.
      expect(dead).toEqual([]);
    },
  );

  it("keeps every literal path in the policy pointing at a file that exists", () => {
    const literalPaths = [
      ...new Set(
        restrictedSyntaxConfigs.flatMap((config) =>
          [...config.files.flat(), ...config.ignores].filter(
            (pattern) => !globMagicPattern.test(pattern),
          ),
        ),
      ),
    ];
    // The literal-path families are the exposed ones: 14 script bootstrap
    // paths, 2 server bootstrap paths, and the client env boundary.
    expect(literalPaths.length).toBeGreaterThan(0);
    expect(literalPaths.filter((path) => !existsSync(resolve(repoRoot, path)))).toEqual([]);
  });
});

describe("process-primitive restrictions (no-restricted-syntax)", () => {
  it(
    "regular source files ban process.exit and process.env",
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
    "reports computed static raw SQL calls in fenced server source",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const cases = [
        {
          name: "string-literal property",
          code: 'await prisma["$queryRaw"]`SELECT 1`;',
        },
        {
          name: "no-substitution template property",
          code: "await prisma[`$queryRaw`]`SELECT 1`;",
        },
      ];

      for (const probe of cases) {
        const messages = restrictedSyntaxMessages(
          await lintTextFor(
            "packages/server/src/routers/inventory.ts",
            ["const prisma = { $queryRaw: () => undefined };", probe.code].join("\n"),
          ),
        );
        expect(messages, probe.name).toHaveLength(1);
      }
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
    "shared production schemas ban computed z.any calls",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const results = await lintTextFor(
        "packages/shared/src/schemas/character.ts",
        'import { z } from "zod";\nexport const looseSchema = z["any"]();',
      );
      expect(restrictedSyntaxMessages(results)).toHaveLength(1);
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

  it(
    "router source bans computed shallow permissive output schemas",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const results = await lintTextFor(
        "packages/server/src/routers/character.ts",
        [
          'import { z } from "zod";',
          "protectedProcedure.output(z['unknown']()).query(() => undefined);",
        ].join("\n"),
      );
      expect(restrictedSyntaxMessages(results)).toHaveLength(1);
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
      const messagesByName = restrictedGlobalMessagesByName(config);
      // Each ban names the layering decision so the repair is legible at
      // fire-time. Asserted per name, not over "whatever messages exist":
      // dropping the message properties, or restating the bans as supported
      // bare-name strings, would otherwise leave nothing to iterate and every
      // browser-global diagnostic would silently lose its ADR link.
      for (const name of ["window", "document", "localStorage", "sessionStorage"]) {
        expect(names, `shared must ban ${name}`).toContain(name);
        const message = messagesByName.get(name);
        expect(typeof message, `${name}'s ban must carry a message`).toBe("string");
        expect(message, `${name}'s message must name the layering decision`).toContain("ADR-0006");
      }
      // Any other shared ban carrying a message must name it too.
      for (const message of restrictedGlobalMessagesOf(config)) {
        expect(message).toContain("ADR-0006");
      }
    },
  );

  it(
    "shared production source bans Node globals and the NodeJS namespace",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const globalCases = [
        { name: "process", code: "process.cwd();" },
        { name: "Buffer", code: 'Buffer.from("value");' },
        { name: "__dirname", code: "void __dirname;" },
        { name: "__filename", code: "void __filename;" },
      ];

      for (const probe of globalCases) {
        const messages = messagesForRule(
          await lintTextFor("packages/shared/src/rules/combat.ts", probe.code),
          "local/no-node-builtin-reference",
        );
        expect(messages, probe.name).toHaveLength(1);
      }

      for (const probe of [
        "let timer: NodeJS.Timeout;\nvoid timer;",
        "export type Bytes = Buffer;",
        "export type Proc = typeof process;",
        "export type BufferConstructor = typeof Buffer;",
        "export type Directory = typeof __dirname;",
        "export type Filename = typeof __filename;",
        "interface Env extends NodeJS.ProcessEnv {}",
        "interface Bytes extends Buffer {}",
        "export type Env = typeof process.env;",
        "export type Cwd = typeof process.cwd;",
        "export type From = typeof Buffer.from;",
      ]) {
        const results = await lintTextFor("packages/shared/src/rules/combat.ts", probe);
        const messages = messagesForRule(results, "local/no-node-builtin-reference");
        expect(messages, probe).toHaveLength(1);
      }

      for (const probe of [
        "function inspect(process, Buffer) { return [process, Buffer]; }",
        "interface Buffer {}\ninterface Bytes extends Buffer {}",
        "namespace NodeJS { export interface ProcessEnv {} }\ntype Env = NodeJS.ProcessEnv;",
      ]) {
        const messages = messagesForRule(
          await lintTextFor("packages/shared/src/rules/combat.ts", probe),
          "local/no-node-builtin-reference",
        );
        expect(messages, probe).toEqual([]);
      }
    },
  );

  it(
    "shared production source rejects static Node builtin module references",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const probe of [
        'import fs from "node:fs";\nvoid fs;',
        'import fsPromises from "node:fs/promises";\nvoid fsPromises;',
        'import path from "path";\nvoid path;',
        'import fsPromises from "fs/promises";\nvoid fsPromises;',
        'import type { Stats } from "node:fs";\nvoid 0 as unknown as Stats;',
        'export { Stats } from "node:fs";',
        'export * from "node:fs";',
      ]) {
        const messages = messagesForRule(
          await lintTextFor("packages/shared/src/rules/combat.ts", probe),
          "@typescript-eslint/no-restricted-imports",
        );
        expect(messages, probe).toHaveLength(1);
      }
    },
  );

  it(
    "shared production source rejects non-ESM Node builtin module references",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const probe of [
        'const fs = await import("node:fs/promises");\nvoid fs;',
        'const fs = await import("fs/promises");\nvoid fs;',
        "const fs = await import(`node:fs/promises`);\nvoid fs;",
        'type Stats = import("node:fs").Stats;\nvoid 0 as unknown as Stats;',
        'const fs = require("node:fs");\nvoid fs;',
        'import fs = require("node:fs");\nvoid fs;',
      ]) {
        const messages = messagesForRule(
          await lintTextFor("packages/shared/src/rules/combat.ts", probe),
          "local/no-node-builtin-reference",
        );
        expect(messages, probe).toHaveLength(1);
      }
    },
  );

  it(
    "keeps browser and framework restrictions in shared production and tests",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      for (const file of [
        "packages/shared/src/rules/combat.ts",
        "packages/shared/src/rules/combat.test.ts",
      ]) {
        const config = await configFor(file);
        expect(restrictedGlobalsOf(config), `${file} browser globals`).toEqual(
          expect.arrayContaining(["window", "document", "localStorage", "sessionStorage"]),
        );

        const results = await lintTextFor(
          file,
          'import React from "react";\nvoid React;\nvoid window.location.href;',
        );
        expect(
          messagesForRule(results, "@typescript-eslint/no-restricted-imports"),
          `${file} framework imports`,
        ).toHaveLength(1);
        expect(
          messagesForRule(results, "no-restricted-globals"),
          `${file} browser globals`,
        ).toHaveLength(1);
      }
    },
  );

  it(
    "keeps intentional Node access available to shared tests",
    { timeout: resolvedConfigTestTimeoutMs },
    async () => {
      const file = "packages/shared/src/test-tier-sentinel.test.ts";
      const results = await lintTextFor(
        file,
        [
          'import { readFile } from "node:fs";',
          "void readFile;",
          'const fsPromises = await import("node:fs/promises");',
          "void fsPromises;",
          "const fsTemplate = await import(`node:fs`);",
          "void fsTemplate;",
          'type Stats = import("node:fs").Stats;',
          "void 0 as unknown as Stats;",
          'const requiredFs = require("node:fs");',
          "void requiredFs;",
          'void process.env["MUSI_RUN_SLOW_TESTS"];',
          'Buffer.from("value");',
          "void __dirname;",
          "void __filename;",
          "let timer: NodeJS.Timeout;",
          "void timer;",
          "export type Bytes = Buffer;",
          "export type Proc = typeof process;",
          "export type BufferConstructor = typeof Buffer;",
          "export type Directory = typeof __dirname;",
          "export type Filename = typeof __filename;",
          "interface Env extends NodeJS.ProcessEnv {}",
          "interface Bytes extends Buffer {}",
          "export type ProcessEnv = typeof process.env;",
          "export type Cwd = typeof process.cwd;",
          "export type From = typeof Buffer.from;",
        ].join("\n"),
      );
      expect(messagesForRule(results, "@typescript-eslint/no-restricted-imports")).toEqual([]);
      expect(messagesForRule(results, "no-restricted-globals")).toEqual([]);
      expect(messagesForRule(results, "no-restricted-syntax")).toEqual([]);
      expect(messagesForRule(results, "local/no-node-builtin-reference")).toEqual([]);
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
