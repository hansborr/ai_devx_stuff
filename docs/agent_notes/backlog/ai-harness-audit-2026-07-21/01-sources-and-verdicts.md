# Sources and Verdicts

Status: Parked audit report — source material
Date: 2026-07-21

## Method

Three discovery agents independently reviewed lint diagnostics, harness/hook
wiring, and command/test output. Three follow-up agents then reproduced the
highest-risk clusters: command-result/cache transport, edit-hook worktree
identity, and fail-open Git/backlog discovery. The primary agent reconciled
their reports against live code, git history, prior backlog packs, and current
diagnostic output.

A second adversarial pass assigned subsystem reviewers plus an independent
portfolio skeptic. It repeated the strongest reproductions, measured the
lint-coverage hook, checked simpler built-in alternatives, and challenged every
priority and proposed architecture. The resulting dispositions are the technical
recommendation for this parked pack; they do not replace named owner decisions
or promote work automatically. The original discovery verdicts remain evidence,
not an implementation queue.

## Adversarial portfolio verdict

- Preserve the correctness cores of 02-05 and 10, but trim cache retention,
  universal manifest modeling, and all-hook worktree migration from their first
  slices.
- Keep 06, 09, and 11-13 as secondary maintenance. The 20-path lint-coverage
  path measured about 16.9 seconds as separate processes versus about 1 second
  through one ESLint API instance, which justifies batching but not a new
  progress protocol.
- Split 08 into repair compatibility and optional capacity-rule expansion.
- Defer 07 and 17. Retain 14 as a small configuration cleanup while rejecting
  its aggregator shape; reject the implementation shapes in 16 and 20.
- Replace 18's identity token with an authoritative-link model, explicit residue
  leaves, and bounded reverse discovery. Revise 19 around structured active
  signatures rather than prose inference.
- Keep `ready-2026-07/00-index.md` as the only execution queue.

## Checks run

- `bun run harness:check` — passed: 173 controls, 31 local lint rules, 20
  ratchets, and 59 declared package scripts.
- `bun run docs:harness-controls:check` and
  `bun run docs:lint-guidance:check` — passed.
- `bash scripts/ai-hooks/test.sh` and `bun run test:eslint-rules` — passed.
- `bun run doctor` — no environment failures (`PASS=36 WARN=2 FAIL=0`); the two
  warning sections were report-only drift/Knip sensor findings.
- `bun run backlog:lint` — independently emitted six existing advisories. A
  Claude-wrapper reproduction hid the same report behind a generic OK line;
  Codex/Copilot retain raw first-run output but add redundant success context
  and can suppress later cached runs. See the live drift discussion below.

Passing checks do not invalidate the findings: most are untested transport,
fallback, cross-worktree, or multi-table cases outside the current fixtures.

## Strong foundations to preserve

- `harness.controls.json` generates hook wiring and maintained documentation;
  `harness:check` strongly rejects projection drift.
- Lint rules carry unusually concrete `why`/`howToFix` metadata and have a
  message-eval lane.
- Quiet verification wrappers retain bounded failure tails and log paths.
- `tidy-edited-file.sh` already has the correct Git-common-dir model for linked
  worktrees and is the implementation precedent for leaf 05.
- The green-output policy correctly distinguishes required summaries and
  backpressure; leaf 04 adds the missing category of requested report output.

## Live backlog drift

`ready-2026-07/00-index.md` contains 14 completed tasks still marked Ready.
Eight same-pack leaves are in later tables that `parseIndexTaskTable` never
visits: B17-B21, B24, C1, and C6. Six cross-pack tasks use implicit source
labels the checker cannot resolve: B2, B8, B11-B13, and B16. B3 demonstrates
why number/directory guessing is unsafe: its source leaf is Done while the
queue intentionally tracks a smaller residue. Leaf 12 owns same-pack
multi-table parsing; redesigned leaf 18 requires authoritative cross-pack links,
bounded reverse discovery, and separate residue leaves rather than heuristics or
an identity-exemption token.

## Existing work mapped, not duplicated

- `lint-deep-dive-2026-07/14-propose-mode-skips-registry-validation.md` remains
  the existing leaf for propose-mode validation.
- Leaf 20 records the rejection of broad verify heartbeat machinery; useful
  serial progress stays, and parallel launch suppression is only an optional
  cleanup. Leaf 14 remains an active P3/S configuration cleanup for optional
  status strings and the Prisma green stderr line while recording why a custom
  Codex aggregator is disproportionate.
- Intermediate-state tidy lint noise remains documented in
  `agent-friction-2026-06/03-edit-hooks-and-caches.md` D1/D2.
- AI-hook suite self-concurrency remains in `ai-hooks-suite-self-concurrency.md`.
- Leaf 03 explicitly supersedes H1/H2 from the agent-friction note; the source
  pack now links to the revised candidate.

## Lower-priority watch items not promoted

- Broad test-like script names currently receive generic flaky-test advice,
  even for deterministic CLI/configuration failures. Leaf 19 owns the
  evidence-based narrowing independently of failure-summary fairness.
- The current lint-message model eval is intentionally structural and cannot
  prove full-config repair compatibility. Leaf 08 adds deterministic
  compatibility fixtures rather than widening the model experiment.
- Script/hook file sizes are high, but current ready work already owns the
  `policy.sh` analytical-core split. No duplicate architecture leaf was filed.
