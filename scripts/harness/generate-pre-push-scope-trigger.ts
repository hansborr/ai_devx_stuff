import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runDocGenerator } from "../lib/doc-generator.js";
import { GENERATED_PRE_PUSH_SCOPE_TRIGGER_PATH } from "./harness-paths.js";
import {
  readNearDuplicatesScannerExtensions,
  renderPrePushScopeTriggerShell,
} from "./pre-push-scope-trigger.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = join(repoRoot, GENERATED_PRE_PUSH_SCOPE_TRIGGER_PATH);

function main(): void {
  runDocGenerator({
    outputPath,
    refreshCommand: "harness:pre-push-trigger",
    render: () => ({
      rendered: renderPrePushScopeTriggerShell(readNearDuplicatesScannerExtensions(repoRoot)),
    }),
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
