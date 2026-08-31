# drift:ai supported subcommand reference

Detail for the supported non-report subcommands. The authoritative subcommand
enumeration is the table in the [README](../README.md); prototype-lane
subcommands are documented in
[prototype-subcommands.md](prototype-subcommands.md), and the Musi-only ones in
[musi-integration.md](musi-integration.md).

## The `config` subcommand (read-only inspection)

`config` answers "what config will drift:ai actually use here?" before you run a
scan. When a sweep skips files or runs unexpected checks, it confirms which config
was auto-discovered, which roots are in effect, and what defaults were filled in —
without having to run the whole report first.

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts config
bun <tools-checkout>/scripts/drift-ai.ts config --config drift-ai.config.json
bun <tools-checkout>/scripts/drift-ai.ts config --format json --output effective-config.json
```

It is **strictly read-only**: it loads and normalizes config exactly as a scan
would (same auto-discovery, same `--config` override), then renders the result. It
runs no checks and **never creates, rewrites, or normalizes a config file on
disk** — generating a `drift-ai.config.json` is deliberately out of scope.

Like the other subcommands it anchors discovery to the **target** repo (the cwd's
`git --show-toplevel`), not the tools checkout, so the reported roots and repo
root describe the repo you are scanning. The output names:

- the **config source** — `default` (no file; built-in defaults), `auto-discovered`
  (`drift-ai.config.json` at the target root), or `explicit` (a `--config` path);
- the **repo root** used for discovery;
- the **roots** and **source extensions** (built-in extensions plus any
  `additionalSourceExtensions`) the scan would consider;
- the **default check set** (a no-`--check` run) and the **implemented check set**
  (everything `--check all` enables).

Text output is a concise summary; `--format json` carries the full effective
config (ignore rules, per-check config, `coverage`, `envDefine`) under a
`kind: "config-inspection"` envelope. That envelope is intentionally **not** the
portable `DriftReport` (`--format json` on a scan) nor a `kind: "advisory"` row, so
a consumer can tell an inspection from a scan or an advisory at a glance.

## The `hotspots` subcommand (advisory)

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts hotspots \
  [--lens churn|coupling|fragmentation|suppression-churn|thrash|all] [--window 14] \
  [--top 20] [--min-support 3] [--baseline <prev.json>] [--format text|json] [--output <path>]
```

`hotspots` is a **report-only advisory** over a windowed `git log` walk — areas
that change a lot, surfaced as evidence for a human to weigh. It is **not** a
finding and is deliberately firewalled from the trusted checks:

- It is reachable **only** via `drift:ai hotspots` — never folded into
  `--check all` or the default report, and there is no `hotspots` check id.
- Its JSON top level is `{ "kind": "advisory", "sections": [...] }` — never the
  `findings` shape, never `WARN`/`FIX`. Each section is one lens.
- Every run prints a legible header (lens, window, commit count, churn metric,
  and a "not defects" banner) plus the complexity disclaimer — complexity is a
  lint-baseline concern, not a hotspot lens.

Lenses (`--lens`, default `churn`; `all` fans out to every implemented lens):

- **`churn`** — top files by churn (`revisions`, or `lines` on a squash repo). A
  _thresholded_ list, not a fixed top-N: a file shows only if it stands out (≥2×
  the in-window median); a flat distribution prints "no clear hotspots this
  window" and **zero** rows rather than padding to N.
- **`coupling`** — files that change together (co-change). Symmetric score
  `coOccur / min(revs)`. **Cross-boundary** pairs (different top path segment)
  sort to the top as the louder signal. Two structural legibility controls keep
  the list readable on large repos (they are **not** file classification):
  `--min-support` (default 3) drops the long tail, and a per-node degree cap (5)
  bounds how many partners any one file (a barrel/lockfile/locale) can
  contribute, so a clique stays _bounded but visible_, never auto-filtered. Wide
  commits (> 40 files) are skipped as sweeps.
- **`fragmentation`** — files touched by many distinct hands in-window: commit
  authors plus distinct `Co-authored-by` trailer identities, which surfaces agent
  hands in the same count. Default threshold is 3 distinct hands.
- **`suppression-churn`** — its own `git log -G'eslint-disable|@ts-'` pass for
  files that repeatedly gain or lose lint/type suppressions over the window.
  Default threshold is 2 suppression-changing commits.
- **`thrash`** — files with repeated edits but low net growth, with overlay
  columns for young-in-window age, fix/revert subject count (a tiebreaker only),
  and test-vs-source churn ratio. It needs line counts, so blobless checkouts
  report that the lens cannot compute instead of guessing.

Every hotspot row carries the cheap context that makes a human's judgment fast:
top authors/agents (from commit + `Co-authored-by` trailers), the 3 most-recent
commit subjects, regex commit-intent labels over those displayed subjects
(`fix`, `refactor`, `scaffold`, `generated`, `update`, or `unknown`), the **raw**
numbers behind any score, and a copy-paste `git log` inspect command. Intent
labels are overlay context only; they do not create rows or gates. Pass
`--baseline <prev.json>` (an earlier advisory JSON) to tag each row `↑NEW` /
`↑+N` / `↓-N` / `=steady` vs the prior run. (If the baseline measured churn with
a different metric — e.g. a squash run recorded `lines` — the churn deltas are
omitted and the header says so, since the scores are not comparable.)

Behavior worth knowing:

- **Whole-repo**, not `--scope`-gated; it has its own time axis. It reuses
  `isIgnoredPath` + your `ignore` config for path filtering and **nothing more**
  (no generated/codegen/i18n auto-detection — evidence, not verdicts, so the
  top-N can look noisy; you discount your own lockfiles/changelogs).
- **Window** defaults to 14 days (AI cadence). Sparse history widens the window
  automatically up to 180 days and **says so** in the header.
- **Churn metric** is `revisions` by default; on a suspected squash-merge
  workflow (most files single-revision in-window) it auto-switches to `lines` and
  discloses the switch.
- **Blobless partial clones** (`--filter=blob:none`) have no blob content, so the
  walk falls back to `git log --name-only`: revision counts stay exact, but
  per-file line counts are reported as unavailable (the header says so).
