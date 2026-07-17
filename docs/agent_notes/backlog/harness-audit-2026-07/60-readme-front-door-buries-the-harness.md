# 60 — README front door buries the harness

Status: Done
Track: DOC (docs) · Priority: P2 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** All proposed link targets exist, and the earlier rejected generated-HARNESS shape does not conflict with a dual-audience README path. The product Quickstart still dominates first contact.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `README.md:1-8` — the repository opens as a VTT product and gives harness visitors one sentence.
- `README.md:22-69` — the first substantial path is product setup, migration, seeding, and login.
- `README.md:111-115` and `README.md:128-143` — harness material appears later under quality gates and the structure tree.
- `docs/ai-harness.md`, `docs/guides/lint-overview.md`, `examples/lint-ratchet-demo/`, `docs/guides/lint-ratchet-adoption.md`, and `scripts/ai-hooks/README.md` all exist as a visitor path.

Failure: Conference visitors arriving for harness engineering are steered through application setup before they can find the copyable reference surfaces.

## Do

Add a concise “Here for the harness reference?” front-door box with the five verified links, and relabel the product setup as “Running the VTT.” Keep one README rather than creating the rejected generated `HARNESS.md` fork.

## Verify

```
bun run docs:harness-controls:check && bun run backlog:lint -- --file docs/agent_notes/backlog/harness-audit-2026-07/60-readme-front-door-buries-the-harness.md
```

## Acceptance

- The first README screen offers distinct harness and product paths.
- Every harness-path link resolves to an existing maintained surface.
