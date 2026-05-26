import { fail as failWithName } from "../lib/trpc-shared-schema.js";
import { CODEMOD_NAME } from "./constants.js";

export function fail(message: string): never {
  failWithName(CODEMOD_NAME, message);
}

export function usage(): string {
  return [
    "Usage:",
    "bun run codemod:expand-barrel -- --check",
    "bun run codemod:expand-barrel -- --barrel <path> [--dry-run]",
    "bun run codemod:expand-barrel -- --package <specifier> [--dry-run]",
    "bun run codemod:expand-barrel -- --all [--dry-run]",
  ].join("\n");
}
