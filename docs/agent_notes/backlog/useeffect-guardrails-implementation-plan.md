# useEffect guardrails — implementation plan

Status: proposed, no implementation yet
Date: 2026-06-05 (mechanics reconciled to the current repo layout 2026-06-12)
Research: `docs/agent_notes/backlog/useeffect-ai-agents-research.md`
Related: `docs/agent_notes/backlog/lint-followups-2026-06/evaluation-verdicts.md`
(active verdict register), `docs/guides/lint-ratchet.md`. The standing
`set-state-in-effect` defer verdicts (Leaf 14, 2026-05-16; Leaf 15,
2026-05-19) and the Leaf 15 follow-up doc lived in the now-removed
`lint-hardening/` and `lint-followups/` backlog folders, consolidated out in
`31b43881 docs(lint): consolidate lint review backlog`; read them from git
history.

## Goal

Contain the AI-agent `useEffect` leak-in dynamic — new unnecessary effects
accreting because the model reproduces patterns it sees — without banning the
hook, without rewriting the 24 intentionally-accepted `set-state-in-effect`
sites, and without contradicting the standing Leaf 15 defer verdict.

The shape is three ratchet-sized moves: freeze the known anti-pattern rule at
its current floor, trial the dedicated unnecessary-effect plugin at ratchet
tier, and encode the effect decision rule where agents read it.

## Non-goals

- **No hard ban.** `no-restricted-imports` on `useEffect` is rejected: Musi's
  VTT domain is unusually effect-legitimate (sockets, canvas, presence,
  browser APIs), two inventories judged the existing 24 findings intentional
  with zero bugs, and a ban would convert ~45 files into `eslint-disable`
  noise — itself a pattern that leaks into agent output. Record this as a
  verdict so it is not re-tried without new evidence.
- **No error promotion of `react-hooks/set-state-in-effect`.** The Leaf 15
  defer verdict for error-tier enforcement stands; this plan adds a different
  enforcement tier (no-new floor), it does not overturn that verdict.
- **No cleanup/rewrite slice.** The 24 accepted sites stay as they are until
  a dialog/state-pattern refactor touches them anyway (the revisit condition
  already named in Leaf 15).
- **No new client architecture.** TanStack Query owns fetching;
  `SocketProvider` owns the socket lifecycle. Nothing here changes runtime
  code.

## Recommendation 1 — ratchet `react-hooks/set-state-in-effect` (no-new)

Convert the rule from `off` to a `no-new` ratchet so the 24-finding floor is
frozen and finding #25 fails locally at commit time.

Mechanics, per `docs/guides/lint-ratchet.md` ("Adding a new rule to an
already linted area"):

1. Add `eslint-plugin-react-hooks` → `react-hooks` to
   `lintRatchetThirdPartyPluginAllowlist` in
   `scripts/lint-ratchet/lint-ratchet-config.ts`. Verify the plugin's export
   shape (`pluginExport: "default"` expected) against the installed `7.1.1`.
2. Add the registry entry. Import and reuse the existing client source and
   test/helper glob constants (`clientSourceFiles`,
   `clientTestAndHelperSourceFiles`) from `eslint-config/shared-policy.js` so
   the ratchet matches the Leaf 15 inventory scope. Scripts type-resolve
   `shared-policy.js` through `scripts/eslint-config-shared-policy.d.ts`, which
   today declares only a subset of the module's exports (`maxLinesPolicy`,
   `scriptFixtureIgnores`, `scriptTestAssertFunctionNames`, …); add
   `clientSourceFiles` and `clientTestAndHelperSourceFiles` to that shim
   before importing them, or the typecheck fails with "no exported member".
   Sketch (verify fields against the registry types and the constant names
   against `shared-policy.js` before landing):

   ```ts
   {
     id: "ratchet/react-hooks-set-state-in-effect-client",
     ruleId: "react-hooks/set-state-in-effect",
     source: { kind: "third-party", pluginModule: "eslint-plugin-react-hooks" },
     parserProfile: "minimal-ts",
     files: clientSourceFiles,
     ignores: clientTestAndHelperSourceFiles,
     ruleOptions: [],
     mode: "no-new",
     target: 0,
     metric: "message-count",
     repairKind: "manual",
   }
   ```

   `minimal-ts` is expected to suffice — normal lint already runs the rule
   without type info — but confirm the compiler-derived rules behave under
   the ratchet's isolated generated config before trusting the baseline.
3. Add the matching `kind: "ratchet"` control to `harness.controls.json` **by
   hand** — `bun run docs:harness-controls` does not synthesize manifest
   entries; it reads the manifest and regenerates the
   `docs/generated/harness-controls.md` doc from it. Mirror the existing
   ratchet controls' shape:

   ```json
   {
     "id": "ratchet/react-hooks-set-state-in-effect-client",
     "kind": "ratchet",
     "category": "maintainability",
     "principle": "Freeze the accepted set-state-in-effect floor so finding #25 fails at commit time while cleanup proceeds opportunistically.",
     "pairedGuide": "docs/guides/lint-ratchet.md",
     "repairKind": "manual",
     "source": "scripts/lint-ratchet/lint-ratchet-config.ts",
     "invocation": "bun run lint:ratchet"
   }
   ```

   Then run `bun run docs:harness-controls` to regenerate the doc and
   `bun run docs:harness-controls:check` to confirm. This is mandatory, not
   optional: the registry preflight that `lint:ratchet` runs first (and the
   standalone `lint:ratchet:check-registry`) now fails any `ratchet/*` entry
   that has no manifest control.
4. `bun run lint:ratchet:update`, review the baseline diff (expect ~24
   findings matching the Leaf 15 inventory distribution), then
   `bun run lint:ratchet`.
5. Reflect the new ratchet in the coverage map: add
   `ratchet/react-hooks-set-state-in-effect-client` to the
   `packages/client/src/**/*.{ts,tsx}` (production, non-test) row in
   `docs/agent_notes/lint-coverage-map.md`, then
   `bun run docs:lint-coverage-map:check`. The Coverage Map Gate validates that
   every `ratchet/<name>` named in the map resolves to a registry entry; keep
   the map accurate when adding the floor.
6. Temporary-violation probe per the guide: add one synchronous
   `setState`-in-effect in an in-scope file, prove the ratchet reports it,
   revert.
7. Keep `"react-hooks/set-state-in-effect": "off"` in
   `eslint-config/client-configs.js` (the ratchet is the owner; avoid double
   reporting). That `"off"` line carries no comment today; add one pointing at
   the ratchet id so the next reader knows the floor moved to the ratchet.
8. Append a verdict row to
   `docs/agent_notes/backlog/lint-followups-2026-06/evaluation-verdicts.md`:
   defer-for-error stands, ratchet-tier adopted, with the baseline count. The
   Leaf 15 follow-up doc (`lint-followups/15-react-deferred-rules.md`) was
   archived in `31b43881`, so the active register is now the only home for the
   new verdict — there is no separate leaf doc to update.

Drain path: opportunistic. When a dialog/state refactor lands, the touched
findings drain and `lint:ratchet:update` tightens the floor monotonically.

## Recommendation 2 — trial `eslint-plugin-react-you-might-not-need-an-effect`

The plugin's 9 rules cover architectural classes the official rule
structurally cannot (derived state via handlers/async, effect chains, passing
live state to parents, hand-rolled external-store subscriptions). Its lint
messages name the correct replacement pattern, which is the agent-steering
property. But v1.0.0 shipped 2026-05-31 — treat as uncalibrated.

Gated sequence; stop at any gate and record a verdict:

1. **Install as an explicit probe dependency.** Add
   `eslint-plugin-react-you-might-not-need-an-effect@1.0.0` as a root
   `devDependency` and regenerate `bun.lock`; if the compatibility or
   inventory gates reject the plugin, revert the dependency and lockfile in
   the same slice.
2. **ESLint 10 compatibility probe.** The repo already carries a pinned
   workaround for `eslint-plugin-react` 7.37.5 crashing under ESLint 10 (see
   `eslint-config/client-configs.js` and
   `docs/agent_notes/backlog/eslint-react-peer-exception-removal.md`). Verify
   the plugin loads and runs under the ratchet runner's ESLint before any
   inventory work.
3. **Throwaway inventory** over `packages/client/src/**/*.{ts,tsx}` with all
   9 rules, classified per the Leaf 14/15 method (real bug / intentional /
   structural mismatch, per rule). Expect overlap with the 24 known
   `set-state-in-effect` sites; the interesting rows are findings the
   official rule missed.
4. **Triage per rule** against the existing stop conditions (the Leaf 14
   `react-hooks` broadening inventory, archived from
   `lint-hardening/14-react-hooks-broadened.md` in `31b43881` — read it from
   git history): noise >5:1 over real findings → reject that rule; clean or
   near-clean
   rules → ratchet entries (allowlist
   `eslint-plugin-react-you-might-not-need-an-effect` →
   `react-you-might-not-need-an-effect` namespace; same shape as
   Recommendation 1, one entry per adopted rule). The current ratchet registry
   has exactly one `ruleId` per entry and cannot ratchet an ESLint preset as a
   single registry item.
5. Append per-rule rows to
   `docs/agent_notes/backlog/lint-followups-2026-06/evaluation-verdicts.md`
   either way — adopted, deferred, or rejected — so the plugin is not blindly
   re-tried.

Severity policy note: the repo treats normal-lint `warn` as not fully
promoted (`docs/guides/lint-ratchet.md`, Zero-Baseline Lifecycle), so the
plugin's `recommended` (warn) preset is not the right vehicle here — ratchet
entries are the warn-equivalent tier, with eventual promotion to normal-lint
`error` per the zero-baseline lifecycle.

## Recommendation 3 — agent-facing effect guidance

One short block, either added to `AGENTS.md` (Code Standards) or placed in a
new `docs/guides/client-effects.md` (it does not exist yet) and referenced
from `AGENTS.md`:

> Effects are only for synchronizing with external systems (socket, DOM,
> browser APIs) — and socket work goes through the existing `SocketProvider`
> and invalidation hooks. Derived state computes during render. Event logic
> lives in the handler. Data fetching is tRPC + TanStack Query, never an
> effect. Resetting dialog/form state on prop change prefers a `key` remount.
> If an effect only calls a setState synchronously, it is probably one of the
> above in disguise.

Rationale: the research found lint messages teach the correct pattern at
violation time, but guidance prevents the attempt — they complement. (No
verified evidence on guidance-doc efficacy exists; this is inference, kept
cheap accordingly.)

## Rollout order

1. Recommendation 1 (smallest, reuses a completed inventory, immediately
   closes the accretion gap on the known rule).
2. Recommendation 3 (docs-only, can ride along with 1).
3. Recommendation 2 (largest, externally gated on plugin compatibility and a
   fresh inventory; promote as its own leaf when a cycle opens).

Each slice follows the standard ratchet verification: hand-add the
harness-control manifest entry then regenerate its doc
(`bun run docs:harness-controls`) ahead of registry preflight, baseline
update + diff review, `bun run lint:ratchet`, coverage-map refresh
(`bun run docs:lint-coverage-map:check`), violation probe for zero-or-frozen
scopes, `bun run verify:changed`.

## Exit / revisit conditions

- If the React team promotes the existing non-preset
  `no-deriving-state-in-effects` (it ships in `eslint-plugin-react-hooks`
  7.1.1 but is absent from `recommended-latest`, as probed in Leaf 14) into
  the recommended presets, re-evaluate Recommendation 2's overlap before
  adopting more third-party rules.
- If a dialog/state-pattern refactor drains the set-state-in-effect baseline
  to zero, follow the zero-baseline lifecycle: promote the rule to normal
  ESLint at error and retire the ratchet.
- If the you-might-not-need-an-effect inventory shows >5:1 noise on every
  rule, record the rejection verdict and fall back to Recommendations 1 + 3
  only — they already cover the accretion risk for the locally-observed
  pattern classes.
