# Parse Every Same-Pack Backlog Task Table

Status: Accepted after adversarial review — not promoted
Date: 2026-07-21
Priority: P2

## Problem

`parseIndexTaskTable` returns the first table with a Status column. Later task
tables are invisible. The live ready queue therefore misses eight same-pack
Ready-vs-Done rows in tables B/C.

## Scope

- Parse every task-shaped table with a Status column. A table is task-shaped
  only when at least one data row links a same-directory Markdown leaf, and
  only linked rows participate; unrelated status tables remain ignored.
- Prefer the authoritative link in a named Task column rather than the first
  Markdown link anywhere in the row; supplementary links must not become task
  identity accidentally.
- Report drift with one stable source line per finding.
- Land the parser coverage and reconcile the eight same-pack rows in this leaf.
  A redesigned leaf 18 may follow as a second backlog-governance commit.

## Acceptance

- Multi-table fixtures report drift in tables two and three, while an unrelated
  status table is ignored.
- File mode reports only relevant row/leaf drift.
- Full `backlog:lint` sees the eight same-pack live rows clean after
  reconciliation. Cross-pack identity is owned separately by leaf 18.
