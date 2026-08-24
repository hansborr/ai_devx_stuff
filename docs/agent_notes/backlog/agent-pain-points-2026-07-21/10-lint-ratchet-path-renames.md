# 10 — Preserve lint-ratchet identity across path renames

Status: Proposed — ready for design review
Date: 2026-07-21
Priority: P2
Size: L
Risk: high

> Scheduling note (owner decision 2026-07-22): this need not stay parked until
> a real baselined-file move appears. Simulate the trigger — fixture-driven
> renames of baselined findings across all three metrics — and land the
> capability preventively.
>
> Merge gate (owner decision 2026-07-22): implementation and its cost are
> approved, but a clean local gate is necessary and **not** sufficient to land.
> Because this changes debt-accounting correctness and the append-only debt log,
> the completed branch must pass a thorough cross-model review panel (see
> `cross-model-boundary-review-dispatch`) before merge. Doing the work is
> approved even if the panel ultimately decides not to merge the result.

## Problem

Moving a file that carries lint-ratchet findings is not debt-neutral today.
Update and debt accounting compare items by the exact `(ratchet id, path)`
key, so the old path looks removed while the destination looks like new debt
with a floor of zero. Even an unchanged move therefore requires either a fake
`--allow-worse` acceptance or a real code fix made only to let the move land.

This happened during the lint-ratchet package-seam move. Slice S3 avoided the
false accounting choice by fixing the moved finding, and the completed package
leaf retained the missing primitive as follow-up work. The operator guide is
currently more optimistic than the implementation: it says an equal/lower
rename can update the baseline in the same commit, but no command can declare
the identity move.

This is not only a rekey operation. Debt accounting compares an arbitrary Git
range, so it must replay a history such as `old -> middle`, an accepted increase
at `middle`, and `middle -> new`. Replaying all renames first and then matching
accepted-debt rows by the endpoint path loses that identity and either rejects
valid history or lets stale rows authorize a different item.

## Verified evidence

- `tools/lint-ratchet/src/kernel/baseline-update.ts` compares the committed
  baseline directly with generated items under identical path keys. It has no
  path-identity input or preprocessing stage.
- `tools/lint-ratchet/src/governance/baseline-debt-accounting.ts` classifies a
  current path absent at the same base key as `new-path`, then sends the base
  and current baselines independently to the increase and lifecycle collectors.
- `tools/lint-ratchet/src/governance/baseline-debt-accounting-chains.ts`
  replays accepted increases by exact path. It cannot carry one chain through a
  later rename.
- `tools/lint-ratchet/src/governance/debt-log-schema.ts` has accepted-debt,
  retirement, metric-migration, and coverage-shrink variants, but no non-debt
  path-identity event.
- `tools/lint-ratchet/src/governance/baseline-update-apply.ts` already provides
  append-before-atomic-baseline-write and exact-tail retry behavior. The new
  event sequence must reuse and strengthen that seam rather than create a
  second writer.
- `scripts/lint-ratchet/cli.ts` uses `node:util.parseArgs` tokens. A repeatable
  three-positional option is not a native `parseArgs` value shape and cannot be
  added by declaring a string option alone.
- `docs/agent_notes/backlog/lint-arch-review-2026-07/02-slice-plan.md`, around
  the S3 Option B record, preserves the historical reproduction.
- `docs/guides/lint-ratchet.md` describes same-range per-path debt accounting
  and, in its path-rename section, claims a workflow the CLI cannot perform.

Source:
`/home/node/persist/musi/pain_points/lint-ratchet-and-source-policy.md` and
`/home/node/.claude/projects/-workspace/memory/lint-ratchet-package-seam-s3.md`.
The gap remains open; it is not a request to reopen the completed package-seam
work.

## Proposed operator contract

Add an explicit, repeatable, update-only declaration:

```sh
bun run lint:ratchet:update -- \
  --rename-path \
  ratchet/local-no-swallowed-errors-broader-semantics \
  scripts/lint-ratchet/eslint-runner.ts \
  tools/lint-ratchet/src/kernel/eslint-runner.ts
```

The grammar is exactly
`--rename-path <ratchet-id> <from-repo-path> <to-repo-path>`. The flag may be
repeated, and only the space-separated form is accepted. `--rename-path=x`, a
missing member, an intervening option, a bare positional, and use outside
`--update` are usage errors. Because `parseArgs` consumes at most one string
value, the adapter must split or token-walk these four-token groups before the
ordinary head parse, preserving argv order and existing `--` behavior. Tests
must pin repeated and interleaved groups so a future parser refactor cannot
silently change the grammar.

Each declaration identifies one item move. Repeat it for multiple files or for
one file covered by multiple ratchets. A move whose finding disappeared needs
no declaration: removal remains an ordinary strict improvement. Do not infer
moves from Git similarity scores, contents, or equal finding payloads; those
heuristics are ambiguous for count-only items and unstable across staged,
worktree, custom-base, and multi-commit comparisons.

If the destination is genuinely worse, compose the declaration with the
existing accepted-debt contract:

```sh
bun run lint:ratchet:update -- \
  --rename-path ratchet/example old/path.ts new/path.ts \
  --allow-worse \
  --reason "<why the additional debt is accepted>"
```

## Event and identity model

Introduce a versioned `path-rename` debt-log event. It is non-debt, but it must
carry enough immutable identity to replay without consulting the current
registry: ratchet id, rule id, metric, normalized source and destination paths,
and the complete source and destination metric-item snapshots. Validate both
snapshots through the metric strategy. The source snapshot is the item at that
point in the event stream; the destination snapshot is equal or better for a
plain migration. For a worse destination, the rename event first moves the
unchanged source snapshot and the immediately following accepted-debt event
advances it to the generated value.

The existing accepted-regression wire fields do not contain every metric-item
identity field (for example, complexity `perFunction` detail and message
fingerprints). Ordered replay must not synthesize or borrow those fields from
the final baseline. Extend the versioned accepted-debt event with complete
before/after metric-item snapshots, or introduce an equivalent versioned event
envelope, so every transition consumes and produces a full validated item.
Keep parsing of historical version-1 rows for old ranges, but fail closed with
an actionable migration boundary if an old row lacks the identity needed to
continue through a later rename.

Policy metadata is deliberately not rewritten by a rename event:

- `ruleId` and `metric` are identity and must match the source ratchet state;
  combine neither a metric migration nor a retirement with a path rename for
  the same ratchet in one update.
- `mode`, `target`, `files`, `ignores`, `ruleOptions`, `configHash`, and
  `ruleSourceHash` continue through the existing update and lifecycle policy.
  A rename neither authorizes nor suppresses their changes. In particular,
  moving coverage globs may still require a coverage-shrink record and reason.
- Registry/config drift is validated normally before rename declarations are
  applied. A rule/source/options change cannot make an otherwise invalid
  rename valid, and path identity must never be inferred from `configHash`.

The update path builds a virtual committed baseline by applying the declared
renames in argv order. Each event must consume the exact current source
identity, find the destination unoccupied, and preserve test identity. Feed
that one virtual baseline to the normal comparator, coverage-shrink collector,
metric-migration collector, retirement/orphan collector, and every other
lifecycle comparison. Do not rekey only the item-increase comparator: that
would let the same moved path be treated under two histories by different
collectors.

## Ordered range replay

Debt accounting must parse the appended JSONL suffix once and replay all event
kinds in file order against a virtual copy of the base baseline. The reducer
must do the following atomically per event:

1. A `path-rename` consumes the exact ratchet/rule/metric/path/item source
   identity and installs its recorded destination snapshot.
2. An accepted-debt row consumes the exact prior full item state at its
   then-current path and advances to its recorded full item state using the
   existing metric-specific transition rules.
3. Coverage-shrink, metric-migration, retirement, and orphan accounting observe
   the state produced by all earlier events, then apply or validate their own
   transition. No lifecycle collector gets the unreplayed base baseline.
4. The final replayed baseline is compared with the current baseline. An event
   already present in the base prefix grants no authority, and out-of-order,
   stale, duplicate, fabricated, or gapped transitions fail.

This ordering is load-bearing. Tests must cover, for each of `message-count`,
`effective-line-count`, and `complexity-severity`, the exact sequence:

```text
old/path --rename--> middle/path --accepted increase--> middle/path
         --rename--> new/path
```

The accepted increase must change the metric's controlling value, and the
second rename must consume that increased full item snapshot. Include a mixed
multi-ratchet stream to prove global JSONL order is preserved while identities
remain independent.

## Write and retry ordering

Build the complete ordered event batch before either artifact changes. For a
worse rename, the batch order is path-rename then accepted-debt; related
coverage/lifecycle events follow the same deterministic transition order used
by replay. Validate the proposed batch by replaying it from the committed
baseline, append the whole batch, then atomically write the baseline.

Retry after a crash between append and baseline write must recognize only an
exact full-batch tail match, including order and full item identity. It must not
accept a set-equivalent, partial, permuted, or metadata-different tail. A retry
with the already-appended exact batch writes the baseline without duplicating
events; any partial or conflicting tail fails closed with recovery guidance.

## Acceptance

- Equal and lower moves pass plain update for all three metrics, write one
  path-rename event, and write no accepted-debt event.
- A higher destination fails without `--allow-worse`. With a non-placeholder
  reason it writes path-rename then accepted-debt, and measures the regression
  from the source floor rather than zero.
- The ordered `rename -> accepted increase -> rename` range replays for all
  three metrics. Reordering either rename around the acceptance, changing any
  snapshot field, or omitting the middle transition fails.
- Missing or still-live sources, occupied or missing destinations,
  unknown/wrong ratchets, changed rule/metric identity, invalid metric-item
  snapshots, non-normalized paths, duplicate endpoints, cycles, and
  fabricated/gapped chains fail before either file changes.
- Multiple mappings and their associated lifecycle events have one documented,
  deterministic ordering. An unrelated current path remains a `new-path`
  regression.
- The replayed virtual baseline feeds increase, coverage-shrink, metric-change,
  retirement/orphan, and any future lifecycle collector through one API.
  Coverage moves cannot be hidden by comparing lifecycle against the raw base.
- Policy-only changes retain their existing acceptance requirements; a rename
  cannot authorize a metric migration, retirement, config/rule-source drift, or
  coverage shrink.
- `lint:ratchet:debt-log` labels migrations as non-debt and counts only true
  growth as accepted debt.
- Exact-tail retry succeeds without duplicates. Partial, reordered, or
  identity-mismatched tails do not write the baseline.
- Worktree, `--staged`, and `--base-ref` accounting modes produce the same
  result for the same baseline and log blobs.
- CLI tests pin the parseArgs-compatible repeatable grammar and actionable
  errors. Kernel tests cover declaration validation and all three strategies;
  governance tests cover schema parsing, ordered mixed-event replay,
  lifecycle interactions, append/retry, and report categories. A non-Musi
  fixture proves package portability.
- The completed package-seam leaf and its index link here as the authoritative
  follow-up. The S3 slice-plan account remains unchanged as historical evidence.

## Verification

Run focused tests while implementing, then use the normal commit gate:

```sh
bun run test -- tools/lint-ratchet/src/kernel/baseline.test.ts
bun run test -- tools/lint-ratchet/src/governance/baseline-debt-accounting.test.ts
bun run test -- tools/lint-ratchet/src/governance/debt-log-schema.test.ts
bun run test -- tools/lint-ratchet/src/governance/debt-log-write.test.ts
bun run test -- scripts/lint-ratchet/cli.test.ts
bun run lint:ratchet:check-debt-accounting
```

Add exact new or renamed focused test paths when the design is split.
Verification must include the package Vitest project and Musi CLI adapter; a
passing adapter-only test is insufficient.

## Out of scope

- Ratchet-id renames or combined rule/metric migrations.
- Git rename detection, similarity thresholds, or automatic equal-payload
  pairing.
- A lint-ratchet baseline schema-version bump; the baseline shape is unchanged.
- Relaxing the symmetric gate, append-only debt log, semantic merge behavior,
  or package/adapter boundary.
