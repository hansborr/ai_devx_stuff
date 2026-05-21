---
leaf: lint-hardening/19 (probe deferral)
status: deferred
recorded: 2026-05-19
parent_branch: feature/lint-hardening-review-followup
---

# Leaf 19 probe deferral: top-level script files outside tsconfig.scripts.json

## Summary

Probed three top-level `scripts/*.ts` files under the 300-line
`local/max-lines` ceiling that have not yet been adopted into the
lint gate:

- `scripts/db-status.ts` (102 lines)
- `scripts/harness-emit-envelope.ts` (172 lines)
- `scripts/sensor-blob-size.test.ts` (195 lines)

All three failed the probe immediately with:

```
Parsing error: "parserOptions.project" has been provided for
@typescript-eslint/parser. The file was not found in any of the
provided project(s): scripts/<file>.ts
```

A grep across all root tsconfigs (`tsconfig.json`,
`tsconfig.scripts.json`, `tsconfig.base.json`,
`packages/server/tsconfig.scripts.json`) confirmed: none of these
three files appear in any tsconfig's `include` list. They exist as
standalone Bun scripts that run directly via `bun scripts/<file>.ts`
without participating in any TypeScript project.

`scripts/harness-emit-envelope.ts` is referenced extensively in the
`test:scripts` smoke subjects map, so the absence is not benign
deletion — these files are live, just outside the project graph.

## Why deferred

Bringing these files under lint coverage requires first adding them
to `tsconfig.scripts.json` (and potentially fixing any latent type
errors that surfaces). That is a project-shape decision the
autonomous slice should not make on its own: the choice to bring a
file into a TypeScript project changes how it interacts with
`bun run typecheck`, `tsc -b`, downstream consumers, and the lint
ratchet — much wider blast radius than a config-only ESLint
adoption.

Mirrors the slice 2 deferral and the slice 5 carve-outs: when the
gating change is not a single-line ESLint config addition, leave it
for a leaf with explicit budget to make the wider call.

The unused work branch (`feature/lint-hardening-leaf-19-top-level-small-scripts`)
was deleted; no commits landed.

## Revisit

- When a planned change to `tsconfig.scripts.json` lands (e.g., a
  drift-AI sweep or a future Leaf 19 slice with explicit budget),
  fold these three files into the include list and adopt them in
  the same slice.
- Or, if a separate non-type-aware lint flavor for ad-hoc scripts
  is desired, that itself is a design decision and another leaf.

## Other candidates parked at this stage

For the record, the other top-level `scripts/*.ts` files not yet
adopted are mostly over the 300-line ceiling and need their own
budget decisions:

| file | lines | status |
| --- | --- | --- |
| `code-intel.ts` | 136 | carved from slice 4 (typeof-import rewrite) |
| `drift-ai.ts` | 1202 | over ceiling |
| `drift-ai.test.ts` | 1642 | over ceiling |
| `code-intel.test.ts` | 2183 | over ceiling |
| `harness-check.ts` | 529 | over ceiling |
| `lint-agent.ts` | 332 | over ceiling |
| `lint-ratchet.ts` | 846 | over ceiling |
| `lint-ratchet-baseline.ts` | 880 | over ceiling |
| `lint-ratchet-baseline.test.ts` | 657 | over ceiling |
| `logs-audit.ts` | 769 | over ceiling |
| `generate-harness-controls.ts` | 384 | deferred slice 2 |
| `sensor-blob-size.ts` | 325 | over ceiling, also outside tsconfig |

## Cross-refs

- Backlog leaf: `backlog/lint-followups/19-scripts-eslint-remaining-families.md`
- Verdict register: `backlog/lint-hardening/evaluation-verdicts.md`
- Sibling deferrals/adoptions:
  - `lint-hardening-leaf-19-scripts-generate-harness-controls-deferral.md`
  - `lint-hardening-leaf-19-scripts-drift-ai-small-modules-adoption.md`
