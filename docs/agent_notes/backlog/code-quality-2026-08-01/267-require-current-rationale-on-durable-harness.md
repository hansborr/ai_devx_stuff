# 267. Require current rationale on durable harness exceptions

Status: Landed on fix/cq-267
Theme: Require rationale metadata on ghost-file allow-pair exceptions · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Ghost-file allowed pairs are durable exceptions, but their configuration can
record only the two paths being exempted. Reviewers cannot tell why a pair is
an intentional module split, what structural condition keeps the exception
valid, or when it should be retired. A temporary permission and a deliberate
long-lived boundary therefore look identical after the authoring context has
left the diff.

Durable rationale fields elsewhere can fail in the opposite direction: they
exist, but accumulate ticket names, line deltas, and implementation history.
That changelog-shaped prose obscures the current justification and retirement
condition that later reviewers need. Git already owns the historical account;
the exception register should describe why the live structure remains
exceptional now.

## Evidence

- `drift-ai.config.json:15-29` — all eight
  `checks.ghost-files.currentAllowedPairs` entries are positional path pairs
  with no rationale metadata. Reproduce the count with
  `bun -e 'const config = await Bun.file("drift-ai.config.json").json(); console.log(config.checks["ghost-files"].currentAllowedPairs.length)'`.
- `scripts/drift-ai/config.ts:112-114` — `GhostFileAllowedPair` contains only
  a two-path `files` tuple.
- `scripts/drift-ai/config-readers.ts:149-167` — the parser requires a
  positional two-path array, normalizes and sorts the paths, and returns only
  `{ files }`, so it cannot retain rationale.
- `scripts/drift-ai/README.md:344-350` — the guide describes
  `currentAllowedPairs` as explicit exceptions for residual current-state pairs
  that the naming heuristic cannot classify.
- `eslint-config/max-lines-exceptions.baseline.json:147-159` — the live reasons
  for `routers/srd.ts` and `rest-service.ts` append `+1`/`+4` implementation
  deltas and a named `ux-audit` change to their durable structural
  justifications. Reproduce the two-entry measurement with
  `bun -e 'const { entries } = await Bun.file("eslint-config/max-lines-exceptions.baseline.json").json(); const stale = entries.filter(({ reason }) => /\+1|\+4|ux-audit/u.test(reason)); console.log(stale.length, stale.map(({ path }) => path))'`.
- `eslint-config/max-lines-exceptions-codec.js:101-116` — the shared max-lines
  parser requires only that `reason` be nonblank, so historical prose remains
  valid durable metadata.
- `scripts/max-lines-exceptions-core.ts:73-81` — baseline regeneration copies
  each reason through unchanged, allowing per-change clauses to persist across
  later cap updates.

## Proposed direction

Represent every ghost-file allowed pair as an object containing
`files: [left, right]` and a required, non-empty `rationale`. Update
`GhostFileAllowedPair`, the config reader, defaults, fixtures, and the live
eight-entry configuration together. Preserve the rationale while normalizing,
sorting, deduplicating, merging, and rendering the effective configuration;
pair matching itself should continue to use only the normalized file tuple.

Each rationale should state the present structural reason the two files are
legitimate companions and the condition under which the exception can be
removed. Update the ghost-files guide with that authoring rule and an example.
Do not store the introducing ticket, a historical line delta, or a narration of
the change that added the exception; that history belongs in Git.

Apply the same durable-rationale rule to the two live max-lines exceptions:
rewrite the `routers/srd.ts` and `rest-service.ts` reasons to retain their
current cohesion or pending-split justification while removing the `+1`/`+4`
and `ux-audit` implementation history. Keep the max-lines codec’s objective
nonblank check; present-tense structural quality is a review convention, not a
natural-language validation problem.

Add focused configuration coverage for missing, blank, and valid rationales,
normalization and deduplication with metadata intact, and JSON effective-config
inspection retaining the rationale. Keep matching and finding tests
behavior-identical after the configuration migration.

## Scope / caveats

- Do not broaden this into stale-entry ratcheting or suppression expiry owned by
  [169-suppression-allowlists-cannot-ratchet.md](./169-suppression-allowlists-cannot-ratchet.md),
  or into the ghost-file matching and mode-contract changes owned by
  [207-encode-ghost-files-mode-dependencies-as.md](./207-encode-ghost-files-mode-dependencies-as.md).
- Preserve ghost-file findings, ordering, role-marker behavior, pair identity,
  and changed/current scope semantics. Rationale is review and inspection
  metadata; it must not affect whether a pair matches.
- Prior-pack CQ25-10
  ([code-quality-2026-07-25/34-PLAN.md](../code-quality-2026-07-25/34-PLAN.md))
  does not add metadata to `currentAllowedPairs`. Migrate only this allowed-pair
  boundary; do not reopen its analyzer-contract or Zod work.
- Do not add changelog fields or attempt to infer present tense mechanically.
  Require a nonblank rationale structurally and enforce the current-justification
  convention through documentation, review, and focused examples.
- The folded max-lines cleanup is limited to rewriting the two cited live
  reasons and recording the durable-rationale convention. It does not change
  caps, severity, lifecycle, ratchet behavior, baseline regeneration, or the
  max-lines exception schema.
