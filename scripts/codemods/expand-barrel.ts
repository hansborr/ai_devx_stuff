#!/usr/bin/env bun
import { pathToFileURL } from "node:url";

import { parseArgs } from "./expand-barrel/args.js";
import { runAll, runCheck, runOne } from "./expand-barrel/run.js";
import type { ExpandBarrelCodemodArgs } from "./expand-barrel/types.js";
import { CodemodError } from "./lib/trpc-shared-schema.js";

export type { ExpandBarrelCodemodArgs } from "./expand-barrel/types.js";

export function runExpandBarrelCodemod(argv: ExpandBarrelCodemodArgs, root = process.cwd()): void {
  const args = parseArgs(argv, root);
  if (args.mode === "check") {
    runCheck(root);
    return;
  }
  if (args.mode === "all") {
    runAll(root, args.dryRun);
    return;
  }
  runOne(args.context, root, args.dryRun);
}

export function runExpandBarrelCodemodCli(): void {
  try {
    runExpandBarrelCodemod(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CodemodError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runExpandBarrelCodemodCli();
}
