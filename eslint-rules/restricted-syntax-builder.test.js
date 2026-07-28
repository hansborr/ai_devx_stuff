// @ts-check
//
// Unit coverage for eslint-config/restricted-syntax-builder.js.
//
// The builder's whole job is that a policy never restates a neighbour's
// selectors, so these tests resolve synthetic policy trees through the real
// ESLint config resolver rather than inspecting the emitted arrays: what
// matters is the entry a file ends up with, not the shape of the object that
// produced it.

import { ESLint } from "eslint";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildRestrictedSyntaxConfigs,
  defineRestrictedSyntaxSelectors,
  restrictedSyntaxException,
  restrictedSyntaxPolicy,
} from "../eslint-config/restricted-syntax-builder.js";

/** @param {string} id */
const fakeSelector = (id) => ({ selector: `Identifier[name='${id}']`, message: `no ${id}` });

const selectorIds = [
  "process.exit",
  "process.env",
  "raw-prisma-sql",
  "trpc-output-permissive",
  "job-guard",
];
const selectors = defineRestrictedSyntaxSelectors(
  Object.fromEntries(selectorIds.map((id) => [id, fakeSelector(id)])),
);
const selectorIdBySelector = new Map(
  [...selectors].map(([id, selector]) => [selector.selector, id]),
);

const policies = [
  restrictedSyntaxPolicy({
    id: "process-primitives",
    files: ["**/*.ts"],
    ignores: ["config/*.ts"],
    selectors: ["process.exit", "process.env"],
  }),
  restrictedSyntaxPolicy({
    id: "server-raw-sql",
    within: "process-primitives",
    files: ["srv/**/*.ts"],
    ignores: ["**/*.test.ts"],
    selectors: ["raw-prisma-sql"],
  }),
  restrictedSyntaxPolicy({
    id: "router-output-shape",
    within: "server-raw-sql",
    files: ["srv/routers/**/*.ts"],
    selectors: ["trpc-output-permissive"],
  }),
];

const exceptions = [
  restrictedSyntaxException({
    id: "test-env-boundaries",
    within: "process-primitives",
    files: ["**/*.test.ts"],
    remove: ["process.env"],
    global: true,
  }),
  restrictedSyntaxException({
    id: "server-bootstrap-process-boundaries",
    within: "server-raw-sql",
    files: ["srv/env.ts", "srv/main.ts"],
    remove: ["process.exit", "process.env"],
  }),
];

/** @param {Partial<Parameters<typeof buildRestrictedSyntaxConfigs>[0]>} overrides */
function build(overrides = {}) {
  return buildRestrictedSyntaxConfigs({
    selectors,
    policies,
    exceptions,
    order: selectorIds,
    ...overrides,
  });
}

/**
 * @param {ReturnType<typeof build>} configs
 * @param {string} file
 * @returns {Promise<{ severity: unknown, ids: string[] }>}
 */
async function resolveSelectorIds(configs, file) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: configs });
  const config = await eslint.calculateConfigForFile(file);
  const entry = config.rules?.["no-restricted-syntax"];
  if (!Array.isArray(entry)) return { severity: entry, ids: [] };
  return {
    severity: entry[0],
    ids: entry.slice(1).map((option) => {
      const record = /** @type {{ selector?: string }} */ (option);
      return (
        selectorIdBySelector.get(record.selector ?? "") ?? `unknown:${String(record.selector)}`
      );
    }),
  };
}

describe("restricted-syntax builder composition", () => {
  it("unions overlapping policies for the narrowest family in `order` order", async () => {
    const configs = build();
    expect(await resolveSelectorIds(configs, "srv/routers/character.ts")).toEqual({
      severity: 2,
      ids: ["process.exit", "process.env", "raw-prisma-sql", "trpc-output-permissive"],
    });
    expect(await resolveSelectorIds(configs, "srv/services/auth.ts")).toEqual({
      severity: 2,
      ids: ["process.exit", "process.env", "raw-prisma-sql"],
    });
    expect(await resolveSelectorIds(configs, "app/main.ts")).toEqual({
      severity: 2,
      ids: ["process.exit", "process.env"],
    });
  });

  it("sorts by `order`, not by the order policies were authored", async () => {
    const reordered = build({ policies: [...policies].reverse() });
    expect(await resolveSelectorIds(reordered, "srv/routers/character.ts")).toEqual({
      severity: 2,
      ids: ["process.exit", "process.env", "raw-prisma-sql", "trpc-output-permissive"],
    });
  });

  it("applies exceptions without dropping independently applicable selectors", async () => {
    const configs = build();
    // A test file keeps the process.exit ban but may touch process.env.
    expect(await resolveSelectorIds(configs, "srv/services/auth.test.ts")).toEqual({
      severity: 2,
      ids: ["process.exit"],
    });
    // Bootstrap files drop both process selectors and keep the raw-SQL fence.
    for (const file of ["srv/env.ts", "srv/main.ts"]) {
      expect(await resolveSelectorIds(configs, file), file).toEqual({
        severity: 2,
        ids: ["raw-prisma-sql"],
      });
    }
  });

  it("turns the rule off only for a family an exception empties", async () => {
    const configs = build({
      exceptions: [
        ...exceptions,
        restrictedSyntaxException({
          id: "script-bootstrap-boundaries",
          within: "process-primitives",
          files: ["cli/db-status.ts"],
          remove: ["process.exit", "process.env"],
        }),
      ],
    });
    expect(await resolveSelectorIds(configs, "cli/db-status.ts")).toEqual({
      severity: 0,
      ids: ["process.exit", "process.env"],
    });
    expect(await resolveSelectorIds(configs, "cli/other.ts")).toEqual({
      severity: 2,
      ids: ["process.exit", "process.env"],
    });
  });

  it("keeps existing selectors when a new policy lands on an already-covered subdirectory", async () => {
    const configs = build({
      policies: [
        ...policies,
        restrictedSyntaxPolicy({
          id: "server-job-guard",
          within: "server-raw-sql",
          files: ["srv/jobs/**/*.ts"],
          selectors: ["job-guard"],
        }),
      ],
    });
    expect(await resolveSelectorIds(configs, "srv/jobs/reindex.ts")).toEqual({
      severity: 2,
      ids: ["process.exit", "process.env", "raw-prisma-sql", "job-guard"],
    });
  });

  it("does not restate ancestor patterns that a literal path already satisfies", async () => {
    const configs = build();
    const bootstrap = configs.find((config) =>
      config.name.endsWith("server-bootstrap-process-boundaries"),
    );
    // Both ancestors (`**/*.ts`, `srv/**/*.ts`) match these paths, so ANDing
    // them in is noise; the intersection is the literal path either way.
    expect(bootstrap?.files).toEqual(["srv/env.ts", "srv/main.ts"]);
    expect(await resolveSelectorIds(configs, "srv/env.ts")).toEqual({
      severity: 2,
      ids: ["raw-prisma-sql"],
    });
    // An ancestor that does *not* match the path still constrains the family,
    // so it must survive: the intersection is empty, and saying so is the
    // honest emission.
    const dangling = build({
      policies: [
        ...policies,
        restrictedSyntaxPolicy({
          id: "dangling-literal",
          within: "server-raw-sql",
          files: ["elsewhere/env.ts"],
          selectors: ["job-guard"],
        }),
      ],
    });
    const kept = dangling.find((config) => config.name.endsWith("dangling-literal"));
    // `**/*.ts` matches and is dropped; `srv/**/*.ts` does not and is kept.
    expect(kept?.files).toEqual([["elsewhere/env.ts", "srv/**/*.ts"]]);
  });

  it("emits inspectable objects with no predicate functions", () => {
    for (const config of build()) {
      expect(Object.keys(config).toSorted()).toEqual(["files", "ignores", "name", "rules"]);
      expect(JSON.parse(JSON.stringify(config))).toEqual(config);
    }
  });
});

describe("restricted-syntax config modules", () => {
  it("keeps ad hoc no-restricted-syntax rule entries out of every config surface", () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const configDir = resolve(repoRoot, "eslint-config");
    // `eslint.config.js` is the surface that matters most: an entry added there
    // is spread after the composed policy and would clobber it outright, which
    // is exactly what the "no other config group sets this" comment beside the
    // `restrictedSyntaxConfigs` spread claims cannot happen.
    const surfaces = [
      "eslint.config.js",
      ...readdirSync(configDir)
        .filter((entry) => entry.endsWith(".js"))
        .map((entry) => `eslint-config/${entry}`),
    ];
    // Any quote style, and the computed-key spelling. A bare mention in a rule
    // id list (rule-groups.js) has no `:` after it and is not an entry.
    const ruleEntryPattern = /["'`]no-restricted-syntax["'`]\s*\]?\s*:/u;
    const owners = surfaces.filter((surface) =>
      ruleEntryPattern.test(readFileSync(resolve(repoRoot, surface), "utf8")),
    );
    // Only the builder writes the rule key; every policy is data now, so a
    // repeated selector array cannot reappear in a neighbouring config module.
    expect(owners).toEqual(["eslint-config/restricted-syntax-builder.js"]);
  });
});

describe("restricted-syntax builder validation", () => {
  it("rejects a selector id declared twice", () => {
    expect(() =>
      defineRestrictedSyntaxSelectors([
        ["process.exit", fakeSelector("process.exit")],
        ["process.exit", fakeSelector("again")],
      ]),
    ).toThrow(/selector id "process.exit" is declared twice/u);
  });

  it("rejects a policy referencing an unknown selector id", () => {
    expect(() =>
      build({
        policies: [
          ...policies,
          restrictedSyntaxPolicy({
            id: "typo-policy",
            within: "server-raw-sql",
            files: ["srv/jobs/**/*.ts"],
            selectors: ["raw-prisma-sqll"],
          }),
        ],
      }),
    ).toThrow(/policy "typo-policy" references unknown selector id "raw-prisma-sqll"/u);
  });

  it("rejects an exception removing an unknown selector id", () => {
    expect(() =>
      build({
        exceptions: [
          ...exceptions,
          restrictedSyntaxException({
            id: "typo-exception",
            within: "server-raw-sql",
            files: ["srv/jobs/reindex.ts"],
            remove: ["process.envv"],
          }),
        ],
      }),
    ).toThrow(/exception "typo-exception" removes unknown selector id "process.envv"/u);
  });

  it("rejects a selector id missing from `order`", () => {
    expect(() => build({ order: selectorIds.filter((id) => id !== "job-guard") })).toThrow(
      /selector id "job-guard" is missing from `order`/u,
    );
  });

  it("rejects a family that would emit the same selector id twice", () => {
    expect(() =>
      build({
        policies: [
          ...policies,
          restrictedSyntaxPolicy({
            id: "redundant-policy",
            within: "server-raw-sql",
            files: ["srv/jobs/**/*.ts"],
            selectors: ["process.env"],
          }),
        ],
      }),
    ).toThrow(/policy "redundant-policy" re-adds selector id "process.env"/u);
  });

  it("rejects an exception broader than the policy it narrows unless marked global", () => {
    const broad = /** @type {const} */ ({
      id: "broad-exception",
      within: "server-raw-sql",
      files: ["**/*.generated.ts"],
      remove: ["raw-prisma-sql"],
    });
    expect(() => build({ exceptions: [...exceptions, restrictedSyntaxException(broad)] })).toThrow(
      /exception "broad-exception" is not provably narrower than policy "server-raw-sql"/u,
    );
    // `global: true` is the recorded escape hatch for a deliberately
    // cross-cutting family; here it is the only child, so nothing else can
    // make the tree ambiguous.
    expect(() =>
      build({
        policies: [policies[0]],
        exceptions: [
          restrictedSyntaxException({
            ...broad,
            within: "process-primitives",
            remove: ["process.env"],
            global: true,
          }),
        ],
      }),
    ).not.toThrow();
  });

  it("rejects two families that are neither nested nor provably disjoint", () => {
    expect(() =>
      build({
        policies: [
          ...policies,
          restrictedSyntaxPolicy({
            id: "overlapping-policy",
            within: "process-primitives",
            files: ["srv/routers/**/*.ts"],
            selectors: ["job-guard"],
          }),
        ],
      }),
    ).toThrow(/are neither nested nor provably disjoint/u);
  });

  it("rejects an exception removing a selector its family never applies", () => {
    expect(() =>
      build({
        exceptions: [
          ...exceptions,
          restrictedSyntaxException({
            id: "dead-removal",
            within: "process-primitives",
            files: ["cli/db-status.ts"],
            remove: ["raw-prisma-sql"],
          }),
        ],
      }),
    ).toThrow(/exception "dead-removal" removes selector id "raw-prisma-sql"/u);
  });

  it("points at the restructure when a family is nested under a terminal exception", () => {
    // Both rejections below are correct but their old guidance ("nest under a
    // policy" / "narrow one family or add ignores") is unactionable for a fence
    // that genuinely belongs inside an exception's family, so each names the
    // policy-plus-nested-exception restructure instead.
    expect(() =>
      build({
        policies: [
          ...policies,
          restrictedSyntaxPolicy({
            id: "test-only-fence",
            within: "test-env-boundaries",
            files: ["**/*.test.ts"],
            selectors: ["job-guard"],
          }),
        ],
      }),
    ).toThrow(/re-express "test-env-boundaries" as a policy node/u);
  });

  it("explains that the ignores disjointness proof needs verbatim patterns", () => {
    // `**/*.test.{ts,tsx}` covers every file `**/*.test.ts` does, but the proof
    // is string equality, so the error has to say the spelling must match.
    expect(() =>
      build({
        policies: [
          ...policies,
          restrictedSyntaxPolicy({
            id: "equivalent-but-respelled",
            within: "process-primitives",
            files: ["srv/jobs/**/*.ts"],
            ignores: ["**/*.test.{ts,tsx}"],
            selectors: ["job-guard"],
          }),
        ],
      }),
    ).toThrow(/exact string equality/u);
  });

  it("rejects a negated ignore pattern, which would smuggle an overlap past the disjointness proof", () => {
    // Without this guard the family below is "provably disjoint" from the
    // `**/*.test.ts` exception (its files pattern appears verbatim in these
    // ignores), yet ESLint re-includes srv/routers/special.test.ts after the
    // negation — so both configs match it and emission order decides.
    expect(() =>
      build({
        policies: [
          ...policies,
          restrictedSyntaxPolicy({
            id: "negated-ignore-policy",
            within: "process-primitives",
            files: ["srv/routers/**/*.ts"],
            ignores: ["**/*.test.ts", "!srv/routers/special.test.ts"],
            selectors: ["job-guard"],
          }),
        ],
      }),
    ).toThrow(
      /policy "negated-ignore-policy" declares negated pattern "!srv\/routers\/special\.test\.ts" in `ignores`/u,
    );
  });

  it("rejects negated patterns in `files` and on exceptions too", () => {
    expect(() =>
      restrictedSyntaxPolicy({
        id: "negated-files-policy",
        within: "process-primitives",
        files: ["srv/**/*.ts", "!srv/generated/**/*.ts"],
        selectors: ["job-guard"],
      }),
    ).toThrow(
      /policy "negated-files-policy" declares negated pattern "!srv\/generated\/\*\*\/\*\.ts" in `files`/u,
    );
    expect(() =>
      restrictedSyntaxException({
        id: "negated-exception",
        within: "server-raw-sql",
        files: ["srv/env.ts"],
        ignores: ["!srv/env.ts"],
        remove: ["process.env"],
      }),
    ).toThrow(
      /exception "negated-exception" declares negated pattern "!srv\/env\.ts" in `ignores`/u,
    );
  });

  it("rejects a duplicate policy id and an unknown parent", () => {
    expect(() => build({ policies: [...policies, policies[0]] })).toThrow(
      /policy or exception id "process-primitives" is declared twice/u,
    );
    expect(() =>
      build({
        policies: [
          ...policies,
          restrictedSyntaxPolicy({
            id: "orphan",
            within: "no-such-policy",
            files: ["srv/jobs/**/*.ts"],
            selectors: ["job-guard"],
          }),
        ],
      }),
    ).toThrow(/"orphan" declares unknown parent "no-such-policy"/u);
  });
});
