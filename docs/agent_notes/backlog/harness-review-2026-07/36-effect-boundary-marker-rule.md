# 36. Require a parseable `// effect-boundary: <category> - <reason>` marker on every client `useEffect`

Status: Deferred (owner decision) — positioning recorded 2026-07-02; implementation held for repo-owner judgment.
Lens: lint-rules · Area: client · Severity: med-high · Size: M · Confidence: med
Theme: effect-justification-markers · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
`docs/guides/client-effects.md` states the policy — "Effects are only for synchronizing with
external systems" — but only one anti-pattern class (synchronous setState) is machine-enforced.
An agent adding a derive-state or fetch-in-effect that never calls setState synchronously sails
through. The repo already proved the fix pattern with `type-assertion-boundary`: convert prose
policy into a parseable, categorized, ratchetable in-code justification. Requiring
`// effect-boundary: <category> - <reason>` (categories: `socket`, `dom`, `browser-api`,
`canvas`, `subscription`) on each `useEffect` makes the guide's decision rule a lint-time
question the author must answer — the most agent-relevant gap in the pack, and its most
exportable idea.

## Decision

Deferred for repo-owner judgment on 2026-07-02. If adopted later, the marker
rule should complement Recommendation 1 in
`docs/agent_notes/backlog/useeffect-guardrails-implementation-plan.md`: the
shipped `ratchet/react-hooks-set-state-in-effect-client` floor catches one
concrete bad-effect shape, while markers would force classification of new
effects that do not synchronously call `setState`. The marker rule would
substitute for Recommendation 2's uncalibrated third-party plugin trial rather
than run beside it by default.

Any rollout must be ratchet-based so the existing effect inventory is accepted
as baseline debt and new/edited effects justify themselves without creating an
annotate-every-effect-at-once cleanup wave. Implementation is held because the
core value premise, "every effect should carry an explicit marker", is the
judgment the useEffect research docs reserve for the owner; Recommendation 2 is
already a deferred-for-owner item in that same plan lane.

## Evidence
- 51 `useEffect(` in non-test `packages/client/src` (verified 2026-07-01; matches the audit's
  ~51).
- Marker mechanism to copy: `eslint-rules/type-assertion-boundary.js` (same-line or
  comment-block-above marker, category allowlist, `missing`/bad-category/missing-reason
  messageIds ~lines 208-215); enforcement convention documented in AGENTS.md Code Standards
  and `docs/guides/local-eslint-rules.md`.
- DESIGN GATE — the backlog already holds a different mechanism for the same risk, and part of
  it is ALREADY SHIPPED (the plan doc's own "Status: proposed, no implementation yet" header
  is stale):
  - `docs/agent_notes/backlog/useeffect-guardrails-implementation-plan.md` Rec 1 is live:
    `ratchet/react-hooks-set-state-in-effect-client`
    (`scripts/lint-ratchet/lint-ratchet-config.ts:221-233`, baseline 23 findings / 22 files
    as of 2026-07-02 in `lint-ratchet.baseline.json`; rule kept `off` in normal lint at
    `eslint-config/client-configs.js:132-138`). Rec 3 is live too: `docs/guides/client-effects.md`
    exists and AGENTS.md points at it. Rec 2 (trial
    `eslint-plugin-react-you-might-not-need-an-effect`) is NOT implemented (no dep in
    `package.json`).
  - `docs/agent_notes/backlog/useeffect-ai-agents-research.md` records verdicts this leaf must
    not contradict: no hard `useEffect` ban (VTT domain is effect-legitimate; a ban converts
    ~45 files into eslint-disable noise), and the AI-overuse premise is anecdote-tier.

## Proposed direction
Local rule `local/effect-boundary-marker`: every `useEffect` call in `packages/client/src`
(non-test) must carry the marker, same placement grammar as `type-assertion-boundary`
(same line or the comment block directly above). Category outside the five, or missing reason,
fails. Rollout per house convention: ~51 existing sites are debt → new lint-ratchet entry
(`docs/guides/lint-ratchet.md`, "Adding a new rule to an already linted area") baselining the
unmarked inventory; new/edited effects must justify themselves; drain opportunistically.
BEFORE implementing, write the positioning decision into the plan doc: this rule complements
Rec 1 (set-state ratchet catches one bad-effect shape; markers force classification of every
new effect, including the shapes Rec 1 can't see) and partially substitutes for Rec 2 (an
uncalibrated third-party plugin vs. a house mechanism that is already proven) — decide
complement-vs-replace for Rec 2 explicitly, and record it as a verdict per that plan's own
convention.

## Scope / caveats
- Do not proceed until the design gate is resolved against the two useeffect docs — this leaf
  is a mechanism proposal, not a settled decision; the plan's non-goal "no eslint-disable
  noise" cuts against any rollout that forces annotating all 51 sites at once (the ratchet
  path avoids exactly that).
- Category list needs one pass against the real 51 sites before freezing — e.g. focus
  management and scroll restoration are `dom`, timers may need `subscription` or a sixth
  category; markers that don't fit breed junk reasons.
- Marker quality is not machine-checkable beyond "non-empty reason" — same accepted limitation
  as `type-assertion-boundary`.
- One small commit once gated: rule + tests + local-plugin registration + ratchet entry +
  harness-controls manifest row + coverage-map row (the plan doc steps 2-5 list the exact
  registration surfaces).
