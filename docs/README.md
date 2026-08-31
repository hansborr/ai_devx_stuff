# Musi docs

Orientation for this folder. Start here, then follow the pointer that matches
what you need.

- **Humans:** the repo [`README.md`](../README.md) is the quickstart (setup,
  commands, project structure).
- **Agents:** [`AGENTS.md`](../AGENTS.md) holds the always-loaded repo rules,
  working model, and task-guide triggers.

## Harness map

[`harness.controls.json`](../harness.controls.json) and its generated
projection
[`docs/generated/harness-controls.md`](generated/harness-controls.md) are the
authoritative, single-source inventory of harness controls: every registered
control, grouped by kind. Ask them whether a control exists.

[`ai-harness.md`](ai-harness.md) is the conceptual map over that inventory: the
harness architecture, the guide and sensor lifecycle, the adoption boundary,
the gap map, and the complete table of task guides, which it alone owns. The
sections below are just entry points into it. Do not re-enumerate the guides
here — that table lives in `ai-harness.md`.

For a bounded open-run-observe introduction before using these documents, take
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
