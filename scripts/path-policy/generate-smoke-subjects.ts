import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkOrWriteSmokeSubjectOutputs } from "./smoke-subject-headers.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROCESS_ARG_OFFSET = 2;

function main(): void {
  checkOrWriteSmokeSubjectOutputs(repoRoot, process.argv.slice(PROCESS_ARG_OFFSET));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
