// The audience prose for the command catalog's sections: one line per script
// family saying who those commands are for. Together with the effect legend
// (COMMAND_EFFECT_MEANINGS in command-catalog-schema.ts) this is the whole of
// the page's authored text — every row's purpose is projected from a harness
// control or a `commandCatalog` entry — and it is required: the generator
// throws on a family with no entry here rather than rendering an unlabeled
// section, so a new command prefix cannot appear in the page without someone
// saying what it is.

export interface GroupBlurb {
  readonly title: string;
  readonly blurb: string;
}

/** Family id (the script-name prefix, `""` for unprefixed) -> who it is for. */
export const GROUP_BLURBS: ReadonlyMap<string, GroupBlurb> = new Map([
  [
    "",
    {
      title: "Top-level commands",
      blurb:
        "The unprefixed commands: what a contributor runs on day one, and what CI runs as a whole-tree step.",
    },
  ],
  [
    "adr",
    {
      title: "`adr:*` — architecture decision records",
      blurb: "Keeps accepted ADRs and the gate messages that cite them cross-linked.",
    },
  ],
  [
    "audit",
    {
      title: "`audit:*` — dependency audits",
      blurb:
        "Supply-chain checks over the installed tree. Run by hand or from CI; not part of the commit gate.",
    },
  ],
  [
    "backlog",
    {
      title: "`backlog:*` — backlog notes",
      blurb: "Grammar and status checks over the tracked notes under `docs/agent_notes/backlog/`.",
    },
  ],
  [
    "baseline",
    {
      title: "`baseline:*` — generated baseline recovery",
      blurb:
        "Merge/rebase recovery for the committed ratchet and sensor baselines. Reach for these when a baseline conflicts, not during normal work.",
    },
  ],
  [
    "check",
    {
      title: "`check:*` — dependency-exception watchdogs",
      blurb:
        "Narrow guards over deliberate dependency exceptions. Each one fails the moment its exception stops being load-bearing, so a workaround cannot outlive its reason.",
    },
  ],
  [
    "code",
    {
      title: "`code:intel*` — code intelligence",
      blurb:
        "Symbol, dependent, and test lookups for agents and humans when text search is not precise enough. Read-only.",
    },
  ],
  [
    "codemod",
    {
      title: "`codemod:*` — scan-and-repair migrations",
      blurb:
        "Whole-tree scanners with a repair mode for a specific migration. They rewrite source; review the diff.",
    },
  ],
  [
    "concurrency",
    {
      title: "`concurrency:*` — race-sensitive mutation metadata",
      blurb:
        "Generates and checks the Prisma relation subgraph the nested-write guard and its lint rule read.",
    },
  ],
  [
    "db",
    {
      title: "`db:*` — database lifecycle",
      blurb:
        "Prisma migration, seed, and inspection commands (`packages/server`), plus the root-level status and migration-safety checks.",
    },
  ],
  [
    "docs",
    {
      title: "`docs:*` — generated documentation",
      blurb:
        "Each generator writes a committed page from its source; each `:check` twin fails when the committed page is stale. Never hand-edit a generated page.",
    },
  ],
  [
    "drift",
    {
      title: "`drift:*` — AI-drift sensors",
      blurb:
        "Report-only sensors for the patterns AI coding agents introduce. Evidence for a human, not gates.",
    },
  ],
  [
    "e2e",
    {
      title: "`e2e*` — Playwright end-to-end tests",
      blurb: "Browser tests against a running stack. Not part of the commit gate.",
    },
  ],
  [
    "eval",
    {
      title: "`eval:*` — lint message evaluation",
      blurb:
        "Replays recorded repair traces against the current lint messages to see whether an agent can actually get to green.",
    },
  ],
  [
    "format",
    {
      title: "`format*` — Prettier",
      blurb:
        "Whole-tree and changed-file formatting. The `:check` forms are what the gates run; the bare forms rewrite files.",
    },
  ],
  [
    "generate",
    {
      title: "`generate:*` — SRD data generators (server)",
      blurb:
        "One-time operator generators that parse the optional, gitignored upstream SRD markdown checkout into committed seed data. See `packages/server/src/seed/MODULE.md`.",
    },
  ],
  [
    "harness",
    {
      title: "`harness:*` — harness registration and generators",
      blurb:
        "The harness's own machinery: generators that project hook wiring, verify slots, policy fragments and schemas out of `harness.controls.json`, and the registration checks that keep the manifest honest against the live tree.",
    },
  ],
  [
    "lint",
    {
      title: "`lint:*` — lint, ratchets, and suppression policy",
      blurb:
        "The lint floor, the shrink-only ratchet baselines, and the suppression registers. The `:update` / `:fix` forms rewrite committed baselines and source; the rest report.",
    },
  ],
  [
    "logs",
    {
      title: "`logs:*` — structured logging audit",
      blurb: "Audits the shape of structured log calls across the server.",
    },
  ],
  [
    "module",
    {
      title: "`module:*` — module-doc index",
      blurb: "Regenerates and checks `MODULE-INDEX.md` from the `*MODULE.md` orientation docs.",
    },
  ],
  [
    "mutation",
    {
      title: "`mutation:*` — mutation-testing triage",
      blurb: "Turns a Stryker report into a ranked triage list. See also `test:*:mutation`.",
    },
  ],
  [
    "prisma",
    {
      title: "`prisma:*` — Prisma client (server)",
      blurb: "Regenerates the Prisma client into `packages/server/src/generated/`.",
    },
  ],
  [
    "sensor",
    {
      title: "`sensor:*` — repository sensors",
      blurb:
        "Whole-tree measurements with committed baselines. Several own a git merge driver so two branches draining the same baseline merge to the stricter floor.",
    },
  ],
  [
    "test",
    {
      title: "`test:*` — test suites",
      blurb:
        "The Vitest projects and their lanes. `test` is the full suite; the narrower entries exist because the whole suite is expensive, not because they cover different code.",
    },
  ],
  [
    "typecheck",
    {
      title: "`typecheck*` — TypeScript",
      blurb: "Builds every TypeScript project graph: packages, scripts, config JS, and e2e.",
    },
  ],
  [
    "verify",
    {
      title: "`verify:*` — verification gates",
      blurb:
        "The gate wrappers. `verify` is the full sequential gate, `verify:changed` is the default manual pre-commit check, and the `verify:async:*` family runs one of them detached so an agent can keep working.",
    },
  ],
  [
    "worktree",
    {
      title: "`worktree:*` — per-worktree provisioning",
      blurb:
        "Secondary git worktrees get their own databases, ports, Redis index and env files. `bun run dev` provisions automatically; these are the manual controls.",
    },
  ],
]);
