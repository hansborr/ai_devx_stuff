// Dedicated config for the slow-test tier.
//
// Default per-package vitest configs (`packages/*/vitest.config.ts`) exclude
// `**/*.slow.test.*`, so IDE runners, `bun run test`, `test:changed`, and
// `verify:changed` all skip the slow tier without env-dependent config
// branching. This config is the only path that runs slow tests, invoked
// through `bun run test:slow` (which also sets `MUSI_RUN_SLOW_TESTS=1`).
//
// We import each package's base config and re-export project entries that
// keep its environment/setup/env wiring but flip the include/exclude pair to
// the slow tier. We can't use the `extends:` shorthand because vitest merges
// the parent's `exclude` into ours, which would re-add `**/*.slow.test.*`
// and skip every slow file.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defaultExclude, defineConfig, defineProject } from "vitest/config";

import clientConfig from "./packages/client/vitest.config.ts";
import serverConfig from "./packages/server/vitest.config.ts";
import sharedConfig from "./packages/shared/vitest.config.ts";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const sharedBaseConfig = await sharedConfig;
const serverBaseConfig = await serverConfig;
const clientBaseConfig = await clientConfig;

const sharedSlow = defineProject({
  ...sharedBaseConfig,
  root: path.join(repoRoot, "packages/shared"),
  test: {
    ...sharedBaseConfig.test,
    include: ["src/**/*.slow.test.{ts,tsx}"],
    exclude: defaultExclude,
  },
});

const serverSlow = defineProject({
  ...serverBaseConfig,
  root: path.join(repoRoot, "packages/server"),
  test: {
    ...serverBaseConfig.test,
    include: ["src/**/*.slow.test.{ts,tsx}"],
    exclude: defaultExclude,
  },
});

const clientSlow = defineProject({
  ...clientBaseConfig,
  root: path.join(repoRoot, "packages/client"),
  test: {
    ...clientBaseConfig.test,
    include: ["src/**/*.slow.test.{ts,tsx}"],
    exclude: defaultExclude,
  },
});

export default defineConfig({
  test: {
    projects: [sharedSlow, serverSlow, clientSlow],
  },
});
