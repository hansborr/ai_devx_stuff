# Leaf 23: Generated Lint Guidance Spike

Status: Spike landed (2026-05-16); 3-rule subset, decision pending.

## Problem

`docs/ai-harness.md` lists Musi's local ESLint rules by hand. The list can
drift from the rules themselves: a renamed rule, a changed diagnostic, or a
new rule added without harness update.

Upstream `eslint-plugin-llm-core` solves this by walking the active ESLint
config, pulling a per-rule `instruction` string from each rule module, and
writing a generated markdown file injected into `AGENTS.md` / `CLAUDE.md`
between sentinel comments.

## Decision

Spike a Musi adaptation:

- Each `local/*` rule exposes a short `principle` string (and optional
  guide/codemod reference) in its `meta`.
- A generator script walks `eslint.config.js`, collects principles, and
  writes a sibling doc rather than expanding `AGENTS.md`.
- The sibling doc is linked from `docs/ai-harness.md`. `AGENTS.md` stays
  the stable global entry point.

This is explicitly a spike, not a roadmap commitment. The decision after
the spike is: keep the generated doc, drop it, or fold into Leaf 25
(diagnostic/rule metadata).

## Sequencing With Leaf 25

This leaf answers whether generated lint guidance is useful at all. Leaf 25
answers whether a broader metadata schema is worth standardising after a real
consumer exists. If this spike is kept, Leaf 25 should consume or formalise
the fields proven here. If this spike is dropped, Leaf 25 should not recreate
the generated-doc layer unless a different consumer justifies it.

## Rollout

1. Pick three representative local rules
   (`local/structured-logging`, `local/no-barrel`, `local/strict-trpc-input`)
   and add a `principle` field to their `meta`.
2. Write `scripts/generate-lint-guidance.ts` that loads
   `eslint.config.js`, collects per-rule principles, and emits a markdown
   file (e.g., `docs/generated/local-lint-rules.md`).
3. Add a `bun run docs:lint-guidance` script. Decide whether the generated
   file is committed (probably yes — it should be discoverable) and add a
   `--check` mode for CI freshness.
4. Link the generated doc from `docs/ai-harness.md`. Do not duplicate the
   rule table inline.
5. Decide post-spike whether to roll out to remaining local rules or
   abandon.

## Open Questions

- Should the generator also pull data from the rule's `meta.messages` to
  show diagnostic templates? Useful for agent context, possibly noisy.

## Verification

- `bun run docs:lint-guidance` (new) — verify clean run on three sample
  rules.
- `bun run docs:lint-guidance -- --check` should fail when a rule
  `principle` field is added but the generated doc is not refreshed.
- `bun run test:scripts:changed` for the generator script.

## Implementation Result

- `principle` field landed for `local/structured-logging`, `local/no-barrel`,
  and `local/strict-trpc-input`.
- `scripts/generate-lint-guidance.ts` walks `eslint.config.js`'s local plugin
  object and writes `docs/generated/local-lint-rules.md`.
- Root scripts now provide `bun run docs:lint-guidance` and
  `bun run docs:lint-guidance:check`.
- `scripts/test-generate-lint-guidance.sh` smokes write mode and freshness
  check mode through `scripts/test-scripts.sh`.
- `docs/ai-harness.md` links the generated rule-principles doc without
  replacing the existing inline local-rule sensor list.
- Verdict: keep through one or two rule diffs; if `principle` stays stable and
  useful, expand to all local rules and revisit Leaf 25 metadata. If it drifts
  or rots, drop this layer and revisit Leaf 25 alone.

## References

- See git history for original evaluation
- `/home/node/tmp/eslint-plugin-llm-core/` — upstream reference (not
  committed)
