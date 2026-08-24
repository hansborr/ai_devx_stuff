# Lane 09 — lint machinery: rules, ratchet, path policy, codemods

Status: Dispatch material — not a schedulable note

**Scope.** `eslint-rules/`, `eslint-config/`, `tools/lint-ratchet/`,
`scripts/lint-ratchet/` (the Musi adapter — the two lint-ratchet homes are
one subject: read them together, not as separate slices),
`scripts/path-policy/`, `scripts/codemods/` implementations (fixtures may be
sampled), `tools/stryker-lint-ratchet.mjs`, `examples/lint-ratchet-demo/`.

**Emphasis.** Rule implementations a contributor could not extend safely
(option plumbing, shared helpers, test scaffolding for new rules); codemod
implementations that are one-shot scripts pretending to be reusable tools;
dead or superseded modules that were never deleted; the
package-vs-`scripts/` seam between the ratchet tool and its Musi adapter;
config surfaces that grew by accretion. The repo is meant as a *public
harness-engineering reference*: judge on copyability (see ORCHESTRATION.md's
audit lenses) as well as internal quality.

**Known context.** The dedup corpus carries records for prior-pack leaves 36
(lint-ratchet vocabulary) and 49, and for the landed 38/60/64/68/70 family —
read those records and dedup hard against them.
