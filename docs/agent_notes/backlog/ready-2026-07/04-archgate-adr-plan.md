# Archgate ADR Plan for Musi

Status: Done — pilot implemented 2026-07-20 (ADR skeleton, checked
ADR-0001/0003, harness gate, and legacy concurrency-source retirement);
expansion implemented 2026-07-25 (ADR-0002/0004/0005/0006 with their gate
messages and tests, §5). Both queue rows are closed (`C1`, `F3`) and archived
in [`../../finished_work/ready-2026-07-drain.md`](../../finished_work/ready-2026-07-drain.md).
Source-note retirement is deferred with cause and tracked as `D1` in
[`00-index.md`](./00-index.md) §4 — see "Retiring `decisions-*.md` Sources".
Date: 2026-05-10
Repo inspected: `/workspace`

## Constraint

I did not modify the repo. `docs/agent_notes/STATUS.md` and `NEXT.md` currently
say no active leaf is promoted, so this is a handoff plan rather than an active
queue change.

## Goal

Add a narrow ADR layer for architectural decisions that are enforced by
deterministic gates. The outcome should be:

- lint/check messages name a stable ADR id for non-obvious architecture rules;
- each ADR explains the "why", status, related guide, and enforcing gates;
- a small checker prevents broken ADR/gate cross-links;
- existing repair guidance stays in rule messages and guides.

This should extend Musi's existing guide + sensor + repair model in
`docs/ai-harness.md`, not replace it.

## Non-Goals

- Do not ADR every lint rule.
- Do not move general how-to recipes out of `docs/guides/`.
- Do not replace `docs/authorization.md`, `docs/CONCURRENCY.md`, or
  `docs/socket-architecture.md`.
- Do not add more global `AGENTS.md` instructions unless the workflow changes
  for every agent on every session.

## ADR Rule

Only create an ADR when all of these are true:

1. The decision is architectural or behavior-significant.
2. The reason is not obvious from the local code.
3. At least one deterministic gate enforces it now or in the same leaf.

If there is no gate, keep the note in `docs/agent_notes/DECISIONS.md` or the
area doc. If the rule is just maintainability pressure, improve the lint
message instead.

## Proposed ADR Format

Create `docs/adr/NNNN-title.md`:

```markdown
---
id: ADR-0001
date: 2026-05-10
status: Accepted
enforced_by:
  - local/concurrency-guard
  - RawTxClient restricted import
  - Restricted Prisma delegate types
guide: docs/guides/add-race-sensitive-mutation.md
---

# Race-sensitive writes go through mutation helpers

## Context
Why this rule exists and what broke or could break without it.

## Decision
The invariant contributors must preserve.

## Consequences
How future changes should behave, including sibling gates and repair path.
```

Use `Superseded by ADR-000N` rather than editing history when a decision
changes materially.

## Initial ADR Candidates

Start with six. These already exist as docs or `DECISIONS` entries, so the work
is mostly extraction and cross-linking.

1. `ADR-0001` Race-sensitive writes go through mutation helpers.
   - Source: `docs/CONCURRENCY.md` and the concurrency-domain decision source
     retired by this pilot.
   - Gates: `local/concurrency-guard`, `RawTxClient` restricted import,
     restricted Prisma delegate types, `codemod:concurrency-guard`.

2. `ADR-0002` Character ownership mismatch returns `NOT_FOUND`.
   - Source: `docs/authorization.md`,
     `docs/agent_notes/decisions-auth.md`.
   - Gates: auth/router tests around character access helpers.

3. `ADR-0003` Socket broadcasts happen after commit and through the registry.
   - Source: `docs/socket-architecture.md`,
     `docs/guides/add-socket-broadcast.md`.
   - Gates: `local/no-broadcast-in-transaction`,
     `local/socket-registry-broadcasts`, broadcast registry tests.

4. `ADR-0004` tRPC procedures use shared schemas and explicit outputs.
   - Source: `docs/guides/add-trpc-procedure.md`,
     `docs/agent_notes/decisions-schemas.md`.
   - Gates: `local/strict-trpc-input`, `local/trpc-require-output-schema`,
     `local/trpc-shared-input-schema`, `local/trpc-shared-output-schema`,
     app-router output coverage test.

5. `ADR-0005` Shared package APIs use subpath exports, not broad barrels.
   - Source: `docs/agent_notes/decisions-build.md`, the closed DX5-DX8
     roadmap (`docs/roadmap/developer-experience.md`, removed 2026-07-19;
     git history).
   - Gates: shared schema barrel import ban, `local/no-barrel`,
     `codemod:expand-barrel`.

6. `ADR-0006` `packages/shared` cannot depend on app/runtime adapters.
   - Source: `AGENTS.md`, architecture docs, current import restrictions.
   - Gates: restricted imports in `eslint.config.js`.

Skip `local/max-lines`, `local/no-explicit-any`, and `local/test-file-location`
for now. Their current messages are the right level of ceremony.

## Retiring `decisions-*.md` Sources

Where an ADR's source is a `docs/agent_notes/decisions-*.md` note, retire that
note as part of the ADR's leaf. Architecture docs (`authorization.md`,
`CONCURRENCY.md`, `socket-architecture.md`) and guides stay — see Non-Goals.

Retirement requires, in order:

1. **Parity check.** The ADR (plus any guide it links to) covers every
   durable detail from the decisions note: the rule itself, the rationale,
   sibling gates, and the repair path. Drop only redundancy, not history.
2. **Reference sweep.** `rg -n "decisions-<topic>"` across the repo returns
   no remaining live references, or each one has been updated to point at
   the ADR id.
3. **Delete, don't stub.** Remove the `decisions-*.md` file outright. The
   ADR id is the new stable handle; redirect stubs rot and split rationale
   across two files again.

Source-note retirement is a separate step from promoting the ADR, not part of
it: a promoted ADR whose source note still stands is landed, with a retirement
follow-up owed. Concretely, the retirements owed are:

- ADR-0001 retires its concurrency-domain decision source.
- ADR-0002 retires `decisions-auth.md`.
- ADR-0004 retires `decisions-schemas.md`.
- ADR-0005 retires `decisions-build.md`.
- ADR-0003 and ADR-0006 have no `decisions-*.md` source; nothing to retire.

`decisions-realtime.md` and `decisions-services.md` are not claimed by any
candidate ADR and stay as-is.

**Deferred 2026-07-25 — tracked as `D1` in
[`00-index.md`](./00-index.md) §4, which is where the ruling is owed.** The
evidence is recorded here so the row stays short. The expansion leaf promoted
ADR-0002/0004/0005/0006 but retired none of their source notes, because
"delete, don't stub" cannot pass the parity check as written. Each file holds
several unrelated decisions and the ADR absorbs exactly one:

- `decisions-auth.md` — 2 entries; ADR-0002 covers only "Character ownership
  errors return `NOT_FOUND`". The `queryClient.clear()` cache-reset entry is
  unrelated and has no ADR.
- `decisions-schemas.md` — 3 entries; ADR-0004 covers only "Output-schema
  regression gate walks the Zod tree". Combat-state-by-reference and creation
  spell choices are unrelated.
- `decisions-build.md` — 6 entries; ADR-0005 covers only "`@musi/shared`:
  subpath exports, no root barrel". `docs/agent_notes/README.md:11` also deep
  links the soft-AI-hook-nudges anchor in that file.

Deleting any of the three would drop durable history the ADR does not carry,
which step 1 forbids. The choice is the owner's: either narrow retirement to
per-entry extraction (the ADR absorbs its entry, the entry is removed, the file
survives), or rehome the orphans first and then delete. `DECISIONS.md`'s index
sub-bullets need the matching edit either way.

## Implementation Plan

### 1. Add the ADR skeleton

- Add `docs/adr/README.md` with:
  - when ADRs are allowed;
  - frontmatter schema;
  - status values: `Proposed`, `Accepted`, `Superseded by ADR-000N`,
    `Deprecated`;
  - rule that every accepted ADR needs `enforced_by`.
- Add `docs/adr/0001-race-sensitive-writes.md` and
  `docs/adr/0003-socket-broadcasts-after-commit.md` as the pilot.
- Keep each ADR short. Link to the longer guide or architecture doc instead of
  duplicating it.

### 2. Cross-link the pilot gates

Update only the messages for the pilot decisions:

- `eslint-rules/concurrency-guard.js`
- `eslint-rules/no-broadcast-in-transaction.js`
- `eslint-rules/socket-registry-broadcasts.js`
- RawTxClient restricted import message in `eslint.config.js`

Message shape (WHY/FIX template):

```text
Direct encounter.update bypasses the mutation-helper boundary (ADR-0001)
  WHY: race-sensitive writes must run inside the helper's transaction wrapper
       to avoid lost updates under concurrent writers.
  FIX: use the documented helper or run
       `bun run codemod:concurrency-guard -- <file>`. See docs/CONCURRENCY.md.
```

Three jobs, one per line: the ADR id makes the decision discoverable; the WHY
line keeps the rationale legible at fire-time so the agent doesn't have to
follow the link to know whether to suppress or fix; the FIX line carries the
repair command and guide path. Cap each line at roughly one sentence — if the
why doesn't fit, the ADR is doing the wrong job.

Apply the same template to `local/no-broadcast-in-transaction` and
`local/socket-registry-broadcasts` in the pilot. Existing one-line messages on
those rules get rewritten, not appended to.

### 3. Add `adr:check`

Add a small deterministic checker:

- script path: `scripts/check-adr-archgates.ts` or
  `scripts/adr-check.ts`;
- package script: `adr:check`;
- test coverage in `scripts/test-adr-check.sh` or a Vitest script test.

Minimum checks (cross-link scanning, no separate registry):

- every `ADR-000N` referenced in `eslint-rules/`, `eslint.config.js`,
  `scripts/`, and `packages/` exists under `docs/adr/`;
- every accepted ADR has non-empty `enforced_by`;
- every `enforced_by` entry resolves against the actual repo: ESLint rule
  names exist in `eslint-rules/` or `eslint.config.js`; codemod names exist
  as scripts; named test files exist; documented import restrictions are
  present in `eslint.config.js`;
- superseded ADRs are not referenced by active gate messages;
- duplicate ADR ids fail.

Resolve `enforced_by` entries by scanning the actual source — don't maintain a
separate registry of "known gates." A registry is a third source of truth that
rots quietly the moment a gate is renamed or removed; cross-link scanning fails
loudly in the same situation, which is the whole point of the sensor.

For this to work, `enforced_by` entries need to be machine-resolvable. Use
stable identifiers (rule names, file paths, named import-restriction ids in
`eslint.config.js`) rather than free prose. The pilot ADRs should establish the
naming convention.

### 4. Wire the checker into the harness map

- Add `adr:check` to `docs/ai-harness.md` as a sensor.
- Add the ADR guide row to the guide table.
- Mention the rule in the Promotion Rule area:
  architectural gates should carry repair text and, when non-obvious, an ADR id.
- Decide later whether `adr:check` belongs in `verify:changed`, `doctor`, or
  only `test:scripts`. The first leaf can keep it as a script smoke test.

### 5. Expand after the pilot

Done — all four promoted 2026-07-25 in the expansion leaf:

- `ADR-0002` character `NOT_FOUND` — `docs/adr/0002-character-not-found-semantics.md`;
- `ADR-0004` tRPC schema/output boundary — `docs/adr/0004-trpc-shared-schema-boundary.md`;
- `ADR-0005` subpath exports / no broad barrels — `docs/adr/0005-shared-subpath-exports.md`;
- `ADR-0006` shared package layering — `docs/adr/0006-shared-package-layering.md`.

Only their related gate messages and tests changed. Two residual notes:

- ADR-0002 has no lint or codemod gate; its `enforced_by` is `test-file:` only,
  matching the candidate list above.
- The `restricted-import:` locator kind resolves only `importNames` patterns,
  so the barrel ban (`regex`) and the shared-layering bans (`group`) are
  addressed by `test-file:` locators over the config-resolution tests instead.
  Extending the locator grammar to `regex`/`group` patterns is deliberately not
  part of this leaf.

Source-note retirement (see "Retiring `decisions-*.md` Sources") is **not**
done and is deferred with cause — see the note in that section.

## Verification

For the pilot leaf:

```bash
bun run vitest run --project=eslint-rules \
  eslint-rules/concurrency-guard.test.js \
  eslint-rules/no-broadcast-in-transaction.test.js \
  eslint-rules/socket-registry-broadcasts.test.js
bun run test:scripts
bun run adr:check
bun run verify:changed
```

If `adr:check` is implemented as a script smoke test, `bun run test:scripts`
should cover it as well.

## Acceptance Criteria

- `docs/adr/README.md` exists and defines the narrow ADR policy.
- Pilot ADRs exist with stable ids, status, date, guide, and `enforced_by`.
- Pilot lint/config messages follow the WHY/FIX template and name the ADR id
  on the summary line.
- `adr:check` fails on: missing ids, duplicate ids, accepted ADRs without
  gates, `enforced_by` entries that don't resolve in the repo, and active
  references to superseded ADRs.
- For each pilot ADR with a `decisions-*.md` source: that file is deleted and
  `rg -n "decisions-<topic>"` returns no live in-repo references.
- `docs/ai-harness.md` lists ADRs and `adr:check` in the guide/sensor map.
- No maintainability-only rules were promoted into ADRs.

## Risks and Guardrails

- Risk: ADRs become another stale doc pile.
  - Guardrail: no accepted ADR without `enforced_by`; checker enforces it.

- Risk: lint messages become too verbose.
  - Guardrail: include only `ADR-000N`, one-line why, repair command/path.

- Risk: duplicate rationale across ADRs, guides, and architecture docs.
  - Guardrail: ADR states the invariant and links outward; guides keep recipes.

- Risk: checker turns into a broad static-analysis project.
  - Guardrail: use typed locators resolved from real sources and exact id
    scanning, without a separate gate registry.

## Recommended First Leaf

Promote a small pilot:

> Add ADR skeleton, implement `adr:check`, cross-link concurrency and
> socket-broadcast gates with the WHY/FIX template, and retire the legacy
> concurrency source once ADR-0001 reaches parity. (ADR-0003 has no source
> note to retire.)

This gives the pattern enough surface to prove itself — message format,
sensor, and source-retirement all exercised — while keeping the first change
reviewable. If it feels heavy after that pilot, stop there and keep the
current `decisions-*.md` files as the primary record for the rest.
