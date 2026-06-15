# GC-1 - Guardrail-config change tripwire (solo-repo CODEOWNERS)

> **STATUS: DESIGN-GATED — DO NOT IMPLEMENT YET.**
> Part of the underlying risk is already mitigated by existing ratchets, so
> this may be unnecessary. Resolve the open questions before promoting.

## Problem

The harness research (`06`, `14`, overview rec 6) recommends locking the
guardrail configs under `CODEOWNERS`: a blocked agent that gets more capable
tries harder to loosen its own leash — `eslint-disable`, `@ts-ignore`, `any`,
or editing the config that blocks it. A human review on the guardrail files
themselves shuts that down.

Musi has **no `CODEOWNERS`** and no tripwire on changes to its guardrail
surface (`tsconfig.base.json`, `eslint.config.js`, `eslint-config/`,
`eslint-rules/`, `bunfig.toml`, `knip.config.ts`, `AGENTS.md`/`CLAUDE.md`,
`.husky/`, `scripts/verify*`).

## Why this is design-gated (and possibly unnecessary)

1. **Solo repo defeats classic CODEOWNERS.** `CODEOWNERS` + required reviews
   does nothing useful with a single author/merger — there is no second owner to
   request. So the textbook mechanism does not transfer; only a *notice*-style
   tripwire would.
2. **The "loosen the leash via suppressions" risk is already largely covered.**
   The repo runs `lint:ratchet` and `lint:ratchet:zero-baseline`, plus custom
   rules (`no-explicit-any`, `type-assertion-boundary`, `no-llm-artifacts`).
   New `eslint-disable`/`any`/assertions are already caught. The *residual* gap
   is edits to the config/rule files themselves that quietly weaken a rule.
3. **Signal vs noise.** A tripwire that fires on every legitimate guardrail edit
   (and this repo edits its harness often) becomes noise. It must distinguish
   "weakening" from "strengthening/maintaining" to be worth anything — which is
   hard to do mechanically.

## Open questions to answer before implementing

- Given the ratchets already catch suppression creep, is there enough residual
  risk to justify any tripwire?
- If yes, what is the surface? A pre-commit/CI *notice* (non-blocking) that
  lists touched guardrail files? A `CODEOWNERS` file kept only as documentation
  of intent even without required reviews?
- Can it tell weakening from routine maintenance without firing constantly?
- Does branch protection (if/when enabled) plus the comprehension template
  (HC-1) already cover the intent more cheaply?

## Sketch (only if judged worth it)

- Add `.github/CODEOWNERS` mapping the guardrail paths — as intent
  documentation and ready for the day a second contributor or required-review
  rule exists.
- Optionally, a non-blocking CI note that flags when a PR touches guardrail
  paths, so the change gets a deliberate second look in the (self-)review.

Do not implement until the "is this needed at all" question is answered.
