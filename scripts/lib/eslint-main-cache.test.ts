import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  discoverEslintCacheIdentityPaths,
  fingerprintEslintCacheIdentityPaths,
  prepareEslintCachePlan,
} from "./eslint-main-cache.js";

const tmpRepo = registerTempRootCleanup();

describe("ESLint main cache plan", () => {
  it("discovers every diagnostic input while pruning generated and transient trees", () => {
    const root = tmpRepo.writeRepo({
      ".auth/secret.ts": "export const secret = true;\n",
      "bun.lock": "lock\n",
      "eslint-config/nested/policy.txt": "policy\n",
      "eslint-rules/nested/rule.js": "export default {};\n",
      "eslint.config.js": "export default [];\n",
      "node_modules/example/index.ts": "export const ignored = true;\n",
      "packages/server/node_modules/example/package.json": "{}\n",
      "packages/server/package.json": "{}\n",
      "packages/server/src/app.ts": "export const app = true;\n",
      "packages/shared/dist/constants.d.ts": "export declare const value: string;\n",
      "packages/shared/tsconfig.build.jsonc": "{}\n",
      "packages/shared/tsconfig.tsbuildinfo": "build\n",
      "reports/generated.ts": "export const report = true;\n",
      "src/not-an-input.js": "export const js = true;\n",
    });

    expect(discoverEslintCacheIdentityPaths(root)).toEqual([
      "./bun.lock",
      "./eslint-config/nested/policy.txt",
      "./eslint-rules/nested/rule.js",
      "./eslint.config.js",
      "./packages/server/package.json",
      "./packages/server/src/app.ts",
      "./packages/shared/dist/constants.d.ts",
      "./packages/shared/tsconfig.build.jsonc",
      "./packages/shared/tsconfig.tsbuildinfo",
    ]);
  });

  it("changes identity for type, policy, and dependency content edits", () => {
    const root = tmpRepo.writeRepo({
      "eslint-rules/example.js": "export default {};\n",
      "package.json": "{}\n",
      "src/value.ts": "export type Value = string;\n",
    });
    const fingerprint = (): string =>
      fingerprintEslintCacheIdentityPaths(root, discoverEslintCacheIdentityPaths(root));

    const first = fingerprint();
    tmpRepo.writeRepoFile(root, "src/value.ts", "export type Value = number;\n");
    const source = fingerprint();
    tmpRepo.writeRepoFile(root, "eslint-rules/example.js", "export default { meta: {} };\n");
    const policy = fingerprint();
    tmpRepo.writeRepoFile(root, "package.json", '{"name":"fixture"}\n');
    const dependency = fingerprint();

    expect(new Set([first, source, policy, dependency])).toHaveLength(4);
  });

  it("hashes newline-containing and missing paths deterministically", () => {
    const root = tmpRepo.makeTempRepo("eslint-cache-paths-");
    const newlinePath = "./src/cache-salt\nprobe.ts";
    tmpRepo.writeRepoFile(root, newlinePath, "export const probe = true;\n");

    expect(discoverEslintCacheIdentityPaths(root)).toEqual([newlinePath]);
    expect(fingerprintEslintCacheIdentityPaths(root, [newlinePath])).toBe(
      fingerprintEslintCacheIdentityPaths(root, [newlinePath]),
    );

    const missingPath = "./src/deleted-during-hash.ts";
    const firstMissing = fingerprintEslintCacheIdentityPaths(root, [missingPath]);
    tmpRepo.writeRepoFile(root, missingPath, "export const present = true;\n");
    expect(fingerprintEslintCacheIdentityPaths(root, [missingPath])).not.toBe(firstMissing);
    rmSync(join(root, missingPath));
    expect(fingerprintEslintCacheIdentityPaths(root, [missingPath])).toBe(firstMissing);
  });

  it("returns absolute content-cache arguments and prunes only stale identity siblings", () => {
    const root = tmpRepo.writeRepo({ "package.json": "{}\n" });
    const cacheRoot = join(tmpRepo.makeTempRepo("eslint-cache-root-"), "cache");
    mkdirSync(join(cacheRoot, "identity-stale"), { recursive: true });
    mkdirSync(join(cacheRoot, "other-cache"), { recursive: true });

    const plan = prepareEslintCachePlan({ repoRoot: root, cacheRoot: `${cacheRoot}/` });

    expect(plan.identityDirectory.startsWith(`${cacheRoot}/identity-`)).toBe(true);
    expect(plan.identityDirectory).not.toContain("//");
    expect(plan.eslintArguments).toEqual([
      "--cache",
      "--cache-location",
      join(plan.identityDirectory, ".eslintcache"),
      "--cache-strategy",
      "content",
    ]);
    expect(existsSync(join(cacheRoot, "identity-stale"))).toBe(false);
    expect(existsSync(join(cacheRoot, "other-cache"))).toBe(true);
  });

  it("preserves configured parent segments while trimming trailing cache-root slashes", () => {
    const root = tmpRepo.writeRepo({ "package.json": "{}\n" });
    const cacheParent = tmpRepo.makeTempRepo("eslint-cache-spelling-");
    const configuredCacheRoot = `${cacheParent}/link/../cache/`;

    const plan = prepareEslintCachePlan({ repoRoot: root, cacheRoot: configuredCacheRoot });

    expect(plan.identityDirectory.startsWith(`${cacheParent}/link/../cache/identity-`)).toBe(true);
    expect(plan.eslintArguments[2].startsWith(`${plan.identityDirectory}/`)).toBe(true);
    expect(plan.identityDirectory).not.toContain("/cache//identity-");
  });

  it("keeps validated partition entries together and rejects invalid keys", () => {
    const root = tmpRepo.writeRepo({ "package.json": "{}\n" });
    const cacheRoot = "cache/";
    const locations: string[] = [];

    for (const partitionKey of ["shared", "server", "client", "remainder"]) {
      const plan = prepareEslintCachePlan({ repoRoot: root, cacheRoot, partitionKey });
      const location = plan.eslintArguments[2];
      expect(plan.identityDirectory.startsWith(`${join(root, "cache")}/identity-`)).toBe(true);
      expect(dirname(location)).toBe(plan.identityDirectory);
      expect(location).toBe(join(plan.identityDirectory, `${partitionKey}.eslintcache`));
      writeFileSync(location, "");
      locations.push(location);
    }

    expect(new Set(locations.map(dirname))).toHaveLength(1);
    expect(locations.every(existsSync)).toBe(true);
    expect(() => prepareEslintCachePlan({ repoRoot: root, partitionKey: "-server" })).toThrow(
      "invalid cache partition key",
    );
    expect(() => prepareEslintCachePlan({ repoRoot: root, partitionKey: "server/main" })).toThrow(
      "invalid cache partition key",
    );
  });
});
