// @ts-check
//
// The repo's whole `no-restricted-syntax` policy, as data.
//
// Every selector object lives here once, every file family declares only the
// selectors it *adds* (or, for an exception, the ones it removes), and
// eslint-config/restricted-syntax-builder.js unions them along the family tree.
// Adding a new fence is a one-object diff: no neighbouring config module has to
// repeat the selectors it already owns to avoid being clobbered by flat
// config's replace-by-key semantics.

import {
  buildRestrictedSyntaxConfigs,
  defineRestrictedSyntaxSelectors,
  restrictedSyntaxException,
  restrictedSyntaxPolicy,
} from "./restricted-syntax-builder.js";
import { tsConfigFiles } from "./config-surfaces.js";
import {
  clientSourceFiles,
  clientTestAndHelperSourceFiles,
  codeFiles,
  eslintConfigJsFiles,
  serverTestAndHelperSourceFiles,
  testAndHelperFiles,
} from "./path-glob-policy.js";

const queryClientArrayKeyArgumentSelectors = [
  "ArrayExpression.arguments:first-child",
  "TSAsExpression.arguments:first-child[expression.type='ArrayExpression']",
  "TSSatisfiesExpression.arguments:first-child[expression.type='ArrayExpression']",
];

const queryClientArrayKeyCallSelectors = [
  "CallExpression[callee.property.name=/^(setQueryData|getQueryData)$/]",
  "CallExpression[callee.property.value=/^(setQueryData|getQueryData)$/]",
];

const handBuiltQueryKeyMessage =
  "Use tRPC queryOptions().queryKey or queryFilter() instead of a hand-built TanStack Query key array.";

export const restrictedSyntaxSelectors = defineRestrictedSyntaxSelectors({
  "process.exit": {
    selector: "CallExpression[callee.object.name='process'][callee.property.name='exit']",
    message:
      "Avoid process.exit(...) outside CLI/bootstrap entrypoints. Set process.exitCode and return/throw so finally blocks, log flushing, and socket teardown can run. If this IS a terminating entrypoint, add the file to the allowlist override in eslint.config.js.",
  },
  "process.env": {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message:
      "Avoid reading process.env outside config/env.ts. Use serverEnv from packages/server/src/config/env.ts (or add the key there). For child-process spawn `env:` pass-through and the db-status admin tool, add the file to the allowlist override below.",
  },
  "raw-prisma-sql": {
    selector: [
      "MemberExpression[property.name=/^\\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]",
      "MemberExpression[computed=true][property.value=/^\\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]",
      "MemberExpression[computed=true][property.type='TemplateLiteral'][property.expressions.length=0][property.quasis.0.value.cooked=/^\\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)$/]",
    ].join(", "),
    message:
      "Raw Prisma SQL is restricted to sanctioned server boundaries. Move it to a reviewed service/helper and see docs/CONCURRENCY.md.",
  },
  "shared-schema-z-any": {
    selector:
      "CallExpression[callee.object.name='z'][callee.property.name='any'], CallExpression[callee.object.name='z'][callee.computed=true][callee.property.value='any']",
    message:
      "Use z.unknown() for genuinely dynamic shared payloads instead of z.any(); see docs/guides/add-trpc-procedure.md.",
  },
  "trpc-output-permissive": {
    selector:
      "CallExpression[callee.property.name='output'] > CallExpression.arguments:first-child[callee.object.name='z'][callee.property.name=/^(any|unknown|void)$/], CallExpression[callee.property.name='output'] > CallExpression.arguments:first-child[callee.object.name='z'][callee.computed=true][callee.property.value=/^(any|unknown|void)$/]",
    message:
      "Use a named shared output schema instead of z.any(), top-level z.unknown(), or z.void(); see docs/guides/add-trpc-procedure.md.",
  },
  "query-key-array-property": {
    selector: [
      "Property[key.name='queryKey'][value.type='ArrayExpression']",
      "Property[key.value='queryKey'][value.type='ArrayExpression']",
      "Property[key.name='queryKey'][value.type=/^(TSAsExpression|TSSatisfiesExpression)$/][value.expression.type='ArrayExpression']",
      "Property[key.value='queryKey'][value.type=/^(TSAsExpression|TSSatisfiesExpression)$/][value.expression.type='ArrayExpression']",
    ].join(", "),
    message: handBuiltQueryKeyMessage,
  },
  "query-client-array-key-argument": {
    selector: queryClientArrayKeyCallSelectors
      .flatMap((callSelector) =>
        queryClientArrayKeyArgumentSelectors.map(
          (argumentSelector) => `${callSelector} > ${argumentSelector}`,
        ),
      )
      .join(", "),
    message: handBuiltQueryKeyMessage,
  },
  "import-meta-env": {
    selector:
      "MemberExpression[object.type='MetaProperty'][object.meta.name='import'][object.property.name='meta'][property.name='env']",
    message:
      "Avoid reading import.meta.env outside packages/client/src/lib/api-base.ts. Add client env boundaries there instead of scattering Vite env reads.",
  },
});

// Recorded policy decision (leaf 40 step 3): every package policy below
// excludes the whole `testAndHelperFiles` family, so the cross-cutting
// `test-env-boundaries` exception is its single owner.
//
// This is a deliberate widening, not just a builder formality. Before the
// builder, block order decided: the package fences were spread *after* the
// test carve-out, so a test file a fence still matched took the fence's full
// selector list instead of the carve-out. Those fences spelled their test
// ignores as `**/*.test.ts` (or a per-package test list) and so missed
// `*.spec.ts`, `*test-helper*.ts`, and nested `**/test/**` directories. The
// result was incoherent rather than intentional: `routers/foo.spec.ts` was
// fenced for raw SQL, tRPC output, and process.env while
// `services/foo.spec.ts` — same package, same file kind — was not. No tracked
// file sits in that gap, which is why the resolution snapshot is byte-identical
// either way; only files added later can see the difference, and they now get
// the test carve-out uniformly.
//
// The old asymmetry is not expressible here. `test-env-boundaries` genuinely
// overlaps each package policy, and for two glob families the builder's only
// sound disjointness proof is "one family's file patterns appear verbatim in
// the other's `ignores`". That has exactly two directions: exclude the test
// family from the package fences (this), or exclude whole packages from the
// test carve-out — which would strip the process.env carve-out from 585
// tracked test and helper files. The intended behavior for the files this
// affects is pinned by the synthetic `.spec`/helper cases in
// eslint-rules/restricted-syntax-and-globals-config.test.js.
const serverRawSqlIgnores = [
  ...serverTestAndHelperSourceFiles,
  "packages/server/src/**/*test-helper*.ts",
  "packages/server/src/services/inventory-service.ts",
  ...testAndHelperFiles,
];

const policies = [
  // Ban restricted process primitives everywhere, then carve out the named
  // bootstrap/config/script boundaries below.
  restrictedSyntaxPolicy({
    id: "process-primitives",
    files: codeFiles,
    ignores: [...eslintConfigJsFiles, ...tsConfigFiles],
    selectors: ["process.exit", "process.env"],
  }),

  // Raw Prisma SQL is fenced to sanctioned server boundaries; see
  // docs/CONCURRENCY.md.
  restrictedSyntaxPolicy({
    id: "server-raw-sql",
    within: "process-primitives",
    files: ["packages/server/src/**/*.ts"],
    ignores: serverRawSqlIgnores,
    selectors: ["raw-prisma-sql"],
  }),

  // Inherits `serverRawSqlIgnores`, so router test and helper files take the
  // test carve-out too — see the recorded decision above; this is the family
  // the old block order treated inconsistently.
  restrictedSyntaxPolicy({
    id: "router-output-shape",
    within: "server-raw-sql",
    files: ["packages/server/src/routers/**/*.ts"],
    selectors: ["trpc-output-permissive"],
  }),

  // Output/result schemas stay permissive so Prisma's extra fields get stripped
  // at the boundary; z.any() is what this bans. `testAndHelperFiles` is excluded
  // per the recorded decision above: a future schema `.spec.ts` or helper takes
  // the test carve-out rather than this fence.
  restrictedSyntaxPolicy({
    id: "shared-schema-permissiveness",
    within: "process-primitives",
    files: ["packages/shared/src/schemas/**/*.ts"],
    ignores: ["**/*.test.ts", ...testAndHelperFiles],
    selectors: ["shared-schema-z-any"],
  }),

  restrictedSyntaxPolicy({
    id: "client-query-and-env-guards",
    within: "process-primitives",
    files: clientSourceFiles,
    ignores: [...clientTestAndHelperSourceFiles, ...testAndHelperFiles],
    selectors: ["query-key-array-property", "query-client-array-key-argument", "import-meta-env"],
  }),
];

// Exceptions are terminal: nothing nests under one, and a new sibling policy
// that overlaps one is rejected. So the families below can only ever lose
// selectors. If a future fence needs to *add* one inside an exception's family
// — banning `.only(` in test files, say — the escape is to re-express that
// exception as a policy node covering the same files, carrying the selectors it
// keeps, with its removal demoted to an exception nested under it; the new fence
// then nests under that policy. The builder names this in the error text for
// both rejections.
const exceptions = [
  // Test, helper, and e2e setup code may read/mutate environment variables to
  // isolate processes and databases; process.exit(...) stays restricted.
  restrictedSyntaxException({
    id: "test-env-boundaries",
    within: "process-primitives",
    files: testAndHelperFiles,
    remove: ["process.env"],
    global: true,
  }),

  // Bootstrap/config/script entrypoints where the restricted process primitive
  // is the correct boundary. Nothing else applies to these files, so the rule
  // resolves off for them.
  restrictedSyntaxException({
    id: "script-bootstrap-boundaries",
    within: "process-primitives",
    files: [
      "scripts/db-status.ts",
      "scripts/code-intel/daemon-process.ts",
      "scripts/code-intel/daemon-server.ts",
      "scripts/code-intel/perf-check.ts",
      // Implements the HARNESS_DIAGNOSTICS_OUTPUT sidecar contract; reading
      // that env var here IS the boundary every producer shares.
      "scripts/harness/harness-diagnostics-output.ts",
      // Implement the MUSI_HARNESS_CHECK_ALLOW_NO_FIXTURE_PATHS fixture
      // opt-out; reading that env var here IS the fail-closed boundary shared
      // by validation and projection generation.
      "scripts/harness/fixture-closure-check.ts",
      "scripts/harness/generate-verify-steps.ts",
      // Implements the MUSI_MIGRATION_ALLOWLIST override; the migration
      // scanner's effects layer IS its environment boundary, and the CLI it
      // feeds takes that value as injected data.
      "scripts/lib/migration-safety-io.ts",
      "scripts/lint-ratchet/output.ts",
      "scripts/lint-ratchet.ts",
      "scripts/max-lines-exceptions.ts",
      "scripts/sensor-knip-unused-exports.ts",
      "scripts/sensor-near-duplicates.ts",
      "packages/server/prisma/seed.ts",
      "packages/server/prisma/seed-template.ts",
      "packages/server/scripts/pgexec.ts",
    ],
    remove: ["process.exit", "process.env"],
  }),

  // The same boundary for the two server entrypoints, which sit inside the
  // raw-SQL family and must keep that fence while dropping process primitives.
  restrictedSyntaxException({
    id: "server-bootstrap-boundaries",
    within: "server-raw-sql",
    files: ["packages/server/src/config/env.ts", "packages/server/src/main.ts"],
    remove: ["process.exit", "process.env"],
  }),

  // The sanctioned client env boundary: import.meta.env reads belong here and
  // nowhere else, while the query-key guards still apply.
  restrictedSyntaxException({
    id: "client-env-boundary",
    within: "client-query-and-env-guards",
    files: ["packages/client/src/lib/api-base.ts"],
    remove: ["import-meta-env"],
  }),
];

export const restrictedSyntaxConfigs = buildRestrictedSyntaxConfigs({
  selectors: restrictedSyntaxSelectors,
  policies,
  exceptions,
  order: [
    "process.exit",
    "process.env",
    "raw-prisma-sql",
    "shared-schema-z-any",
    "trpc-output-permissive",
    "query-key-array-property",
    "query-client-array-key-argument",
    "import-meta-env",
  ],
});
