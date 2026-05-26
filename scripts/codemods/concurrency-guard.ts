#!/usr/bin/env bun
import { pathToFileURL } from "node:url";

import { runConcurrencyGuardCodemod } from "./concurrency-guard/run.js";

export { runConcurrencyGuardCodemod };
export type { ConcurrencyGuardCodemodArgs } from "./concurrency-guard/types.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runConcurrencyGuardCodemod(process.argv.slice(2));
}
