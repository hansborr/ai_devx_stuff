# Redesign Cross-Pack Backlog Task Identity

Status: Approved 2026-07-21 — owner signed off the replacement
authoritative-link design; implement after leaf 12
Date: 2026-07-21
Priority: P2 if redesigned

## Problem

The ready queue contains six completed cross-pack tasks still marked Ready, but
its Source cells are prose rather than resolvable task references. Guessing from
directory/number is unsafe: B3 intentionally tracks residue after its aggregate
source leaf became terminal.

The original `identity=shared|residue` proposal is rejected. `residue` is an
exemption rather than identity, the migration undercounted cross-pack rows, and
the proposed no-reverse-discovery limitation preserves the source-edit path
that created the drift.

## Replacement design

- Give each queue row one authoritative task link. Links used only as provenance
  remain ordinary citations and do not participate in lifecycle comparison.
- A linked task owns completion state by default; the queue is a checked view of
  that state rather than an independent status authority.
- When a queue row is narrower than a completed aggregate source, create a
  distinct active leaf for the residue. Do not add an indefinite metadata escape
  hatch to suppress status comparison.
- In source-leaf file mode, scan canonical backlog indexes for incoming
  authoritative references and report drift for the edited leaf. This bounded
  reverse discovery is the main edit-loop protection.
- Reject absolute paths, root escapes, dangling references, and ambiguous
  authoritative links. Keep findings anchored at the queue row with the related
  source location in the message.

## Acceptance

- Implement after leaf 12 as the second backlog-governance commit, reusing its
  table/Task-column parser rather than changing the API twice independently.
- Migrate every cross-pack ready-queue row to the authoritative-link contract,
  not only the six currently stale rows.
- Reconcile the six confirmed rows plus stale source-pack tracking surfaces.
- A B3-style residue receives its own leaf and no longer depends on a terminal
  aggregate task for lifecycle.
- Queue-index mode and source-leaf mode both catch shared-lifecycle drift; full
  lint remains clean after reconciliation.
