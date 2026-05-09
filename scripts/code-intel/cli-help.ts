import type { HelpTopic } from "./types.js";

export function usage(topic?: HelpTopic): string {
  if (topic) return subcommandUsage(topic);
  return [
    "Usage:",
    "  bun run code:intel -- [--format text|json] def <file>:<line>:<col>",
    "  bun run code:intel -- [--format text|json] def --name <symbol>",
    "  bun run code:intel -- [--format text|json] exports <file>",
    "  bun run code:intel -- [--format text|json] dependents <file> [--depth <N>] [--project <shared|server|client>] [--exclude-tests] [--limit <N>]",
    "  bun run code:intel -- [--format text|json] tests <file> [--depth <N>] [--direct] [--project <shared|server|client>] [--limit <N>]",
    "",
    "Examples:",
    "  bun run code:intel -- def --name characterDetailSchema",
    "  bun run code:intel -- def packages/server/src/routers/character.ts:12:3",
    "  bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 2 --project server --exclude-tests",
    "  bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct",
    "  bun run code:intel -- tests packages/shared/src/schemas/character.ts --depth 2 --project server",
    "  bun run code:intel -- exports scripts/code-intel.ts --format json",
    "",
    "Name-only workflow: start with def --name, then use dependents or tests on the returned file.",
    "Use --limit N on noisy dependents/tests output; --limit 0 means no limit.",
    "Note: tests finds candidate covering tests from runtime imports; it is not an exact coverage oracle.",
    "Guide: docs/guides/code-intel.md",
  ].join("\n");
}

function subcommandUsage(topic: HelpTopic): string {
  if (topic === "def") {
    return [
      "Usage:",
      "  bun run code:intel -- [--format text|json] def <file>:<line>:<col>",
      "  bun run code:intel -- [--format text|json] def --name <symbol>",
      "",
      "Examples:",
      "  bun run code:intel -- def --name characterDetailSchema",
      "  bun run code:intel -- def packages/server/src/routers/character.ts:12:3",
    ].join("\n");
  }
  if (topic === "exports") {
    return [
      "Usage:",
      "  bun run code:intel -- [--format text|json] exports <file>",
      "",
      "Examples:",
      "  bun run code:intel -- exports packages/shared/src/schemas/character.ts",
      "  bun run code:intel -- exports scripts/code-intel.ts --format json",
    ].join("\n");
  }
  if (topic === "dependents") return dependentsUsage();
  return testsUsage();
}

function dependentsUsage(): string {
  return [
    "Usage:",
    "  bun run code:intel -- [--format text|json] dependents <file> [--depth <N>] [--project <shared|server|client>] [--exclude-tests] [--limit <N>]",
    "",
    "Examples:",
    "  bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1",
    "  bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 2 --project server --exclude-tests --limit 20",
    "",
    "Use --limit 0 or omit --limit for the full list.",
  ].join("\n");
}

function testsUsage(): string {
  return [
    "Usage:",
    "  bun run code:intel -- [--format text|json] tests <file> [--depth <N>] [--direct] [--project <shared|server|client>] [--limit <N>]",
    "",
    "Examples:",
    "  bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct",
    "  bun run code:intel -- tests packages/shared/src/schemas/character.ts --depth 2 --project server --limit 20",
    "",
    "Rows marked as candidates are likely coverage from runtime imports, not proof.",
    "Use --limit 0 or omit --limit for the full list.",
  ].join("\n");
}
