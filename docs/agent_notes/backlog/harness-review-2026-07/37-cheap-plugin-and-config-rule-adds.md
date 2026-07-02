# 37. Four cheap, independent plugin/config rule adds (context values, react-refresh, fake timers, import.meta.env fence)

Status: Done — sub-items (a), (b), and (c) landed as ratchets after HEAD inventories; sub-item (d) landed as normal client lint. Re-verify counts before changing promotion state.
Lens: lint-rules · Area: client+tests · Severity: low-med · Size: S · Confidence: high
Theme: cheap-rule-adds · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

Bundle of four verified-not-yet-enabled adds. Each sub-item is its own tiny commit; they share
a leaf only because each is too small to file alone.

## Problem
Four low-cost guardrails are missing: unstable context values cause silent whole-subtree
re-renders; non-component exports from component files silently break Vite HMR; real clocks in
tests are a standing flake seed; and `import.meta.env` reads outside the config module recreate
the exact drift `process.env` fencing already solved on the server side.

## Evidence
- (a) `react/jsx-no-constructed-context-values` absent from the 5 hand-picked react rules at
  `eslint-config/client-configs.js:54-58` (`jsx-key`, `no-unstable-nested-components`,
  `self-closing-comp`, `no-array-index-key`, `no-unused-prop-types`); `eslint-plugin-react`
  7.37.5 already installed (`package.json:144`). Current findings: **0** — all three providers
  pass an identifier (`wizard-context.tsx:67-72` and `socket-context.tsx:92-97` via `useMemo`;
  `auth-context.tsx:113-123` builds a fresh object per render but passes it as an identifier,
  which this rule does NOT flag — a known rule limitation worth noting in the commit).
- (b) `eslint-plugin-react-refresh` NOT installed (verified `package.json`,
  `packages/client/package.json`, `eslint-config/*.js`); client is Vite
  (`@vitejs/plugin-react` ^6.0.2). New dependency → subject to the repo's dependency-age gate
  (see `docs/agent_notes/backlog/dependency-age-gated-followups.md`).
- (c) COUNT CORRECTION: the audit's "~16 current uses" is low. Verified **59** occurrences
  (14 `Date.now()` + 45 no-arg `new Date()`) on 57 lines across 22 `*.test.*` files in
  `packages/*/src`; only 7 test files use `vi.useFakeTimers`. Heavy hitters include
  `shared/src/schemas/campaign.test.ts` (6), `client/.../cast-rail.test.tsx` (6),
  `server/src/utils/session-cleanup.test.ts` (4), `server/src/socket/broadcast-registry.test.ts` (4).
- (d) Exactly **1** non-test `import.meta.env` read: `packages/client/src/lib/api-base.ts:2`
  (`VITE_API_URL`). Server-side precedent to mirror: `processEnvRestrictedSyntax`
  (`eslint-config/shared-policy.js:131-136`), applied in `script-configs.js:97`. No existing
  `import.meta` restriction anywhere in `eslint-config/` (verified).

## Proposed direction
- (a) Add `"react/jsx-no-constructed-context-values": "error"` to the client react block.
  Zero findings → normal lint directly.
- (b) Install `eslint-plugin-react-refresh` (pending dependency-age gate) and enable
  `react-refresh/only-export-components` for `packages/client/**/*.tsx` with the
  `allowConstantExport` option; run a throwaway inventory first — shadcn-style `ui/` files
  that export variants/helpers alongside components are the likely finding source; ratchet if
  nonzero, normal lint if clean.
- (c) `no-restricted-syntax` (`Date.now()` call) + `no-restricted-syntax` for
  `NewExpression[callee.name='Date'][arguments.length=0]`, scoped to `*.test.*` in packages,
  message pointing at `vi.useFakeTimers`/`vi.setSystemTime` or an injected clock. 59 findings
  → this is a lint-ratchet entry, not a fix-outright (the audit's smaller count suggested
  otherwise; the verified inventory does not).
- (d) Restricted-syntax entry `MemberExpression[object.meta.name='import'][property.name='env']`
  (verify the exact ESTree shape for `import.meta` — `MetaProperty` parent) for
  `packages/client/src`, ignores `lib/api-base.ts`; message mirrors the process.env one. Zero
  findings after the allowlist → normal lint directly.

## Current implementation state
- (a) `react/jsx-no-constructed-context-values` had a current finding at implementation time, so it
  landed as `ratchet/react-jsx-no-constructed-context-values-client`.
- (b) `eslint-plugin-react-refresh` passed the dependency-age gate and
  `react-refresh/only-export-components` landed as
  `ratchet/react-refresh-only-export-components-client` after inventory.
- (c) the real-clock test restriction is implemented as
  `ratchet/no-real-time-in-package-tests` with the generated 59-finding baseline.
- (d) the `import.meta.env` fence landed in normal client lint, with `api-base.ts` exempt only from
  that import-meta selector.

## Scope / caveats
- Keep the four in separate commits so a bad inventory on one doesn't block the others; (b) is
  the only one with an external gate.
- (c) needs a real triage pass: `new Date()` used as "any timestamp" in seed/fixture builders
  is harmless but still flake-adjacent near midnight/DST boundaries; decide per-file fix vs
  baseline during ratchet review, and consider scoping v1 to unit tests only (server router
  tests are DB-integration and may legitimately want real clocks for expiry rows).
- (a) will not catch the `auth-context.tsx` per-render object (identifier-passed); if that
  matters, it is a one-line `useMemo` fix to do opportunistically, not a lint problem.
