# Leaf 27: Broad Plugin Evaluations (Unicorn / SonarJS / Promise)

Status: Parked — explicitly deferred
Depends on: higher-signal leaves 1-21 landing first, unless a specific
postmortem or code review names a concrete rule candidate.

## Problem

`eslint-plugin-unicorn`, `eslint-plugin-sonarjs`, and `eslint-plugin-promise`
are popular broad-coverage plugins. Each has 30-100+ rules, many overlapping
with the existing typescript-eslint `strict-type-checked` config and Musi's
local rules.

Adopting any of them wholesale would generate noisy churn on day one without
clear correctness wins beyond what Musi already enforces.

## Decision

Do not adopt these plugins by default. Cherry-pick from them only when:

1. A specific footgun is observed in a postmortem, code review, or AI-output
   audit, AND
2. No existing typescript-eslint or core rule already covers it, AND
3. The targeted rule has a clean diagnostic and a sanctioned fix path.

The evaluation pattern:

1. When a candidate rule is identified, run it as a one-off inventory in a
   throwaway config.
2. Triage findings. If signal-to-noise is high and the cleanup is
   tractable, add a leaf for it.
3. If signal is low, write down the verdict here so the rule is not
   re-evaluated next quarter. Also add the verdict to
   `evaluation-verdicts.md`; that register is the centralized review surface.

## Already-Skipped Cherry-Picks

| Plugin | Rule | Verdict | Source |
|---|---|---|---|
| `eslint-plugin-unicorn` | `no-array-for-each` | Pure style. Skip. | (assumed; revisit if needed) |
| `eslint-plugin-sonarjs` | `cognitive-complexity` | Overlaps with built-in `complexity: 10`. Skip. | (assumed; revisit if needed) |
| `eslint-plugin-promise` | `catch-or-return` | Overlaps with `@typescript-eslint/no-floating-promises`. Skip. | (assumed; revisit if needed) |

This table is historical triage context. For new inventory-backed rejects or
subset adoptions, update `evaluation-verdicts.md` first and keep only a short
pointer here if useful.

## See Also

- Leaves 22-24: lessons learned from the `eslint-plugin-llm-core` evaluation,
  which followed exactly this cherry-pick-only pattern and rejected six
  upstream rules after a verification audit.

## Verification

- N/A unless a specific rule is being trialed; in that case the trialing
  leaf has its own verification block.
- Any trial must append a row to `evaluation-verdicts.md` for reject, defer,
  subset adoption, or full adoption with caveats.
