import type { HelpTopic } from "./types.js";
import { DISCOVERY_SCOPE_STATEMENT } from "./types.js";

const DEF_USAGE_LINES = [
  "  bun run code:intel -- [--format text|json] def <file>:<line>:<col>",
  "  bun run code:intel -- [--format text|json] def --name <symbol>",
] as const;
const EXPORTS_USAGE_LINE = "  bun run code:intel -- [--format text|json] exports <file>";
const OVERVIEW_USAGE_LINE = "  bun run code:intel -- [--format text|json] overview <file>";
const REFS_USAGE_LINE =
  "  bun run code:intel -- [--format text|json] refs <file>:<line>:<col> [--limit <N>]";
const DEPENDENTS_USAGE_LINE =
  "  bun run code:intel -- [--format text|json] dependents <file> [--depth <N>] [--project <shared|server|client>] [--exclude-tests] [--limit <N>]";
const TESTS_USAGE_LINE =
  "  bun run code:intel -- [--format text|json] tests <file> [--depth <N>] [--direct] [--project <shared|server|client>] [--limit <N>]";

export function usage(topic?: HelpTopic): string {
  if (topic) return subcommandUsage(topic);
  return [
    "Usage:",
    ...DEF_USAGE_LINES,
    EXPORTS_USAGE_LINE,
    OVERVIEW_USAGE_LINE,
    REFS_USAGE_LINE,
    DEPENDENTS_USAGE_LINE,
    TESTS_USAGE_LINE,
    "",
    "Examples:",
    "  bun run code:intel -- def --name characterDetailSchema",
    "  bun run code:intel -- def packages/server/src/routers/character.ts:12:3",
    "  bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14",
    "  bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 2 --project server --exclude-tests",
    "  bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct",
    "  bun run code:intel -- tests packages/shared/src/schemas/character.ts --depth 2 --project server",
    "  bun run code:intel -- overview packages/server/src/routers/cast-spell.ts",
    "  bun run code:intel -- exports scripts/code-intel/types.ts --format json",
    "",
    "Name-only workflow: start with def --name, then use dependents, refs, or tests on the returned file.",
    "Use --limit N on noisy dependents/refs/tests output; --limit 0 means no limit.",
    "Note: tests finds candidate covering tests from runtime imports; it is not an exact coverage oracle.",
    "Daemon/perf: bun run code:intel:server -- restart|status|stop; bun run code:intel:perf",
    DISCOVERY_SCOPE_STATEMENT,
    "Guide: docs/guides/code-intel.md",
  ].join("\n");
}

const SUBCOMMAND_USAGE: Record<HelpTopic, () => string> = {
  def: defUsage,
  dependents: dependentsUsage,
  exports: exportsUsage,
  overview: overviewUsage,
  refs: refsUsage,
  tests: testsUsage,
};

function subcommandUsage(topic: HelpTopic): string {
  return SUBCOMMAND_USAGE[topic]();
}

function defUsage(): string {
  return [
    "Usage:",
    ...DEF_USAGE_LINES,
    "",
    "Examples:",
    "  bun run code:intel -- def --name characterDetailSchema",
    "  bun run code:intel -- def packages/server/src/routers/character.ts:12:3",
  ].join("\n");
}

function exportsUsage(): string {
  return [
    "Usage:",
    EXPORTS_USAGE_LINE,
    "",
    "Examples:",
    "  bun run code:intel -- exports packages/shared/src/schemas/character.ts",
    "  bun run code:intel -- exports scripts/code-intel/types.ts --format json",
  ].join("\n");
}

function overviewUsage(): string {
  return ["Usage:", OVERVIEW_USAGE_LINE].join("\n");
}

function refsUsage(): string {
  return [
    "Usage:",
    REFS_USAGE_LINE,
    "",
    "Examples:",
    "  bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14",
    "  bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14 --format json",
    "",
    "Each row marks the reference as import, value, or type. The declaration itself is excluded.",
    "Use --limit 0 or omit --limit for the full list.",
  ].join("\n");
}

function dependentsUsage(): string {
  return [
    "Usage:",
    DEPENDENTS_USAGE_LINE,
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
    TESTS_USAGE_LINE,
    "",
    "Examples:",
    "  bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct",
    "  bun run code:intel -- tests packages/shared/src/schemas/character.ts --depth 2 --project server --limit 20",
    "",
    "Rows marked as candidates are likely coverage from runtime imports, not proof.",
    "Use --limit 0 or omit --limit for the full list.",
  ].join("\n");
}
