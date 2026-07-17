# 07 — Author the coverage map as data, render the Markdown

Status: Proposed — trigger: next time the checker needs a schema change
Priority: P1 · Size: M · Risk: low
Source: lint architecture review 2026-07-16 (R7) — GPT and Grok, both P1.

## Problem

The coverage checker parses a generated Markdown table to reconstruct glob
membership and cross-check ESLint reach — Markdown as a load-bearing
database. The human-authored facts and the derived presentation are tangled,
so the map stays hand-edited (a known friction: coverage-map edits are the
one remaining hand-maintained piece of the config-surface registration
flow).

## Do

Invert it: author only the human facts (path/glob, classification,
rationale) in JSON/YAML; derive the rest from the live ESLint config and the
ratchet registry; generate the Markdown table as presentation.

Not urgent on its own — schedule it as the shape of the *next* coverage-map
checker schema change rather than a standalone drive-by.
