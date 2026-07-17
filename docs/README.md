# Musi docs

Orientation for this folder. Start here, then follow the pointer that matches
what you need.

- **Humans:** the repo [`README.md`](../README.md) is the quickstart (setup,
  commands, project structure).
- **Agents:** [`AGENTS.md`](../AGENTS.md) holds the always-loaded repo rules,
  working model, and task-guide triggers.

## Harness map

[`ai-harness.md`](ai-harness.md) is the authoritative, single-source inventory
of the agent harness — every guide, lint rule, sensor, and gate, with what each
one prevents. It is the map; the sections below are just entry points into it.
Do not re-enumerate the guides here — that table lives in `ai-harness.md`.

For a bounded open-run-observe introduction before using the inventory, take
the [`15-minute harness tour`](harness-tour.md).

## By topic

- **Architecture:** [`architecture-plan.md`](architecture-plan.md),
  [`authorization.md`](authorization.md),
  [`socket-architecture.md`](socket-architecture.md),
  [`CONCURRENCY.md`](CONCURRENCY.md).
- **VTT UI tokens:** repo-root [`DESIGN.md`](../DESIGN.md) is product design
  guidance for the client, not part of the copyable harness policy.
- **Task recipes:** [`guides/`](guides/) — the how-to guides for tRPC, Prisma,
  sockets, race-sensitive mutations, e2e, rules logic, and the lint ratchet.
  The `ai-harness.md` Guides table indexes them all.
- **Module-doc convention:** [`module-docs.md`](module-docs.md) and the
  repo-root [`MODULE-INDEX.md`](../MODULE-INDEX.md).
- **Legal / provenance:** [`srd-data-sources.md`](srd-data-sources.md),
  [`public-release-notes.md`](public-release-notes.md),
  [`dependency-license-audit.md`](dependency-license-audit.md).
- **Agent process notes:** [`agent_notes/`](agent_notes/) — recent-history
  logs, active backlog packs, and decision handoff material.
- **Harness-managed:** [`generated/`](generated/) — generated and hand-maintained
  reference docs. Its [`README.md`](generated/README.md) records per-file
  ownership, edit rules, and drift checks.
