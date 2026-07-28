import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runDocGenerator } from "../lib/doc-generator.js";
import { loadTypedHarnessManifest } from "./harness-manifest-loader.js";
import { GENERATED_HOOK_TIMEOUT_CONSTANTS_PATH } from "./harness-paths.js";
import { renderHookTimeoutConstantsShellFromManifest } from "./hook-timeout-constants.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, GENERATED_HOOK_TIMEOUT_CONSTANTS_PATH);

function main(): void {
  runDocGenerator({
    outputPath,
    refreshCommand: "harness:hook-timeouts",
    render: () => ({
      rendered: renderHookTimeoutConstantsShellFromManifest(loadTypedHarnessManifest(repoRoot)),
    }),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
