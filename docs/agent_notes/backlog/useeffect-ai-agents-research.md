# useEffect and AI coding agents — research

Status: research · no implementation yet
Date: 2026-06-05 · deep-research run (20 sources fetched, 96 claims extracted,
25 adversarially verified with 3 independent votes each: 23 confirmed,
2 killed) plus direct reads of the two AI-agent-specific sources and a local
codebase audit
Branch: `chore/react-lints`
Plan: `docs/agent_notes/backlog/useeffect-guardrails-implementation-plan.md`

The question: practitioners report that AI coding agents overuse `useEffect`,
that the pattern self-amplifies ("the more the model sees them, the more they
leak in"), and that effect-*ordering* bugs are the ones agents cannot debug.
Should Musi restrict or ban `useEffect` via lint rules?

Everything below is tiered by evidence strength:

- **[verified]** — survived 3-vote adversarial verification against primary
  sources (react.dev, ESLint docs, GitHub/npm metadata).
- **[anecdote]** — practitioner blog material; fetched and read directly, but
  no primary/empirical evidence behind it.
- **[local]** — measured in this repository on 2026-06-05.

## TL;DR

- **Do not ban `useEffect`.** The React core team's own position is targeted
  linting of concrete anti-patterns, never import prohibition; Musi's heaviest
  usage is legitimate external-system sync (sockets, DOM, browser APIs); and
  two prior local inventories of the main anti-pattern rule found **zero
  actual bugs** across 24 findings.
- Musi already runs the strongest official guardrail:
  `eslint-plugin-react-hooks@^7` `recommended-latest` (compiler-era rules) at
  error for all client TS/TSX. The one disabled rule,
  `react-hooks/set-state-in-effect`, was deferred twice with documented
  verdicts — but `off` means nothing stops *new* findings, which is exactly
  the AI leak-in failure mode.
- The AI-agent-specific premise is **not substantiated by primary evidence**.
  It survives only as practitioner anecdote, though the anecdotes agree on
  mechanism: tutorial-shaped training data biases agents toward
  fetch/derive-in-effect, and agents cannot simulate render/effect timelines
  from a static code snapshot.
- A dedicated third-party plugin
  (`eslint-plugin-react-you-might-not-need-an-effect`) covers the
  architectural anti-pattern classes the official rule structurally cannot,
  but v1.0.0 shipped 2026-05-31 — five days before this note — so its
  false-positive behavior at scale is uncharacterized. Ratchet tier, not
  error tier.

## 1. [verified] React core team position

- Effects are an escape hatch for synchronizing with **external systems**
  (network, non-React widgets, browser DOM). "If you're not connecting to any
  external system, you probably don't need an Effect."
- The canonical non-uses, per `react.dev/learn/you-might-not-need-an-effect`:
  transforming data for rendering, deriving state, and handling user events.
  For derived state, compute during render ("you avoid bugs caused by
  different state variables getting out of sync"). Data fetching is a softer
  case in the React docs: fetching from Effects is documented and still
  permitted when better mechanisms do not fit, but the docs also call out race
  conditions, waterfalls, lack of preload/cache behavior, and recommend
  framework mechanisms; the `useEffect` reference page additionally names
  client-side caches such as TanStack Query as alternatives.
- Enforcement vehicle: `eslint-plugin-react-hooks` v6/v7 expanded from two
  rules to a React Compiler-derived set (`set-state-in-effect`,
  `set-state-in-render`, `purity`, `refs`, `immutability`,
  `static-components`, …). v7 ships two presets (`recommended`,
  `recommended-latest`) with compiler rules on by default in the presets that
  carry them; the linter does **not** require adopting the compiler.
- `react-hooks/set-state-in-effect` targets synchronous `setState` in
  effects. Its documented Common Violations are precisely the AI-attributed
  patterns: setting loading state synchronously, deriving state from props in
  effects, transforming data in effects. Stated rationale: avoidable extra
  render pass. v7.1.0 improved the rule ("fewer false negatives") — it is
  actively maintained.
- The React team's preferred approach is demonstrably **targeted linting, not
  prohibiting `useEffect`** — the rule set names misuse shapes; no official
  rule or guidance bans the hook.

## 2. [verified] Lint ecosystem for restricting effects

- **`eslint-plugin-react-you-might-not-need-an-effect`** (NickvanDyke):
  v1.0.0 published 2026-05-31; repo created 2025-04-25 (~13 months old);
  ~1.8k stars, ~383 dependent repos; ESLint plugin with Oxlint support.
  Exactly 9 rules, each mapping one-to-one onto a react.dev alternative:
  - `no-derived-state` → compute during render
  - `no-chain-state-updates` → effect cascades; single event handler or
    reducer instead
  - `no-event-handler` → put event logic in the handler
  - `no-adjust-state-on-prop-change` / `no-reset-all-state-on-prop-change` →
    `key` remount or compute-from-prop
  - `no-pass-live-state-to-parent` / `no-pass-data-to-parent` → lift state /
    fetch in the parent (the docs reference TanStack Query's `useQuery`)
  - `no-external-store-subscription` → `useSyncExternalStore`
  - `no-initialize-state` → `useState` initializer
  Ships `recommended` (all warn) and `strict` (all error) presets plus
  per-rule severity — built for staged rollout. Its lint messages name the
  correct replacement pattern, which is the property that matters for
  steering an agent at violation time.
- **Hard ban mechanics exist**: core `no-restricted-imports` with
  `importNames: ["useEffect"]` against `react` catches plain and aliased
  imports with zero dependencies. Assessment: blunt and escape-hatch-hostile;
  it cannot distinguish a socket subscription from a derived-state
  anti-pattern, so legitimate uses become `eslint-disable` noise — itself a
  pattern that leaks into agent output.
- **`useSyncExternalStore`** is the React-recommended replacement for
  effect-based subscriptions to external mutable sources ("third-party state
  management libraries", "browser APIs that expose a mutable value and events
  to subscribe to its changes"). Caveat: for purely internal state, plain
  `useState`/`useReducer` remains preferred.

## 3. [anecdote] The AI-agent-specific claims

No primary or empirical source substantiates that LLM agents overuse
`useEffect` at higher rates than humans or fail disproportionately on
effect-ordering bugs. The deep-research verification pass confirmed 23 claims
about *what effect misuse is*; zero about *agents specifically*. The two
substantive practitioner sources, read directly:

### rachel.fyi — "Why Banning useEffect Is Really About Agents"

On Factory's actual `useEffect` ban. Core mechanism claim: **agents cannot
simulate timelines**. An agent receives a static snapshot of code but must
reconstruct execution order — which effect fires after which render, which
state mutation re-triggers what. Chained effects (state X triggers effect B,
which sets state Y, which re-renders into effect C) multiply possible
execution paths; "the agent is doing the same thing a developer does: jumping
between hooks, attempting to trace state mutations" — without a debugger, a
render timeline, or persistent mental state across sessions. Inline derived
state reads top-to-bottom and needs no temporal simulation. Recommends:
inline derivation, event handlers, data-fetching libraries, one
`useMountEffect` wrapper for genuine mount work, and **enforcing constraints
via lint rules, not conventions** — "easy to reason about" becomes a
measurable requirement when agents contribute.

### theroadtoenterprise.com — "Vibe coding vs production coding in React"

Claims fetch-in-effect is the #1 AI output pattern ("ask Cursor to 'fetch the
user list and render it' and you will get this nine times out of ten").
Documented downstream bugs: no abort on unmount (leaked request +
setState-after-unmount), `res.json()` on an HTML 500 page (unhandled
rejection), no dedup across sibling components, StrictMode double-fetch in
dev. Attributed cause: **training-data composition** — "the training corpus
is overwhelmingly tutorial-shaped. Tutorials optimise for fitting a working
example into a single file with the fewest concepts in scope, which means
abort signals, rollback handlers, and exhaustive dependency arrays get cut
for clarity." Punchline: "This is not a flaw you fix with a better model. It
is a flaw you fix with a pre-merge gate."

### Synthesis of the anecdote tier

Two distinct mechanisms, both plausible, neither measured:

1. **Production bias** — the agent's prior *is* the anti-pattern
   (tutorial-shaped corpus), amplified in-context once the pattern exists in
   the codebase (the "leak in" dynamic).
2. **Debugging bias** — effects are the construct where source maximally
   under-determines behavior (ordering across renders, StrictMode
   double-invoke, cleanup timing, batching). Agents rebuild their mental
   model from source every session; effect-ordering bugs are invisible in any
   single file.

## 4. [local] Musi today

- **51 `useEffect` call sites across 45 files** in `packages/client/src` —
  modest. Heaviest file is `chat-panel.tsx` with 3, all legitimate
  external-system sync: socket event subscription with cleanup,
  refetch-on-reconnect, scroll position.
- `eslint-plugin-react-hooks@^7` **`recommended-latest` already at error**
  for client TS/TSX (`eslint-config/client-configs.js`), i.e. the compiler-era
  rule set. Cleaned findings at adoption: 5 `refs`, 1 `static-components`.
- The one override-off rule is `react-hooks/set-state-in-effect`
  (`eslint-config/client-configs.js`), inventoried twice:
  - Leaf 14 (2026-05-16): 23 findings, deferred.
  - Leaf 15 (2026-05-19): 24 findings = 11 dialog-reset /
    6 props-to-local-state / 5 external-system-sync / 0 derived-state /
    0 cleanup-reset / 2 other. **Zero actual bugs.** Defer verdict for
    *error promotion* recorded in
    `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`; leaf at
    `docs/agent_notes/backlog/lint-followups/15-react-deferred-rules.md`.
- Fetch-in-effect and derived-state-in-effect — the two most bug-dense AI
  pattern classes — have **no local foothold**: TanStack Query + tRPC owns
  fetching (all 8 `@tanstack/query` lint rules are strictly gated; one is
  `warn` under the repo's zero-warning lint gate), and both inventories found
  0 derived-state findings.
- Constructing a second Socket.io client is already banned via
  `no-restricted-imports`, centralizing the socket lifecycle in
  `SocketProvider`.
- Remaining exposure is therefore **accretion, not existing debt**: nothing
  currently stops set-state-in-effect finding #25, or the first effect
  cascade.

## 5. What the research did not substantiate

- The core AI premise (see §3) — open question whether any empirical
  measurement exists.
- Real-world false-positive rates for
  `eslint-plugin-react-you-might-not-need-an-effect` at error level in a
  large codebase, and any published team experience using it as an AI-agent
  guardrail.
- Biome/Oxlint native-rule parity for unnecessary-effect detection (the
  Oxlint JS-plugin path exists; native parity unverified).
- Two claims were killed in verification (recorded for honesty): "the
  official changelog contains no unnecessary-effect rule" (refuted 1-2 — the
  preset story is more nuanced), and a specific josephsavona attribution for
  the set-state-in-effect rationale (refuted 1-2 — rationale is documented,
  attribution was not).

## Sources

Primary (verified tier):

- <https://react.dev/learn/you-might-not-need-an-effect>
- <https://react.dev/reference/react/useEffect>
- <https://react.dev/learn/synchronizing-with-effects>
- <https://react.dev/reference/eslint-plugin-react-hooks>
- <https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect>
- <https://react.dev/reference/react/useSyncExternalStore>
- <https://react.dev/blog/2025/10/07/react-compiler-1>
- <https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/CHANGELOG.md>
- <https://github.com/NickvanDyke/eslint-plugin-react-you-might-not-need-an-effect>
- <https://eslint.org/docs/latest/rules/no-restricted-imports>

Anecdote tier (read directly):

- <https://rachel.fyi/posts/why-banning-useeffect-is-really-about-agents>
- <https://theroadtoenterprise.com/blog/vibe-coding-vs-production-coding-react>

Fetched by the governance angle but with no claims surviving the verification
budget (kept for follow-up reading): Notion's ESLint ratcheting write-up,
ESLint bulk-suppressions announcement, `eslint-formatter-ratchet`,
eslint/eslint#16512 (warnings discussion).
