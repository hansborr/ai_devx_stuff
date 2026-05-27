# Lint Hardening Review Followup

Status: Planning
Branch: `feature/lint-hardening-review-followup` (off `main`)

Reviewer feedback on the merged `feat/lint-hardening` branch produced two
classes of work:

- **Tier 1 — small follow-up PR.** Bug fixes in the new `type-assertion-boundary`
  rule, dead tRPC procedures the Knip sweep missed, a tautological smoke test,
  a mislabelled sensor finding, a commitlint body-length regex bug, and 14
  redundant `if (result.success)` blocks. The reviewer asked for this as "a
  small follow-up branch."
- **Tier 2 — three larger PRs.** The reviewer's "next 3 PRs" recommendation:
  a local lint rule contract, a harness manifest + generated map, and
  machine-readable diagnostics.

This index file is the single read-once entry point. Each PR has its own scout
doc with the concrete change list, file pointers, and verification command.
When a slice lands, fold its durable details into `LOG.md` and a
`finished_work/` note, and update `STATUS.md` / `NEXT.md`.

## Tier 1 — Small follow-up PR

Single branch, single PR. Each item is small and independently
verifiable; bundling avoids review churn for trivial fixes.

Scout: [`lint-hardening-review-followup-tier-1.md`](./lint-hardening-review-followup-tier-1.md)

Items:

1. Done 2026-05-17: Dead `sorceryPoint.use` / `sorceryPoint.recover` tRPC procedures — delete
   the procedures (and their server tests, the client mock-trpc plumbing, and
   the unused service exports), or document them as deliberate API surface and
   add them to the Knip ignore list. Production callers only use
   `convertSlotToPoints` and `createSlotFromPoints`.
2. `type-assertion-boundary` rule — JSDoc-style boundary comments, `*.spec.ts`
   exemption, same-line-before and blank-line-above positions, build the
   boundary regex from `ALLOWED_CATEGORIES`.
3. `generate-lint-guidance` smoke test — `scripts/test-generate-lint-guidance.sh`
   is tautological (regenerate, then `--check` against what was just written).
   Replace with a real fixture-based check, and confirm CI invokes
   `bun run docs:lint-guidance:check`.
4. Commitlint trailer regex — `commitlint.config.js` `trailerLine` requires a
   hyphen, so `Fixes: #123`, `Closes: #45`, and `BREAKING CHANGE:` count toward
   the 40-char body minimum.
5. `sensor-blob-size.ts:298` — block-severity findings are formatted as `WARN:`;
   should be `BLOCK:` or `ERROR:`.
6. 14 migrated test sites retain redundant `if (result.success)` blocks after
   the `expectParseSuccess` / `expectParseFailure` migration; the helper return
   value already narrows `result.data`.

## Tier 2 — Three larger PRs

These should land in order; each builds on the metadata vocabulary of the
previous. They also unblock Leaf 25 (`backlog/lint-hardening/25-diagnostic-rule-metadata.md`).

### PR 1: Local lint rule contract

Scout: [`lint-hardening-review-followup-pr-1-rule-contract.md`](./lint-hardening-review-followup-pr-1-rule-contract.md)

Every `local/*` rule declares `meta.docs.principle`, `category`, `pairedGuide`,
`repairKind` (and optional `repairCommand`). The generator produces an entry
for every rule, not the three that happen to expose `principle` today. The
existing `message-guidance.test.js` is extended from sampled to all-local
diagnostics with an explicit exempt list.

This formalises the Leaf 23 spike and makes Leaf 25 implementable by
prescribing the metadata fields up front instead of inventing a parallel model.

### PR 2: Harness manifest + generated map

Scout: [`lint-hardening-review-followup-pr-2-harness-manifest.md`](./lint-hardening-review-followup-pr-2-harness-manifest.md)

`harness.controls.json` enumerates lint rules, codemods, verify wrappers,
doctor, drift, module index, logs audit, sensors, and hooks. A generator emits
`docs/generated/harness-controls.md`. `bun run harness:check` validates the
manifest against reality (rule names exist, scripts exist and are executable,
guides resolve). This is the structural sensor that catches "we added a rule
but never documented or wired it" drift.

### PR 3: Machine-readable diagnostics

Scout: [`lint-hardening-review-followup-pr-3-machine-readable-diagnostics.md`](./lint-hardening-review-followup-pr-3-machine-readable-diagnostics.md)

`--json` output for `doctor`, `verify:logs`, `module:index:check`, and
`migration-safety-scan`. `lint:agent:local-rules` consumes ESLint JSON output
plus the PR 1 rule metadata to produce compact agent-facing repair summaries.
The shape is the same `Why: / How to fix:` contract as the in-message guidance,
but structured so an agent can `jq` it.

## Dependencies and ordering

- Tier 1 is independent of the three PRs and should land first to clear small
  real risks.
- PR 1 must land before PR 2 (the manifest references rule metadata fields).
- PR 2 must land before PR 3 (the JSON outputs reference manifest control IDs).
- Leaf 25 (parked) is superseded by PR 1's contract and PR 2's manifest. When
  PR 2 lands, retire Leaf 25 with a pointer to the merged work.

## Verification (per PR)

Each scout doc lists the exact verification command. Default:

```
bun run verify:changed
bun run vitest run --project=eslint-rules
bun run lint -- --max-warnings=0
bun run typecheck
```

## Out of scope

- New ESLint rules. The reviewer was explicit that the parser rewrite and rule
  infrastructure are sound; this work is hardening and surface area, not new
  enforcement.
- The 321 deferred `type-assertion-boundary` findings in `packages/shared`,
  `packages/server`, and `packages/client` (Leaf 12 Pass D and beyond). Those
  need code rewrites and stay in the lint-hardening backlog.
- Anything in the deferred Leaf 21 / Leaf 9 strict-boolean / Leaf 11 (raw
  fetch, Date.now, timers) backlog.
