# 44 — The authoritative harness map presents only part of the local-rule inventory

Status: Done
Track: DOC (docs) · Priority: P3 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** The manual sensors table contains 17 of 23 registered local rules. Six rules are omitted entirely even though the docs landing page calls the map authoritative for every lint rule.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/README.md:13-16` — `ai-harness.md` is described as the authoritative inventory of every lint rule.
- `docs/ai-harness.md:249-261`, `docs/ai-harness.md:264`, `docs/ai-harness.md:272`, and `docs/ai-harness.md:289-290` — the unlabeled sensors table manually names only 17 local rules.
- `eslint-config/local-plugin.js:27-52` — 23 rules are registered; six omitted names include `type-assertion-boundary`, `socket-listener-cleanup`, `no-arbitrary-tailwind-value`, `no-outer-client-in-transaction`, `no-plain-error-in-trpc`, and `no-redundant-central-mock`.

Failure: A public reader cannot distinguish a curated example table from a complete inventory, and manual rows can drift while `harness:check` remains green.

## Do

Label the table as selected examples and make the generated rule catalog visibly canonical, or generate all rows from rule metadata. Avoid maintaining a second unlabeled partial inventory.

## Verify

```
bun run docs:lint-guidance:check && bun run harness:check
```

## Acceptance

- The authoritative inventory exposes all 23 rules or clearly delegates completeness to a generated catalog.
- No partial table presents itself as exhaustive.
