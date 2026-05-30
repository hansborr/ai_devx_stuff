# drift:ai improvements — task index

A worked-through backlog for the `drift:ai` sensor's next phase, decomposed so an
implementing agent can pick up **one task file** and work from it plus the two
shared references — without reading the whole design corpus.

**Always read first:** [`01-shared-context.md`](./01-shared-context.md) (the
contract, the portability target, the OpenClaw realities, the testing recipe) and
[`02-seam-map.md`](./02-seam-map.md) (verified `file:line` anchors). Then read the
single task file you are implementing. For the adapter track (tasks 30–33) also
read [`03-adapter-contract.md`](./03-adapter-contract.md) — task 30's landed
policy + base contract that 31/32/33 implement against.

This folder supersedes the planning docs under `../drift-ai-review/`,
`../drift-ai-improvements.md`, `../drift-ai-hotspots-subcommand.md`, and
`../drift-ai-hotspots-brainstorm.md` for *execution* — those remain as deeper
rationale and are linked from individual tasks. The decomposition was validated
against the real target repo **OpenClaw** (`/home/node/tmp/openclaw`); where the
concrete target revised an earlier assumption, the task file says so.

---

## Task list

Tracks: **P** portability MVP · **A** architecture / single report · **C** new
checks & adapters · **H** hotspots subcommand · **X** cleanup / optional.

| # | Task | Track | Size | Depends on | Blocks | Status |
|---|---|---|---|---|---|---|
| 10 | [Tools-checkout contract](./10-tools-checkout-contract.md) | P | S | — | 11, 12 | Done |
| 11 | [Target `cd` flow](./11-target-cd-wrapper.md) | P | S | 10 | — | Done |
| 12 | [jscpd bin resolution](./12-jscpd-bin-resolution.md) | P | S | — (coord. 21, 30) | — | Done |
| 13 | [Portable output cleanup](./13-portable-output-cleanup.md) | P | S | — | — | Done |
| 14 | [Shallow-clone & uninstalled-target resilience](./14-shallow-clone-and-uninstalled-target.md) | P | S–M | — (coord. 12, 31, 32) | — | Done |
| 20 | [Shared path-util helpers (B1)](./20-path-util-shared-helpers.md) | A | S | — | 21, 50 | Done |
| 21 | [CheckPlugin registry + CheckOutcome (B2)](./21-check-plugin-registry.md) | A | M | 20 | 22, 30, 31, 32, 33 | Done |
| 22 | [Reporting trust pass (A1–A5)](./22-reporting-trust-pass.md) | A | S–M | 21 | — | Done |
| 30 | [Adapter policy + base contract](./30-adapter-policy.md) | C | M | 21 | 31, 32, 33 | Done |
| 31 | [Import-cycles plugin](./31-import-cycles-plugin.md) | C | M | 21, 30 | — | Done |
| 32 | [knip orphan-files adapter](./32-knip-orphan-files-adapter.md) | C | S | 21, 30 | — | Done |
| 33 | [Near-duplicate plugin (ts-morph)](./33-near-duplicate-plugin.md) | C | M | 21, 30 | — | Done |
| 40 | [Hotspots history collector (v0)](./40-hotspots-history-collector.md) | H | M | — | 41, 42 | Done |
| 41 | [Hotspots v1 lens](./41-hotspots-v1-lens.md) | H | M | 40 | — | Done |
| 42 | [Hotspots further lenses](./42-hotspots-further-lenses.md) | H | L | 40 | — | Done |
| 50 | [Opportunistic cleanup (Med/Low)](./50-opportunistic-cleanup.md) | X | M | 20, 21 (per item; coord. 40) | — | Done |
| 51 | [Node/npm extraction (won't do)](./51-node-npm-extraction.md) | X | M | 10–14, 20–22 | — | Won't do |

## Dependency graph

```
Portability MVP (independent — ship first):
  10 ──► 11, 12        13      14
  (13 and 14 are standalone — Depends on: none; 12/14 coordinate with 21/30/31/32 for skip-reason polish)

Architecture (critical path):
  20 ──► 21 ──► 22
            └─► 30 ──► 31
                  ├──► 32
                  └──► 33

Hotspots (independent — only needs the git seam):
  40 ──► 41
    └──► 42

Cleanup / optional:
  20,21 ──► 50
  51 is closed as won't-do unless reopened for a real distribution need
```

The three trunks — **Portability MVP**, **Architecture→Checks**, and **Hotspots**
— are mutually independent and can run in parallel by different agents. The only
hard serial chain is `20 → 21 → {22, 30 → 31/32/33}`.

## Recommended order

1. **Portability MVP first** (10 → 11, then 12, 13, 14): makes the
   external-repo / OpenClaw workflow usable before any architecture churn. Each is
   small and independently shippable.
2. **20 path-util** — do before anything else in Track A; it removes a real
   correctness-drift risk and unblocks 21 and 50.
3. **21 CheckPlugin registry** — the keystone. Dissolves the conditional-spread
   noise, makes skip-reasons first-class, and is the prerequisite for the adapter
   policy and every new check.
4. **22 reporting trust pass** — consumes 21's skip reasons + schema bump.
5. **30 adapter policy**, then **31 / 32 / 33** in parallel.
6. **Hotspots 40 → 41 → 42** any time (parallel to the above; only needs the git
   seam). 40 is the real foundation; 41/42 are reducers on it.
7. **50 cleanup** opportunistically after 20/21. **51 node/npm** is closed as
   won't-do; keep the Bun tools-checkout workflow unless a real distribution need
   reopens it.

## What the OpenClaw validation changed (vs the source docs)

Carried into the relevant task files; summarized here so the deltas aren't lost.
These are example-derived constraints for arbitrary target repos, not a directive
to make drift:ai an OpenClaw-specific auditor.

- **Co-change must have a min-support threshold *and* a per-node degree cap**
  (task 41) — raw OpenClaw co-change is 65k pairs with an i18n locale clique that
  swamps the top-N. Churn and coupling are both required hotspot lenses; their
  implementation order is flexible.
- **No churn × complexity hotspot lens** (task 42) — complexity is covered by
  the `ai_devx_stuff-lint` baseline adapter from task 30, so a hotspot v5 would
  be redundant.
- **`madge` is not in the tools checkout** (task 31) — import-cycles should spike
  `ts-morph` first, fall back to `import-x` if needed, and not add `madge`
  without reopening a dependency decision.
- **Targets may have no `node_modules` installed at all** (tasks 12, 31, 32) —
  jscpd, import-cycle resolvers, and the knip adapter must skip cleanly with a
  reason on an uninstalled target; this is the *common* foreign-repo case.
- **Shallow/blobless clones make `git diff` SIGSEGV** (task 14) — changed scope
  should detect a shallow clone and degrade with a clear message; `git log`-based
  hotspots are unaffected.
- **knip config can be non-root** (task 32) — OpenClaw's is `config/knip.config.ts`;
  the adapter must locate it.
- **Targets may not use ESLint** (tasks 30, 42) — OpenClaw uses oxlint. Do not
  depend on target-local ESLint, but task 30 now explicitly allows the
  tools-checkout `ai_devx_stuff-lint` baseline adapter that labels findings as
  `drift-baseline` rules.
- **JSON is ~64% scope at 1.68 MB on a 15k-file repo** (task 22) — scope-trimming
  is the headline reporting win.
- **Hotspots docs should show a realistically noisy top-N** (CHANGELOG/lockfile/
  i18n) rather than auto-filtering (tasks 40–42) — evidence, not verdicts.

## Conventions

Every task file uses the shape defined in `01-shared-context.md`
("Task-file conventions"): a one-line header block (Status / Track / Size /
Depends on / Blocks) then `## Goal · ## Background · ## Seams to touch ·
## What to do · ## Open decisions / Locked decisions · ## Testing ·
## Out of scope`. Open architectural choices are left as **Open decisions** with
a recommendation rather than force-resolved; choices confirmed later are recorded
as **Locked decisions** or **Closed decision** so implementers do not re-escalate
them.

When a task lands, mark its row **Done** here and move durable details into
`LOG.md` / `DECISIONS.md` / a `finished_work/` note per the repo's agent-notes
convention.
