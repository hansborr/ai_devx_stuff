# 10 — Trim unused product surface: drop `report-only` mode

Status: Done — 2026-07-16 removed report-only mode from types, filtering, baseline validation, default-mode summaries, the shared harness-diagnostics finding kind, and the ratchet/adoption guides; demo mirror + shared rebuilt (item 3 belongs to leaf 02).
Priority: P2 · Size: S · Risk: low
Source: lint architecture review 2026-07-16 (R10).

## Problem

`LintRatchetMode = "no-new" | "report-only"`
(`scripts/lint-ratchet/lint-ratchet-config.ts:26`), but the live registry
has no `report-only` entries — yet the mode threads through core types,
runtime filtering, baseline validation, and default-mode summaries.
`--propose` already covers the discovery use case. The repo applied exactly
this discipline to the never-implemented `ratchet-down` mode; extend it to
features that exist but aren't earning their surface.

## Do

1. Confirm the registry still has zero `report-only` entries and no
   downstream consumer (adoption guide, demo) depends on the mode.
2. Remove the mode from types, filtering, validation, and summaries.
3. When leaf 02 lands, feature-gate trend/complexity/edit-check out of the
   kernel layer the same way (that half belongs to 02; this leaf is just the
   cheap independent slice).
